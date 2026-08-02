import { describe, expect, it } from 'vitest';
import {
  UsageError,
  flag,
  manyOf,
  number,
  oneOf,
  parseArgs,
  unknownOptions,
  value,
  values,
} from './args';

describe('parseArgs', () => {
  it('takes the first non-option token as the command', () => {
    const args = parseArgs(['list', '--json']);
    expect(args.command).toBe('list');
    expect(args.positionals).toEqual([]);
  });

  it('keeps the remaining non-option tokens as positionals', () => {
    expect(parseArgs(['status', 'abc123']).positionals).toEqual(['abc123']);
  });

  it('has an empty command when nothing was given', () => {
    expect(parseArgs([]).command).toBe('');
  });

  it('reads --name value', () => {
    expect(value(parseArgs(['list', '--query', 'webshop']), 'query')).toBe('webshop');
  });

  it('reads --name=value, so a value may start with a dash', () => {
    expect(value(parseArgs(['list', '--query=--weird']), 'query')).toBe('--weird');
  });

  it('treats an option followed by another option as a flag', () => {
    const args = parseArgs(['list', '--json', '--query', 'x']);
    expect(flag(args, 'json')).toBe(true);
    expect(value(args, 'query')).toBe('x');
  });

  it('treats a trailing option as a flag', () => {
    expect(flag(parseArgs(['list', '--json']), 'json')).toBe(true);
  });

  it('accumulates a repeated option', () => {
    expect(values(parseArgs(['list', '--status', 'running', '--status', 'failed']), 'status')).toEqual([
      'running',
      'failed',
    ]);
  });

  it('rejects a bare --', () => {
    expect(() => parseArgs(['list', '--'])).toThrow(UsageError);
  });
});

describe('flag', () => {
  it('falls back when absent', () => {
    expect(flag(parseArgs(['list']), 'json')).toBe(false);
    expect(flag(parseArgs(['list']), 'json', true)).toBe(true);
  });

  it('accepts an explicit false, so a default-on setting can be turned off', () => {
    expect(flag(parseArgs(['list', '--detect-questions=false']), 'detect-questions', true)).toBe(false);
  });

  it('rejects a value that is not a boolean', () => {
    expect(() => flag(parseArgs(['list', '--json', 'maybe']), 'json')).toThrow(UsageError);
  });
});

describe('number', () => {
  it('parses a value and falls back when absent', () => {
    expect(number(parseArgs(['list', '--max', '50']), 'max', 300)).toBe(50);
    expect(number(parseArgs(['list']), 'max', 300)).toBe(300);
  });

  it('rejects a value that is not a positive number', () => {
    expect(() => number(parseArgs(['list', '--max', 'lots']), 'max', 300)).toThrow(UsageError);
    expect(() => number(parseArgs(['list', '--max=-1']), 'max', 300)).toThrow(UsageError);
  });
});

describe('oneOf and manyOf', () => {
  it('accepts an allowed value', () => {
    expect(oneOf(parseArgs(['list', '--sort', 'title']), 'sort', ['title', 'status'], 'status')).toBe(
      'title',
    );
  });

  it('rejects a typo rather than filtering nothing', () => {
    expect(() => oneOf(parseArgs(['list', '--sort', 'titel']), 'sort', ['title'], 'title')).toThrow(
      UsageError,
    );
    expect(() => manyOf(parseArgs(['list', '--status', 'runing']), 'status', ['running'])).toThrow(
      UsageError,
    );
  });

  it('splits a comma separated list', () => {
    expect(manyOf(parseArgs(['list', '--status', 'running,failed']), 'status', ['running', 'failed'])).toEqual(
      ['running', 'failed'],
    );
  });

  it('is empty when the option is absent', () => {
    expect(manyOf(parseArgs(['list']), 'status', ['running'])).toEqual([]);
  });
});

describe('unknownOptions', () => {
  it('reports what the command does not know about', () => {
    expect(unknownOptions(parseArgs(['list', '--json', '--nope', 'x']), ['json'])).toEqual(['nope']);
  });
});
