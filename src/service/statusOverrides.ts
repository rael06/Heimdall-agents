import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from '../core/fileLock';
import { StatusOverride } from '../core/statusOverride';
import { STATUS_ORDER } from '../model/types';

/**
 * The statuses you set by hand.
 *
 * Its own file, for the same reason the acknowledgements have one: the marks
 * file is rebuilt from the keys the extension knows, so anything added to it is
 * dropped the next time the other side writes. A shared file may only be read
 * and written in the shape both agree on.
 */

const VERSION = 1;
const FILE_NAME = 'status-overrides.json';

export interface Overrides {
  version: number;
  entries: Record<string, StatusOverride>;
}

export function emptyOverrides(): Overrides {
  return { version: VERSION, entries: {} };
}

/**
 * A status that is not one of the four is dropped rather than trusted: this
 * file is written by a person's click today and could be edited by hand
 * tomorrow, and an unknown value would reach the interface as a status nothing
 * knows how to draw.
 */
export function sanitizeOverrides(value: unknown): Overrides {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const source =
    typeof raw.entries === 'object' && raw.entries !== null
      ? (raw.entries as Record<string, unknown>)
      : {};
  const entries: Record<string, StatusOverride> = {};
  for (const [id, candidate] of Object.entries(source)) {
    const entry = (
      typeof candidate === 'object' && candidate !== null ? candidate : {}
    ) as Record<string, unknown>;
    const status = entry.status;
    const inferred = entry.inferred;
    const at = entry.at;
    if (
      typeof status !== 'string' ||
      typeof inferred !== 'string' ||
      typeof at !== 'string' ||
      !STATUS_ORDER.includes(status as never) ||
      !STATUS_ORDER.includes(inferred as never)
    ) {
      continue;
    }
    entries[id] = { status, inferred, at } as StatusOverride;
  }
  return { version: typeof raw.version === 'number' ? raw.version : VERSION, entries };
}

export function overridesFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

export class OverrideStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Overrides> {
    try {
      return sanitizeOverrides(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch {
      // Missing or half-written: nothing is overridden, which is the answer
      // that shows what the transcripts say.
      return emptyOverrides();
    }
  }

  /** Read, change, write back, under the lock the other shared files use. */
  async update(mutate: (overrides: Overrides) => void): Promise<Overrides> {
    return withFileLock(this.filePath, async () => {
      const overrides = await this.read();
      mutate(overrides);
      await this.write(overrides);
      return overrides;
    });
  }

  private async write(overrides: Overrides): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = temporaryPathFor(this.filePath);
    await fs.writeFile(temporary, JSON.stringify(overrides), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}
