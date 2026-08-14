import { describe, expect, it } from 'vitest';
import { ScanOptions, TurnState, verdictFor } from './provider';

const NOW = Date.parse('2026-08-14T12:10:00.000Z');
const WROTE = Date.parse('2026-08-14T12:00:00.000Z');
const ASKED = Date.parse('2026-08-14T12:00:21.971Z');

const base: ScanOptions = {
  now: NOW,
  // Ten minutes have passed and the delay is five, so anything left to the
  // clock here comes back inconclusive. That is what makes the hook's effect
  // unambiguous in these tests.
  staleAfterMs: 5 * 60 * 1000,
  historyMs: 0,
  maxSessions: 100,
};

const open: TurnState = {
  kind: 'pending',
  running: 'A tool is running.',
  unknown: 'Turn interrupted during a tool call, state is inconclusive.',
};

const session = { provider: 'claude' as const, nativeId: 'abc', updatedAtMs: WROTE };
const reporting = (at: number | undefined): ScanOptions => ({
  ...base,
  waitingSince: async () => at,
});

describe('verdictFor', () => {
  it('is idle, and says so, when a hook reported a permission', async () => {
    const verdict = await verdictFor(open, session, reporting(ASKED));
    expect(verdict.status).toBe('idle');
    expect(verdict.reason).toMatch(/permission/i);
  });

  it('stays idle however long the wait, because it is still waiting', async () => {
    const later = { ...base, now: NOW + 30 * 24 * 60 * 60 * 1000, waitingSince: async () => ASKED };
    expect((await verdictFor(open, session, later)).status).toBe('idle');
  });

  it('ignores a report older than the last thing written', async () => {
    // The answer was given: the tool ran and wrote its result, which is younger
    // than the request. Nothing has to be cleaned up for this to work.
    const answered = { ...session, updatedAtMs: ASKED + 1000 };
    expect((await verdictFor(open, answered, reporting(ASKED))).status).toBe('unknown');
  });

  it('leaves a finished turn alone, whatever a stale report says', async () => {
    const ended: TurnState = { kind: 'settled', status: 'failed', reason: 'It failed.' };
    const verdict = await verdictFor(ended, session, reporting(ASKED));
    expect(verdict.status).toBe('failed');
    expect(verdict.reason).toBe('It failed.');
  });

  it('behaves exactly as before with no hook installed', async () => {
    expect((await verdictFor(open, session, base)).status).toBe('unknown');
    expect((await verdictFor(open, session, reporting(undefined))).status).toBe('unknown');
  });
});
