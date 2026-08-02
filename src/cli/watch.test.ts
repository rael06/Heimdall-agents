import { describe, expect, it } from 'vitest';
import { AgentSession } from '../model/types';
import { diffSessions, remember, renderChange } from './watch';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:aaaa1111',
    provider: 'claude',
    nativeId: 'aaaa1111',
    title: 'A session',
    status: 'running',
    statusReason: 'still writing',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
    filePath: '/tmp/a.jsonl',
    ...overrides,
  };
}

describe('diffSessions', () => {
  it('reports a session it has never seen', () => {
    expect(diffSessions(new Map(), [session()])).toEqual([
      { kind: 'appeared', session: session() },
    ]);
  });

  it('reports a status that moved, with where it came from', () => {
    const seen = remember([session({ status: 'running' })]);
    const changes = diffSessions(seen, [session({ status: 'idle' })]);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'status', from: 'running' });
  });

  it('says nothing about a session that did not move', () => {
    const seen = remember([session()]);
    expect(diffSessions(seen, [session()])).toEqual([]);
  });

  it('says nothing about a session that left the list', () => {
    const seen = remember([session(), session({ id: 'claude:bbbb', nativeId: 'bbbb' })]);
    expect(diffSessions(seen, [session()])).toEqual([]);
  });
});

describe('renderChange', () => {
  const atMs = new Date(2026, 6, 31, 14, 5, 9).getTime();

  it('shows the transition of a known session', () => {
    const change = diffSessions(remember([session({ status: 'running' })]), [
      session({ status: 'idle' }),
    ])[0];
    expect(renderChange(change, atMs)).toBe('14:05:09  aaaa1111  running -> idle  -  A session');
  });

  it('marks a session that just appeared', () => {
    const change = diffSessions(new Map(), [session({ cwd: '/home/me/webshop' })])[0];
    expect(renderChange(change, atMs)).toBe('14:05:09  aaaa1111  new running  webshop  A session');
  });
});
