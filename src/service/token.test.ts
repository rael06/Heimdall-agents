import { describe, expect, it } from 'vitest';
import { mintToken, parseServiceFile, serviceUrl, tokenMatches } from './token';

describe('mintToken', () => {
  it('is long enough not to be guessed, and different every time', () => {
    const first = mintToken();
    expect(first).toHaveLength(64);
    expect(first).not.toBe(mintToken());
  });
});

describe('parseServiceFile', () => {
  const valid = { host: '127.0.0.1', port: 27600, token: 'abc', pid: 42, startedAt: 'now' };

  it('accepts a complete file', () => {
    expect(parseServiceFile(valid)).toEqual(valid);
  });

  it('tolerates a missing pid and date, which are only informative', () => {
    expect(parseServiceFile({ host: '127.0.0.1', port: 27600, token: 'abc' })).toMatchObject({
      pid: 0,
      startedAt: '',
    });
  });

  it('refuses a file without a token, since the token is the whole protection', () => {
    expect(parseServiceFile({ ...valid, token: '' })).toBeUndefined();
  });

  it('refuses a port that is not a port', () => {
    expect(parseServiceFile({ ...valid, port: 0 })).toBeUndefined();
    expect(parseServiceFile({ ...valid, port: 70000 })).toBeUndefined();
    expect(parseServiceFile({ ...valid, port: '27600' })).toBeUndefined();
  });

  it('refuses anything that is not an object', () => {
    expect(parseServiceFile(null)).toBeUndefined();
    expect(parseServiceFile('27600')).toBeUndefined();
  });
});

describe('serviceUrl', () => {
  it('carries the token, since the page cannot read the file', () => {
    expect(serviceUrl({ host: '127.0.0.1', port: 27600, token: 'abc' })).toBe(
      'http://127.0.0.1:27600/?token=abc',
    );
  });
});

describe('tokenMatches', () => {
  it('accepts the expected token', () => {
    expect(tokenMatches('abcdef', 'abcdef')).toBe(true);
  });

  it('refuses a wrong one, a prefix, and nothing at all', () => {
    expect(tokenMatches('abcdef', 'abcdeg')).toBe(false);
    expect(tokenMatches('abcdef', 'abc')).toBe(false);
    expect(tokenMatches('abcdef', undefined)).toBe(false);
    expect(tokenMatches('abcdef', '')).toBe(false);
  });
});
