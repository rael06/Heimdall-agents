import { describe, expect, it } from 'vitest';
import { parseRolloutFileName } from './codex';

describe('parseRolloutFileName', () => {
  it('extracts the session id and the creation date', () => {
    const parsed = parseRolloutFileName(
      'rollout-2026-07-27T13-35-38-019fa35b-eb9b-7002-a6cf-8c7a67429d26.jsonl',
    );
    expect(parsed.id).toBe('019fa35b-eb9b-7002-a6cf-8c7a67429d26');
    expect(parsed.createdAtMs).toBe(Date.parse('2026-07-27T13:35:38'));
  });

  it('returns nothing for an unexpected file name', () => {
    expect(parseRolloutFileName('session.jsonl')).toEqual({});
  });
});
