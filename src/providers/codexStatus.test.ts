import { describe, expect, it } from 'vitest';
import { hasPendingToolCall, inferCodexStatus } from './codexStatus';
import { ScanOptions } from './provider';

const options: ScanOptions = {
  now: Date.now(),
  staleAfterMs: 3 * 60 * 60 * 1000,
  historyMs: 0,
  maxSessions: 100,
};

const FRESH = 1_000;
const IDLE = 10 * 60 * 1000;
const OLD = 24 * 60 * 60 * 1000;

const event = (type: string, extra: Record<string, unknown> = {}) => ({
  type: 'event_msg',
  payload: { type, ...extra },
});

const item = (type: string, extra: Record<string, unknown> = {}) => ({
  type: 'response_item',
  payload: { type, ...extra },
});

describe('hasPendingToolCall', () => {
  it('detects a call without output', () => {
    expect(hasPendingToolCall([item('function_call', { call_id: '1' })])).toBe(true);
  });

  it('ignores an already resolved call', () => {
    expect(
      hasPendingToolCall([
        item('function_call', { call_id: '1' }),
        item('function_call_output', { call_id: '1' }),
      ]),
    ).toBe(false);
  });
});

describe('inferCodexStatus', () => {
  it('goes idle on task_complete', () => {
    expect(
      inferCodexStatus([event('task_started'), event('task_complete')], OLD, options).status,
    ).toBe('idle');
  });

  it('says the same thing when the turn ended on a question', () => {
    // Codex has no tool for asking, so it finishes its turn to put the question
    // to you. One event covers both, and no text is searched for a question.
    const tail = [event('task_complete', { last_agent_message: 'Done.\n\nReponds par 1, 2 ou 3.' })];
    expect(inferCodexStatus(tail, OLD, options).status).toBe('idle');
  });

  it('goes back to running when a new turn starts', () => {
    const tail = [event('task_complete'), event('task_started')];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('running');
  });

  it('reports a failure on an interruption', () => {
    const tail = [event('task_started'), event('turn_aborted', { reason: 'interrupted' })];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('failed');
  });

  it('reports a failure on an error event', () => {
    expect(inferCodexStatus([event('error', { message: 'boom' })], FRESH, options).status).toBe(
      'failed',
    );
  });

  it('never turns a long tool call into a pending approval', () => {
    // Codex writes an approval prompt nowhere: zero occurrences over 104
    // sessions and about 32 000 events. So a call that has not returned is a
    // call that has not returned, and nothing more can honestly be said.
    const tail = [event('task_started'), item('function_call', { call_id: '1' })];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('running');
    expect(inferCodexStatus(tail, IDLE, options).status).toBe('running');
    expect(inferCodexStatus(tail, OLD, options).status).toBe('unknown');
  });

  it('keeps a turn open until Codex itself closes it', () => {
    // `task_started` with no matching `task_complete` is Codex stating the turn
    // is open, which a long thinking phase must not be allowed to contradict.
    const tail = [event('task_started')];
    expect(inferCodexStatus(tail, IDLE, options).status).toBe('running');
    expect(inferCodexStatus(tail, OLD, options).status).toBe('unknown');
  });

  it('walks past unknown events instead of giving up', () => {
    const tail = [event('task_complete'), event('token_count'), event('some_future_event')];
    expect(inferCodexStatus(tail, OLD, options).status).toBe('idle');
  });

  it('stays unknown when nothing is usable', () => {
    expect(inferCodexStatus([], FRESH, options).status).toBe('unknown');
  });
});
