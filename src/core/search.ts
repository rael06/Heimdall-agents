import { forEachLine } from './jsonl';
import { normalize } from './text';

/**
 * Local full text search: the file is streamed and abandoned as soon as every
 * term has been seen. No content is kept in memory or sent anywhere.
 */
export async function fileContainsAllTerms(filePath: string, terms: string[]): Promise<boolean> {
  if (terms.length === 0) {
    return true;
  }
  const remaining = new Set(terms);
  await forEachLine(filePath, (line) => {
    const normalized = normalize(line);
    for (const term of [...remaining]) {
      if (normalized.includes(term)) {
        remaining.delete(term);
      }
    }
    return remaining.size > 0;
  });
  return remaining.size === 0;
}

/** Cache of full text searches, invalidated as soon as the file changes. */
export class ContentSearchCache {
  private readonly entries = new Map<string, boolean>();

  constructor(private readonly maxEntries = 2000) {}

  private key(filePath: string, mtimeMs: number, terms: string[]): string {
    return `${filePath}::${mtimeMs}::${terms.join(' ')}`;
  }

  async match(filePath: string, mtimeMs: number, terms: string[]): Promise<boolean> {
    const key = this.key(filePath, mtimeMs, terms);
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const result = await fileContainsAllTerms(filePath, terms);
    if (this.entries.size >= this.maxEntries) {
      this.entries.clear();
    }
    this.entries.set(key, result);
    return result;
  }

  clear(): void {
    this.entries.clear();
  }
}
