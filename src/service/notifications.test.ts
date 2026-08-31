import { describe, expect, it } from 'vitest';
import { SessionStatus } from '../model/types';
import { NotifyPolicy, chooseNotifications } from './notifications';
import { Transition } from './transitions';

const on = (...statuses: SessionStatus[]): NotifyPolicy => ({
  enabled: true,
  on: new Set(statuses),
  scope: 'watched',
});

function decide(
  transitions: Transition[],
  options: {
    watched?: string[];
    unacknowledged?: string[];
    notified?: string[];
    policy?: NotifyPolicy;
  } = {},
) {
  return chooseNotifications({
    transitions,
    // The scope that used to read the watched set reads the bells now, and the
    // helper's option keeps its old name: every test below is about the same
    // question — may this session speak — and renaming them would only make the
    // diff look like a change of behaviour.
    notifying: new Set(options.watched ?? ['a']),
    unacknowledged: new Set(options.unacknowledged ?? ['a']),
    notified: new Set(options.notified ?? []),
    policy: options.policy ?? on('idle'),
  });
}

describe('chooseNotifications', () => {
  it('notifies when a watched session stops working', () => {
    expect(decide([{ id: 'a', from: 'running', to: 'idle' }]).notify).toEqual(['a']);
  });

  it('says nothing about a status nobody asked to hear about', () => {
    expect(decide([{ id: 'a', from: 'running', to: 'failed' }]).notify).toEqual([]);
  });

  it('notifies about a failed turn when that was asked for', () => {
    expect(
      decide([{ id: 'a', from: 'running', to: 'failed' }], {
        policy: on('idle', 'failed'),
      }).notify,
    ).toEqual(['a']);
  });

  it('stays silent for a session dismissed with the eye', () => {
    expect(decide([{ id: 'a', from: 'running', to: 'idle' }], { watched: [] }).notify).toEqual(
      [],
    );
  });

  it('notifies at most once per turn', () => {
    const first = decide([{ id: 'a', from: 'running', to: 'idle' }]);
    expect(first.notify).toEqual(['a']);
    const second = decide([{ id: 'a', from: 'unknown', to: 'idle' }], {
      notified: [...first.notified],
    });
    expect(second.notify).toEqual([]);
  });

  it('notifies again once the session has run again, because that is a new turn', () => {
    const after = decide(
      [
        { id: 'a', from: 'idle', to: 'running' },
        { id: 'a', from: 'running', to: 'idle' },
      ],
      { notified: ['a'] },
    );
    expect(after.notify).toEqual(['a']);
  });

  it('notifies on the unacknowledged marker instead, when asked to', () => {
    // Not watched at all: with the default scope this session is silent, and it
    // is exactly the case a session already running before the service started
    // falls into.
    const policy: NotifyPolicy = { ...on('idle'), scope: 'unacknowledged' };
    expect(
      decide([{ id: 'a', from: 'running', to: 'idle' }], { watched: [], policy }).notify,
    ).toEqual(['a']);
  });

  it('stays silent under that scope once the session has been acknowledged', () => {
    const policy: NotifyPolicy = { ...on('idle'), scope: 'unacknowledged' };
    expect(
      decide([{ id: 'a', from: 'running', to: 'idle' }], {
        watched: [],
        unacknowledged: [],
        policy,
      }).notify,
    ).toEqual([]);
  });

  it('ignores the eye under that scope: acknowledging is what silences a session', () => {
    const policy: NotifyPolicy = { ...on('idle'), scope: 'unacknowledged' };
    expect(
      decide([{ id: 'a', from: 'running', to: 'idle' }], {
        watched: [],
        unacknowledged: ['a'],
        policy,
      }).notify,
    ).toEqual(['a']);
  });

  it('says nothing at all when notifications are switched off', () => {
    expect(
      decide([{ id: 'a', from: 'running', to: 'idle' }], {
        policy: { enabled: false, on: new Set(['idle'] as SessionStatus[]), scope: 'watched' },
      }).notify,
    ).toEqual([]);
  });

  it('does not notify for a session it is seeing for the first time', () => {
    // A cold start would otherwise raise a toast for the whole history.
    expect(decide([{ id: 'a', to: 'idle' }]).notify).toEqual([]);
  });

  it('does not notify when the status held', () => {
    expect(decide([{ id: 'a', from: 'idle', to: 'idle' }]).notify).toEqual([]);
  });

  it('clears the turn marker even while switched off, so resuming is not a flood', () => {
    const result = decide([{ id: 'a', from: 'idle', to: 'running' }], {
      notified: ['a'],
      policy: { enabled: false, on: new Set(), scope: 'watched' },
    });
    expect(result.notified.has('a')).toBe(false);
  });
});
