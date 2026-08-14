import { describe, expect, it } from 'vitest';
import { WAITING_EVENT, reportPath, waitingAt } from './attention';

/**
 * The exact shape the hook writes, taken from a file on disk rather than
 * invented here — a fixture that does not match what is actually written is a
 * test of nothing.
 */
const report = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    version: 1,
    provider: 'claude',
    sessionId: '72f48e23-4660-4b73-b4e2-a086c509a7eb',
    event: WAITING_EVENT,
    at: '2026-08-14T12:00:21.971Z',
    ...over,
  });

describe('waitingAt', () => {
  it('reads the moment the session started waiting', () => {
    expect(waitingAt(report())).toBe(Date.parse('2026-08-14T12:00:21.971Z'));
  });

  it('says nothing for any other event', () => {
    // The hook overwrites the same file as the session goes on, so an event
    // that is not the one means the session has moved past it.
    expect(waitingAt(report({ event: 'Stop' }))).toBeUndefined();
    expect(waitingAt(report({ event: 'UserPromptSubmit' }))).toBeUndefined();
  });

  it('says nothing rather than guessing at a broken file', () => {
    expect(waitingAt('')).toBeUndefined();
    expect(waitingAt('{')).toBeUndefined();
    expect(waitingAt('null')).toBeUndefined();
    expect(waitingAt('"a string"')).toBeUndefined();
    expect(waitingAt(report({ at: undefined }))).toBeUndefined();
    expect(waitingAt(report({ at: 'the day before yesterday' }))).toBeUndefined();
    expect(waitingAt(report({ at: 1786708821212 }))).toBeUndefined();
  });
});

describe('reportPath', () => {
  it('names one file per session, so a lookup needs no directory listing', () => {
    expect(reportPath('/shared', 'claude', 'abc')).toMatch(/status[\\/]claude-abc\.json$/);
    expect(reportPath('/shared', 'codex', 'abc')).toMatch(/status[\\/]codex-abc\.json$/);
  });
});
