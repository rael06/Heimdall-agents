/** Text normalization for a case-insensitive and accent-insensitive search. */

// Unicode range of combining diacritical marks, built without non-ASCII source characters.
const COMBINING_MARKS = new RegExp('[\\u0300-\\u036f]', 'g');

export function normalize(input: string): string {
  return input.normalize('NFD').replace(COMBINING_MARKS, '').toLowerCase();
}

/** Splits user input into terms, keeping quoted groups together. */
export function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(query)) !== null) {
    const raw = match[1] ?? match[2] ?? '';
    const term = normalize(raw).trim();
    if (term) {
      tokens.push(term);
    }
  }
  return tokens;
}

/**
 * Every term must be present (AND logic). Terms are normalized here as well, so
 * the function stays correct even when called without going through `tokenize`.
 */
export function matchesAllTerms(haystack: string, terms: string[]): boolean {
  if (terms.length === 0) {
    return true;
  }
  const normalized = normalize(haystack);
  return terms.every((term) => normalized.includes(normalize(term)));
}

export function truncate(input: string, max = 120): string {
  const cleaned = input.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) {
    return cleaned;
  }
  return `${cleaned.slice(0, max - 1).trimEnd()}...`;
}
