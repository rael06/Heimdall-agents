import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from './fileLock';

/**
 * Watched sessions, favorites, and the sessions that were running at the last
 * scan, shared by every VS Code window.
 *
 * They used to live in the extension global state, which each window caches in
 * memory and rewrites whole: a star added in one window was invisible to the
 * others until reload, and the next write from any of them silently dropped it.
 * A file both windows read on every refresh, and write by re-reading first,
 * removes that: the worst case is two writes within the same few milliseconds,
 * instead of a whole window's worth of marks.
 *
 * Identifiers only, as before: nothing describing a conversation is persisted.
 */

const VERSION = 1;

export interface Marks {
  version: number;
  watched: string[];
  favorites: string[];
  /** Sessions seen running last time, used to detect a new turn starting. */
  running: string[];
}

export function emptyMarks(): Marks {
  return { version: VERSION, watched: [], favorites: [], running: [] };
}

function sanitize(value: unknown): Marks {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const ids = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((id): id is string => typeof id === 'string' && !!id) : [];
  return {
    version: typeof raw.version === 'number' ? raw.version : VERSION,
    watched: ids(raw.watched),
    favorites: ids(raw.favorites),
    running: ids(raw.running),
  };
}

export class MarksStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Marks> {
    try {
      return sanitize(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch {
      // Missing or half-written file: start from empty rather than fail.
      return emptyMarks();
    }
  }

  /**
   * Applies a change on top of what is currently on disk, never on a cached
   * copy, so a concurrent window's marks survive. Reading and writing back is
   * held under a lock, since on their own they are two steps another window can
   * slip between.
   */
  async update(mutate: (marks: Marks) => void): Promise<Marks> {
    return withFileLock(this.filePath, async () => {
      const marks = await this.read();
      mutate(marks);
      await this.write(marks);
      return marks;
    });
  }

  private async write(marks: Marks): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    // Written aside then renamed, so a reader never sees a truncated file.
    const temporary = temporaryPathFor(this.filePath);
    await fs.writeFile(temporary, JSON.stringify(marks), 'utf8');
    await fs.rename(temporary, this.filePath);
  }

  /**
   * Seeds the file once, to carry over marks made before it existed. Held under
   * the same lock: every window runs this on startup, and they all start at once
   * when a session is restored.
   */
  async seed(watched: string[], favorites: string[]): Promise<void> {
    if (watched.length === 0 && favorites.length === 0) {
      return;
    }
    await withFileLock(this.filePath, async () => {
      try {
        await fs.access(this.filePath);
        return;
      } catch {
        // No file yet: this is the first run after the move.
      }
      await this.write({ ...emptyMarks(), watched, favorites });
    });
  }
}

export function toggle(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id];
}

export function add(ids: string[], added: string[]): string[] {
  const missing = added.filter((id) => !ids.includes(id));
  return missing.length === 0 ? ids : [...ids, ...missing];
}
