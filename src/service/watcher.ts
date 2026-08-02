import { FSWatcher, watch } from 'node:fs';
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
      try {
        const watcher = watch(root, { recursive: true }, () => this.debouncer.trigger());
        // A watcher that dies later must not take the service with it; the full
        // scan is what covers the gap.
        watcher.on('error', () => undefined);
        this.watchers.push(watcher);
        report.watched.push(root);
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
