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
const MAX_WAIT_MS = 500;
/** Past this age a lock is assumed to belong to a process that is gone. */
const STALE_AFTER_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function isStale(lockPath: string, now: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockPath);
    return now - stat.mtimeMs > STALE_AFTER_MS;
  } catch {
    // Released while we were looking: treat it as free.
    return true;
  }
}

async function acquire(lockPath: string): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  for (;;) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid), 'utf8');
      await handle.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }

    const now = Date.now();
    // Taking over an abandoned lock, or one held longer than anyone should wait:
    // the alternative is refusing a change the user just asked for.
    if ((await isStale(lockPath, now)) || now >= deadline) {
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
    return mutate();
  }
  try {
    return await mutate();
  } finally {
    await fs.rm(lockPath, { force: true }).catch(() => undefined);
  }
}
