import { describe, expect, it } from 'vitest';
import { AgentSession } from '../model/types';
import { Tracked, minutesSince, trackTransitions } from './transitions';

const NOW = Date.parse('2026-07-31T12:00:00.000Z');

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:aaaa',
    provider: 'claude',
    nativeId: 'aaaa',
    title: 'A session',
    status: 'running',
    statusReason: 'A tool is running.',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T11:30:00.000Z',
    filePath: '/tmp/a.jsonl',
    ...overrides,
  };
}

describe('trackTransitions', () => {
  it('dates a session it has never seen from its last write', () => {
    const { tracked, transitions } = trackTransitions(new Map(), [session()], NOW);
    expect(tracked.get('claude:aaaa')?.changedAt).toBe(Date.parse('2026-07-31T11:30:00.000Z'));
    expect(transitions).toEqual([{ id: 'claude:aaaa', to: 'running' }]);
  });

  it('dates an observed change from now, which is exact', () => {
    const known = new Map<string, Tracked>([['claude:aaaa', { status: 'running', changedAt: 1 }]]);
    const { tracked, transitions } = trackTransitions(known, [session({ status: 'idle' })], NOW);
    expect(tracked.get('claude:aaaa')?.changedAt).toBe(NOW);
    expect(transitions).toEqual([{ id: 'claude:aaaa', from: 'running', to: 'idle' }]);
  });

  it('keeps the original date while the status holds, so the count keeps climbing', () => {
    const known = new Map<string, Tracked>([['claude:aaaa', { status: 'running', changedAt: 42 }]]);
    const { tracked, transitions } = trackTransitions(known, [session()], NOW);
    expect(tracked.get('claude:aaaa')?.changedAt).toBe(42);
    expect(transitions).toEqual([]);
  });

  it('forgets a session that left the list', () => {
    const known = new Map<string, Tracked>([['claude:gone', { status: 'running', changedAt: 1 }]]);
    expect(trackTransitions(known, [session()], NOW).tracked.has('claude:gone')).toBe(false);
  });

  it('falls back to now when the last write is unreadable', () => {
    const { tracked } = trackTransitions(new Map(), [session({ updatedAt: 'nonsense' })], NOW);
    expect(tracked.get('claude:aaaa')?.changedAt).toBe(NOW);
  });
});

describe('minutesSince', () => {
  it('counts whole minutes', () => {
    expect(minutesSince(NOW - 5 * 60000, NOW)).toBe(5);
    expect(minutesSince(NOW - 59000, NOW)).toBe(0);
    expect(minutesSince(NOW - 24 * 60 * 60000, NOW)).toBe(1440);
  });

  it('never goes negative, whatever the clock of the machine that wrote it', () => {
    expect(minutesSince(NOW + 60000, NOW)).toBe(0);
  });
});
