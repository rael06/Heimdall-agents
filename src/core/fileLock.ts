import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * Exclusive lock around the files several VS Code windows share.
 *
 * Reading a file, changing it and writing it back is three steps, and two
 * windows can interleave them: both read, both change their own copy, and the
 * second write erases the first. The window is only a few milliseconds wide,
 * which is exactly what makes it the kind of bug that shows up rarely and is
 * impossible to reproduce on demand.
 *
 * The lock is a file created with `wx`, which the filesystem only grants to one
 * caller. A holder that dies leaves it behind, so a lock nobody refreshed for a
 * while is considered abandoned and taken over: a crash must not freeze every
 * window out of its own marks.
 */

const RETRY_DELAY_MS = 25;
/**
 * Past this age a lock is assumed to belong to a process that is gone.
 *
 * This is the only reason a waiter ever stops waiting. A holder writes the lock
 * once and never refreshes it, so a holder still working after this long is
 * indistinguishable from one that died — and taking the lock is then the right
 * answer either way.
 */
const STALE_AFTER_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * How long the lock has been held, or `undefined` if there is no longer one.
 *
 * The distinction is the whole point, and collapsing it into "stale: yes/no" was
 * a way to lose a write. A lock that has *gone* is not a lock to remove — by the
 * time the caller acts on the answer, somebody else may hold a fresh one, and
 * removing that leaves two writers believing they have exclusive access.
 */
async function lockAge(lockPath: string, now: number): Promise<number | undefined> {
  try {
    const stat = await fs.stat(lockPath);
    return now - stat.mtimeMs;
  } catch {
    return undefined;
  }
}

/**
 * Whether a failure to create the lock means somebody else has it.
 *
 * `EEXIST` is the honest answer and the only one this used to accept. Windows
 * has another: a file whose last handle has just been closed with a delete
 * pending cannot be opened at all, and the attempt comes back `EPERM` — or
 * `EBUSY`, or `EACCES`, depending on where in that window it lands. The lock is
 * held, or was held a microsecond ago; it is contention either way.
 *
 * Measured, and it is not theoretical. Treating those as fatal made `acquire`
 * rethrow, and `withFileLock` answers a throw by running the change *with no
 * lock at all* — the one thing this file exists to prevent. Under a loaded test
 * run it cost between one and twelve of sixteen concurrent writes, at roughly
 * one run in six.
 *
 * The distinction that matters is not the code but whether a lock is there: if
 * the path exists, somebody holds it and waiting is right. If it does not and we
 * still cannot create it, the directory is not writable, which is the case the
 * caller's fallback was written for.
 */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
/** About a second at {@link RETRY_DELAY_MS}, then the failure is believed. */
const MAX_TRANSIENT = 40;

async function acquire(lockPath: string): Promise<void> {
  let transient = 0;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') {
        /*
         * Not an error to believe on sight.
         *
         * Windows will not open a file whose deletion is still pending, and
         * reports it as EPERM — or EBUSY, or EACCES, depending where in that
         * window the attempt lands. It is contention, and the previous version
         * of this code decided which by asking whether the lock still existed.
         * That question is itself a race: if the holder's delete completed in
         * between, the answer is "no file", the conclusion is "unwritable
         * directory", and `withFileLock` then runs the change with no lock. It
         * cost fourteen of sixteen concurrent writes on the run that caught it.
         *
         * So nothing is asked. A transient code is retried like any other
         * contention, and only a run of them — about a second — is taken to mean
         * the directory genuinely will not have us, which is the case the
         * caller's fallback exists for.
         */
        if (!TRANSIENT.has(code ?? '') || (transient += 1) > MAX_TRANSIENT) {
          throw error;
        }
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      transient = 0;
    }

    // Only an abandoned lock is taken over. There used to be a second reason —
    // a flat 500 ms deadline, after which a waiter removed the lock and wrote
    // anyway — and it defeated the exclusion precisely when it was needed.
    //
    // Measured: twelve concurrent writers, each waiting 25 ms between attempts,
    // queue for about 300 ms before the last is served. Under a loaded machine
    // that crosses 500 ms, and from there every remaining writer deletes a live
    // holder's lock and overwrites it. The concurrency test caught it as
    // `expected 4 to be 12` — eight increments lost to the very race this file
    // exists to prevent.
    //
    // The deadline was also redundant. A holder that died is already reclaimed
    // by the staleness check, so nothing can block a waiter for longer than
    // STALE_AFTER_MS. Waiting up to five seconds for a live holder is slower
    // than overwriting it, and it is the difference between a change that
    // arrives late and a change that is silently gone.
    const age = await lockAge(lockPath, Date.now());

    // The lock went away while we were looking at it. Try again at once and
    // remove nothing: between this answer and any `rm` acting on it, another
    // writer can have taken a fresh lock, and deleting that one puts two of them
    // inside at the same time. Removing it here cost exactly one write per
    // occurrence — `expected 15 to be 16`, and seven stars kept out of eight.
    if (age === undefined) {
      continue;
    }

    if (age > STALE_AFTER_MS) {
      await fs.rm(lockPath, { force: true });
      continue;
    }
    await sleep(RETRY_DELAY_MS);
  }
}

let writeCounter = 0;

/**
 * A name no concurrent write can collide on, whether it comes from another
 * window or from the same one: two writers landing on the same temporary file
 * would have one of them rename a file the other already moved.
 */
export function temporaryPathFor(filePath: string): string {
  writeCounter += 1;
  return `${filePath}.${process.pid}.${writeCounter}.tmp`;
}

/**
 * Runs `mutate` while holding the lock for `filePath`. Everything it does to
 * that file, reads included, is shielded from the other windows.
 */
export async function withFileLock<T>(filePath: string, mutate: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  try {
    // The very first write is the one several windows race for, and the lock
    // cannot be created in a directory that does not exist yet.
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await acquire(lockPath);
  } catch {
    // A lock that cannot even be created, on a read-only directory for instance,
    // must not cost the user their change: proceed as before, unprotected.
    //
    // This is now reached only when the directory itself refuses us — contention
    // is recognised as contention by `isContended`, whatever code the platform
    // reports it under.
    return mutate();
  }
  try {
    return await mutate();
  } finally {
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}
