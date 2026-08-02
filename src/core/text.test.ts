import { describe, expect, it } from 'vitest';
import { matchesAllTerms, normalize, tokenize, truncate } from './text';

describe('normalize', () => {
  it('ignores case and accents', () => {
    expect(normalize('Créé À Noël')).toBe('cree a noel');
  });
});

describe('tokenize', () => {
  it('splits terms', () => {
    expect(tokenize('  review   PR  ')).toEqual(['review', 'pr']);
  });

  it('keeps quoted groups together', () => {
    expect(tokenize('"pull request review" urgent')).toEqual(['pull request review', 'urgent']);
  });

  it('returns an empty list for a blank query', () => {
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('matchesAllTerms', () => {
  it('requires every term (AND logic)', () => {
    expect(matchesAllTerms('Review of PR 42', ['review', 'pr'])).toBe(true);
    expect(matchesAllTerms('Review of PR 42', ['review', 'deployment'])).toBe(false);
  });

  it('accepts anything when no term is typed', () => {
    expect(matchesAllTerms('whatever', [])).toBe(true);
  });

  it('finds an accented term inside an unaccented text', () => {
    expect(matchesAllTerms('Deploiement en production', ['déploiement'])).toBe(true);
  });
});

describe('truncate', () => {
  it('collapses whitespace and cuts long values', () => {
    expect(truncate('a  b\n c', 10)).toBe('a b c');
    expect(truncate('abcdefghij', 5)).toBe('abcd...');
  });
});
