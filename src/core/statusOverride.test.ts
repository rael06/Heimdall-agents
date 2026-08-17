import { describe, expect, it } from 'vitest';
import { StatusOverride, overrideReason, releaseOvertaken } from './statusOverride';

const set = (status: StatusOverride['status'], inferred: StatusOverride['inferred']) => ({
  status,
  inferred,
  at: '2026-08-17T20:47:00.000Z',
});

describe('releaseOvertaken', () => {
  it('keeps a correction while the transcript still says what it disagreed with', () => {
    const { kept, released } = releaseOvertaken(
      { a: set('idle', 'running') },
      new Map([['a', 'running' as const]]),
    );
    expect(Object.keys(kept)).toEqual(['a']);
    expect(released).toEqual([]);
  });

  it('drops it the moment the transcript says something else', () => {
    // The whole point: a session marked idle that went back to work must say so
    // rather than keep repeating the correction.
    const { kept, released } = releaseOvertaken(
      { a: set('idle', 'running') },
      new Map([['a', 'failed' as const]]),
    );
    expect(kept).toEqual({});
    expect(released).toEqual(['a']);
  });

  it('is not fooled by a correction that agrees with the inference', () => {
    // Setting `idle` on a session already inferred `idle` is legitimate — it
    // pins that verdict — and it is released like any other when it changes.
    const { released } = releaseOvertaken(
      { a: set('idle', 'idle') },
      new Map([['a', 'running' as const]]),
    );
    expect(released).toEqual(['a']);
  });

  it('keeps an entry for a session it cannot see', () => {
    // Outside the history window is not the same as gone, and dropping it would
    // lose the correction for a session that comes back.
    const { kept, released } = releaseOvertaken({ a: set('idle', 'running') }, new Map());
    expect(Object.keys(kept)).toEqual(['a']);
    expect(released).toEqual([]);
  });
});

describe('overrideReason', () => {
  it('says it was set by hand, and what the transcript says instead', () => {
    const reason = overrideReason(set('idle', 'running'), 'A tool is running.');
    expect(reason).toMatch(/set by you/i);
    expect(reason).toContain('running');
    expect(reason).toContain('A tool is running.');
  });
});
