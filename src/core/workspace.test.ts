import { describe, expect, it } from 'vitest';
import { normalizeWorkspacePath } from './workspace';

describe('normalizeWorkspacePath', () => {
  it('gives the same result for both drive letter cases', () => {
    const lower = normalizeWorkspacePath('c:\\Users\\dev\\projects\\webshop');
    const upper = normalizeWorkspacePath('C:\\Users\\dev\\projects\\webshop');
    expect(lower).toBe(upper);
    expect(upper).toBe('C:\\Users\\dev\\projects\\webshop');
  });

  it('drops a trailing separator, whichever it is', () => {
    expect(normalizeWorkspacePath('C:\\Users\\dev\\')).toBe('C:\\Users\\dev');
    expect(normalizeWorkspacePath('/home/dev/')).toBe('/home/dev');
  });

  it('leaves a POSIX path untouched, since it is case-sensitive', () => {
    expect(normalizeWorkspacePath('/home/dev/Webshop')).toBe('/home/dev/Webshop');
  });

  it('returns nothing when the session records no folder', () => {
    expect(normalizeWorkspacePath(undefined)).toBeUndefined();
    expect(normalizeWorkspacePath('')).toBeUndefined();
  });
});
