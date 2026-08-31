import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { temporaryPathFor, withFileLock } from '../core/fileLock';

/**
 * The sessions whose bell is on.
 *
 * "Watched" and "tell me about it" were the same thing until now, and they are
 * not: a session can be worth keeping an eye on in the list without being worth
 * a toast every time it stops, and one you are not following can be the one you
 * are waiting on. The bell on the row says which, per session, and the setting
 * that used to read *watched sessions* now reads this set.
 *
 * Watching a session turns its bell on, so nothing changes for a reader who
 * never touches a bell: the set is seeded exactly where the old rule looked.
 *
 * Its own file, for the reason the acknowledgements, the overrides and the
 * watch log each have one — `marks.json` is read and rewritten by the VS Code
 * extension, whose sanitiser keeps three lists of identifiers and drops
 * everything else, so anything added there survives until the other side writes
 * and then vanishes without a word.
 */

const VERSION = 1;
const FILE_NAME = 'notify.json';

export interface NotifyMarks {
  version: number;
  /** Session identifiers, in no meaningful order. */
  ids: string[];
}

export function emptyNotifyMarks(): NotifyMarks {
  return { version: VERSION, ids: [] };
}

export function sanitizeNotifyMarks(value: unknown): NotifyMarks {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const ids = Array.isArray(raw.ids)
    ? raw.ids.filter((id): id is string => typeof id === 'string' && Boolean(id))
    : [];
  return { version: typeof raw.version === 'number' ? raw.version : VERSION, ids: [...new Set(ids)] };
}

export function notifyFilePath(directory: string): string {
  return path.join(directory, FILE_NAME);
}

export class NotifyStore {
  constructor(private readonly filePath: string) {}

  async read(): Promise<NotifyMarks> {
    try {
      return sanitizeNotifyMarks(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
    } catch {
      // Missing or half-written: no bell is on, which is quieter than guessing
      // that they all are.
      return emptyNotifyMarks();
    }
  }

  /**
   * Writes the starting set, once, and only where there is no file yet.
   *
   * This is the migration and nothing else: before the bell existed, *watched*
   * was what notified, so an installation that already watches six sessions
   * should go on hearing about those six. Guarded on the file's absence rather
   * than on the set being empty, because "every bell turned off" is a state a
   * reader can choose and a restart must not undo it.
   */
  async seedIfMissing(ids: readonly string[]): Promise<NotifyMarks> {
    return withFileLock(this.filePath, async () => {
      try {
        return sanitizeNotifyMarks(JSON.parse(await fs.readFile(this.filePath, 'utf8')));
      } catch {
        const seeded = { version: VERSION, ids: [...new Set(ids)] };
        await this.write(seeded);
        return seeded;
      }
    });
  }

  /** Read, change, write back, under the lock the other shared files use. */
  async update(mutate: (marks: NotifyMarks) => void): Promise<NotifyMarks> {
    return withFileLock(this.filePath, async () => {
      const marks = await this.read();
      mutate(marks);
      marks.ids = [...new Set(marks.ids)];
      await this.write(marks);
      return marks;
    });
  }

  private async write(marks: NotifyMarks): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = temporaryPathFor(this.filePath);
    await fs.writeFile(temporary, JSON.stringify(marks), 'utf8');
    await fs.rename(temporary, this.filePath);
  }
}
