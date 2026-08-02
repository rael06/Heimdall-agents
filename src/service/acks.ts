import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from '../core/fileLock';

/**
 * Sessions carrying something you have not seen yet.
 *
 * This is what makes a list you never sort by urgency workable: a row's position
 * never moves, so the row itself has to say there is something new on it.
 *
 * It lives in its own file rather than beside the marks, and that is not a
 * preference. `marksStore.sanitize` rebuilds its object from the keys it knows,
 * so any field added to `marks.json` is silently dropped the next time the
 * extension writes it. While both run side by side, a shared file may only be
 * read and written in the shape both agree on.
 */

const VERSION = 1;
const FILE_NAME = 'acknowledgements.json';

export interface Acks {
  version: number;
  /** Identifiers of the sessions holding something unseen. */
  unacknowledged: string[];
}

export function emptyAcks(): Acks {
  return { version: VERSION, unacknowledged: [] };
}

export function sanitizeAcks(value: unknown): Acks {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const ids = Array.isArray(raw.unacknowledged)
    ? raw.unacknowledged.filter((id): id is string => typeof id === 'string' && !!id)
    : [];
  return {
    version: typeof raw.version === 'number' ? raw.version : VERSION,
    unacknowledged: [...new Set(ids)],
  };
}

export function acksFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

export class AckStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<Acks> {
    try {
      return sanitizeAcks(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch {
      // Missing or half-written: nothing is unseen, which is the safe answer.
      return emptyAcks();
    }
  }

  /** Read, change, write back, under the lock the other shared files use. */
  async update(mutate: (acks: Acks) => void): Promise<Acks> {
    return withFileLock(this.filePath, async () => {
      const acks = await this.read();
      mutate(acks);
      await this.write(acks);
      return acks;
    });
  }

  private async write(acks: Acks): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = temporaryPathFor(this.filePath);
    await fs.writeFile(temporary, JSON.stringify(acks), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}

/**
 * What a scan changes about the unseen set.
 *
 * A session lights up when its status changes to anything that is not
 * `running`: it stopped, and there is something new to look at. The change
 * *into* `running` is deliberately excluded, since that is the event that clears
 * the mark — a session that is working is not waiting to be read.
 *
 * A session appearing for the first time does not light up either. On a cold
 * start that would mark the entire history unseen, which says nothing.
 */
export function applyStatusChanges(
  unacknowledged: readonly string[],
  changes: readonly { id: string; from?: string; to: string }[],
): string[] {
  const next = new Set(unacknowledged);
  for (const change of changes) {
    // A session seen for the first time, or one whose status held, is not a
    // change: only a transition says anything.
    if (change.from === undefined || change.from === change.to) {
      continue;
    }
    if (change.to === 'running') {
      next.delete(change.id);
    } else {
      next.add(change.id);
    }
  }
  return [...next];
}
