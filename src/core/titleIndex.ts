import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from './fileLock';

/**
 * How far each transcript has been searched for a title, and what was found.
 *
 * Claude writes a rename once, as its own entry, so it drifts away from the end
 * of the file as the conversation goes on: reading the head and the tail finds a
 * fresh rename and misses an old one. Finding it for certain means reading the
 * whole transcript, which is far too expensive to redo on every refresh.
 *
 * Recording where the search stopped turns that into a one-off: a file is read
 * in full once, then only the bytes appended since. Keeping it on disk rather
 * than in memory means the whole history is read once for every VS Code window
 * that will ever open, instead of once per window.
 *
 * Titles are conversation content, unlike the marks, so this is a cache and
 * never the source: deleting the file only costs one full pass.
 */

const VERSION = 1;
/** Guard on the file size: the oldest entries are dropped first. */
const MAX_ENTRIES = 5000;

export interface TitleEntry {
  /** How far the transcript has been searched, in bytes. */
  scannedBytes: number;
  /** The title the user typed, when the search found one. */
  custom?: string;
  /** Last time this entry was of use, to prune what is no longer scanned. */
  seenAt: number;
}

interface TitleFile {
  version: number;
  entries: Record<string, TitleEntry>;
}

function sanitize(value: unknown): Map<string, TitleEntry> {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<TitleFile>;
  const entries = new Map<string, TitleEntry>();
  if (typeof raw.entries !== 'object' || raw.entries === null) {
    return entries;
  }
  for (const [key, entry] of Object.entries(raw.entries)) {
    const item = (typeof entry === 'object' && entry !== null ? entry : {}) as Partial<TitleEntry>;
    if (typeof item.scannedBytes !== 'number' || item.scannedBytes < 0) {
      continue;
    }
    entries.set(key, {
      scannedBytes: item.scannedBytes,
      custom: typeof item.custom === 'string' && item.custom.trim() ? item.custom : undefined,
      seenAt: typeof item.seenAt === 'number' ? item.seenAt : 0,
    });
  }
  return entries;
}

export class TitleIndex {
  private entries?: Map<string, TitleEntry>;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  /** Loads the index once; later calls serve the copy already in memory. */
  private async load(): Promise<Map<string, TitleEntry>> {
    if (!this.entries) {
      try {
        this.entries = sanitize(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
      } catch {
        // Missing, unreadable or half-written: a cache is allowed to start empty.
        this.entries = new Map();
      }
    }
    return this.entries;
  }

  async get(key: string): Promise<TitleEntry | undefined> {
    return (await this.load()).get(key);
  }

  async set(key: string, entry: Omit<TitleEntry, 'seenAt'>, now: number): Promise<void> {
    const entries = await this.load();
    const previous = entries.get(key);
    if (
      previous &&
      previous.scannedBytes === entry.scannedBytes &&
      previous.custom === entry.custom
    ) {
      previous.seenAt = now;
      return;
    }
    entries.set(key, { ...entry, seenAt: now });
    this.dirty = true;
  }

  /**
   * Writes only what changed, and only once a scan is over. Held under a lock
   * and merged with what is on disk, so a window does not throw away the passes
   * another one paid for.
   */
  async flush(): Promise<void> {
    if (!this.dirty || !this.entries) {
      return;
    }
    this.dirty = false;
    const mine = this.entries;

    await withFileLock(this.filePath, async () => {
      let merged: Map<string, TitleEntry>;
      try {
        merged = sanitize(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
      } catch {
        merged = new Map();
      }
      for (const [key, entry] of mine) {
        merged.set(key, mergeEntries(merged.get(key), entry));
      }

      const kept = [...merged.entries()]
        .sort((a, b) => b[1].seenAt - a[1].seenAt)
        .slice(0, MAX_ENTRIES);
      this.entries = new Map(kept);

      const body: TitleFile = { version: VERSION, entries: Object.fromEntries(kept) };
      try {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        // Written aside then renamed, so a reader never sees a truncated file.
        const temporary = temporaryPathFor(this.filePath);
        await fs.writeFile(temporary, JSON.stringify(body), 'utf8');
        await fs.rename(temporary, this.filePath);
      } catch {
        // A cache that cannot be written costs a rescan, never a failure.
      }
    });
  }
}

/**
 * Keeps whichever entry searched further, and the title of the other when the
 * deeper search found none: a rename stands until a later one replaces it, and
 * a later one would itself be a title.
 */
function mergeEntries(theirs: TitleEntry | undefined, mine: TitleEntry): TitleEntry {
  if (!theirs) {
    return mine;
  }
  const deeper = mine.scannedBytes >= theirs.scannedBytes ? mine : theirs;
  const other = deeper === mine ? theirs : mine;
  return {
    scannedBytes: deeper.scannedBytes,
    custom: deeper.custom ?? other.custom,
    seenAt: Math.max(mine.seenAt, theirs.seenAt),
  };
}
