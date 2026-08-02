import { describe, expect, it } from 'vitest';
import { applyStatusChanges, sanitizeAcks } from './acks';

describe('sanitizeAcks', () => {
  it('keeps a valid list, without duplicates', () => {
    expect(sanitizeAcks({ version: 1, unacknowledged: ['a', 'b', 'a'] }).unacknowledged).toEqual([
      'a',
      'b',
    ]);
  });

  it('drops anything that is not an identifier', () => {
    expect(sanitizeAcks({ unacknowledged: ['a', 3, null, ''] }).unacknowledged).toEqual(['a']);
  });

  it('falls back to empty for anything unreadable', () => {
    expect(sanitizeAcks(null).unacknowledged).toEqual([]);
    expect(sanitizeAcks({ unacknowledged: 'a' }).unacknowledged).toEqual([]);
  });
});

describe('applyStatusChanges', () => {
  it('lights a session that stopped', () => {
    expect(applyStatusChanges([], [{ id: 'a', from: 'running', to: 'idle' }])).toEqual(['a']);
    expect(applyStatusChanges([], [{ id: 'a', from: 'running', to: 'failed' }])).toEqual(['a']);
    expect(applyStatusChanges([], [{ id: 'a', from: 'running', to: 'unknown' }])).toEqual(['a']);
  });

  it('clears a session that started working, since that is nothing to read', () => {
    expect(applyStatusChanges(['a'], [{ id: 'a', from: 'idle', to: 'running' }])).toEqual([]);
  });

  it('says nothing about a status that did not change', () => {
    expect(applyStatusChanges([], [{ id: 'a', from: 'idle', to: 'idle' }])).toEqual([]);
    expect(applyStatusChanges(['a'], [{ id: 'a', from: 'running', to: 'running' }])).toEqual(['a']);
  });

  it('does not light a session merely because it was seen for the first time', () => {
    // Otherwise a cold start marks the whole history unseen, which says nothing.
    expect(applyStatusChanges([], [{ id: 'a', to: 'idle' }])).toEqual([]);
  });

  it('lights a session moving between two stopped statuses', () => {
    expect(applyStatusChanges([], [{ id: 'a', from: 'idle', to: 'failed' }])).toEqual(['a']);
  });

  it('keeps what was already unseen', () => {
    expect(
      applyStatusChanges(['a'], [{ id: 'b', from: 'running', to: 'idle' }]).sort(),
    ).toEqual(['a', 'b']);
  });
});
