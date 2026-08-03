import { FSWatcher, realpathSync, watch } from 'node:fs';
import { Debouncer } from './debounce';

/**
 * Recursive `fs.watch` on the transcript roots, verified on Windows on both of
 * them. It replaces the extension's timer: a scan now happens because something
 * was written, not because five seconds went by.
 *
 * It is not trusted on its own. A root that cannot be watched is reported
 * rather than hidden, and the engine keeps a slow full scan running whatever
 * this says — an event missed by the filesystem would otherwise never be seen.
 */

export interface WatchFailure {
  root: string;
  error: string;
}

export interface WatchReport {
  watched: string[];
  failed: WatchFailure[];
}

/**
 * The path the operating system itself would call this directory.
 *
 * `realpathSync.native` and not `realpathSync`: only the native one expands an
 * 8.3 short name and fixes the casing. Measured — given
 * `…\Temp\RP-GXJ~1`, the plain version hands it straight back, the native one
 * answers `…\Temp\rp-GXjo4e`.
 *
 * This is not tidiness. On Windows, a recursive `fs.watch` asks libuv to make
 * every reported path relative to the directory being watched, and libuv
 * asserts that the first is a prefix of the second — an assertion, so it aborts
 * the process rather than raising anything JavaScript can catch. Hand it a
 * short name, a junction, or the wrong case, and the service dies outright.
 *
 * Found by CI on node 24 and not before: `TEMP` on a Windows runner is
 * `C:\Users\RUNNER~1\…`, and the libuv shipped with node 20 did not assert.
 *
 * A path that cannot be resolved is used as it came, which is what the failure
 * report below is for.
 */
function canonical(root: string): string {
  try {
    return realpathSync.native(root);
  } catch {
    return root;
  }
}

export class RootWatcher {
  private watchers: FSWatcher[] = [];
  private readonly debouncer: Debouncer;

  constructor(
    private readonly roots: readonly string[],
    onChange: () => void,
    waitMs: number,
    maxWaitMs: number,
  ) {
    this.debouncer = new Debouncer(onChange, waitMs, maxWaitMs);
  }

  start(): WatchReport {
    const report: WatchReport = { watched: [], failed: [] };
    for (const root of this.roots) {
      // Resolved before it is handed over, never after: see `canonical`. What
      // is reported is what is actually being watched.
      const resolved = canonical(root);
      try {
        const watcher = watch(resolved, { recursive: true }, () => this.debouncer.trigger());
        // A watcher that dies later must not take the service with it; the full
        // scan is what covers the gap. This catches a watcher that *errors* —
        // an assertion inside libuv is not survivable here, which is why the
        // path is canonicalised above rather than defended against down here.
        watcher.on('error', () => undefined);
        this.watchers.push(watcher);
        report.watched.push(resolved);
      } catch (error) {
        report.failed.push({ root, error: String(error) });
      }
    }
    return report;
  }

  stop(): void {
    this.debouncer.cancel();
    for (const watcher of this.watchers) {
      watcher.close();
    }
    this.watchers = [];
  }
}
