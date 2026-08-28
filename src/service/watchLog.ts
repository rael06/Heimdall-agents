import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from '../core/fileLock';

/**
 * When each session was last taken up or dropped as watched.
 *
 * The marks file says *whether* a session is watched and has never said *when*
 * it became so, which is the question a row cannot answer for itself: a list
 * sorted by how long a session has been in its status says nothing about how
 * long you have been carrying it.
 *
 * Its own file, for the same reason the acknowledgements and the overrides have
 * one, and this time the reason is load-bearing rather than tidy: `marks.json`
 * is read and rewritten by the VS Code extension, which lives outside this
 * repository, and its sanitiser keeps three lists of identifiers and drops
 * everything else. A timestamp added there would survive exactly until the
 * other side wrote — and vanish without a word.
 *
 * Recorded from what the engine *observes* rather than only from what this
 * application does, so a session watched from the extension is dated the same
 * way. The two write different files; they are looking at the same fact.
 */

const VERSION = 1;
const FILE_NAME = 'watch-log.json';

export interface WatchEntry {
  /** ISO 8601, like every other stamp written here. */
  at: string;
  /** What it changed to, so the row can say *watched since* or *dropped*. */
  watched: boolean;
}

export interface WatchLog {
  version: number;
  entries: Record<string, WatchEntry>;
}

export function emptyWatchLog(): WatchLog {
  return { version: VERSION, entries: {} };
}

/**
 * An entry of the wrong shape is dropped rather than carried.
 *
 * A date is kept as the string it was written as and not parsed here: this file
 * is read on every scan, and the one thing that must not happen is a whole log
 * refused because a hand-edited line has a comma in it.
 */
export function sanitizeWatchLog(value: unknown): WatchLog {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const source =
    typeof raw.entries === 'object' && raw.entries !== null
      ? (raw.entries as Record<string, unknown>)
      : {};
  const entries: Record<string, WatchEntry> = {};
  for (const [id, candidate] of Object.entries(source)) {
    const entry = (
      typeof candidate === 'object' && candidate !== null ? candidate : {}
    ) as Record<string, unknown>;
    if (typeof entry.at !== 'string' || typeof entry.watched !== 'boolean' || !entry.at) {
      continue;
    }
    entries[id] = { at: entry.at, watched: entry.watched };
  }
  return { version: typeof raw.version === 'number' ? raw.version : VERSION, entries };
}

export function watchLogFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

/**
 * The changes between what was watched and what is watched now.
 *
 * Nothing is written on the first pass a session is seen in: an installation
 * that already watches forty sessions would otherwise stamp all forty with the
 * moment it started, which reads as *you did this just now* and is false for
 * every one of them. An empty cell says "not since this was kept", which is the
 * only true thing available.
 */
export function watchChanges(
  before: readonly string[],
  after: readonly string[],
): Record<string, boolean> {
  const was = new Set(before);
  const is = new Set(after);
  const changed: Record<string, boolean> = {};
  for (const id of is) {
    if (!was.has(id)) changed[id] = true;
  }
  for (const id of was) {
    if (!is.has(id)) changed[id] = false;
  }
  return changed;
}

export class WatchLogStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<WatchLog> {
    try {
      return sanitizeWatchLog(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch {
      // Missing or half-written: nothing is dated, and every row says so.
      return emptyWatchLog();
    }
  }

  /** Records a set of changes at one instant, under the shared lock. */
  async record(changed: Record<string, boolean>, at: Date): Promise<WatchLog> {
    if (Object.keys(changed).length === 0) {
      return this.read();
    }
    return withFileLock(this.filePath, async () => {
      const log = await this.read();
      for (const [id, watched] of Object.entries(changed)) {
        log.entries[id] = { at: at.toISOString(), watched };
      }
      await this.write(log);
      return log;
    });
  }

  private async write(log: WatchLog): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = temporaryPathFor(this.filePath);
    await fs.writeFile(temporary, JSON.stringify(log), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}
