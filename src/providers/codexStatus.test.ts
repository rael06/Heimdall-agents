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

describe('the vocabulary Codex moved to', () => {
  it('reads an item finishing as a turn in progress', () => {
    // A newer release folds the message, the reasoning and the rest into one
    // `item_completed` carrying the real kind in `item.type`, and stops
    // emitting the three names the reader knew. Measured on a session written
    // by it: 345 entries, two of them recognised — `task_started` at the top
    // and `task_complete` at the end, 343 lines apart. The window holds 120,
    // so the row read inconclusive for most of the time it was working.
    const tail = [
      event('task_started'),
      event('item_completed', { item: { type: 'UserMessage' } }),
      event('token_count'),
      event('item_completed', { item: { type: 'AgentMessage' } }),
    ];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('running');
  });

  it('still ends the turn when Codex says the turn ended', () => {
    // `task_complete` is written last and the walk meets it first, so an item
    // finishing before it never overrules it.
    const tail = [
      event('item_completed', { item: { type: 'AgentMessage' } }),
      event('task_complete'),
    ];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('idle');
  });

  it('reads an unclosed tool call as an open turn when it knows no event at all', () => {
    // The net under the next rename: a call with no output is the file saying a
    // turn is open, in a part of it the vocabulary does not cover. Codex has
    // renamed its events once already, and the reader went on reporting
    // inconclusive for most of every session until somebody noticed.
    const tail = [
      event('some_event_from_a_later_release'),
      item('custom_tool_call', { call_id: 'c1' }),
      event('token_count'),
    ];
    const verdict = inferCodexStatus(tail, FRESH, options);
    expect(verdict.status).toBe('running');
    expect(verdict.reason).toMatch(/tool is running/i);
  });

  it('is still inconclusive when the window holds nothing at all to go on', () => {
    const tail = [event('token_count'), event('thread_settings_applied')];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('unknown');
  });
});

describe('an item recorded after its turn ended', () => {
  it('does not put a finished session back to work', () => {
    /*
     * Measured on a real rollout: a `CommandExecution` item was written nine
     * minutes past the `task_complete` of another turn, and it was the last
     * line in the file. Read by position, it says work in progress; read
     * against its own turn — which this window has seen end — it is a late
     * record of work already done.
     */
    const tail = [
      event('task_started', { turn_id: 'a' }),
      event('task_complete', { turn_id: 'a' }),
      event('item_completed', { turn_id: 'a', item: { type: 'CommandExecution' } }),
    ];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('idle');
  });

  it('still reports a turn whose own ending has not been written', () => {
    // The item belongs to a second turn, and nothing has closed that one.
    const tail = [
      event('task_started', { turn_id: 'a' }),
      event('task_complete', { turn_id: 'a' }),
      event('task_started', { turn_id: 'b' }),
      event('item_completed', { turn_id: 'b', item: { type: 'AgentMessage' } }),
    ];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('running');
  });

  it('reports an item that names no turn at all, having nothing to pair it with', () => {
    const tail = [event('task_complete', { turn_id: 'a' }), event('item_completed')];
    expect(inferCodexStatus(tail, FRESH, options).status).toBe('running');
  });
});
