import { describe, expect, it } from 'vitest';
import { AgentSession } from '../model/types';
import { computeDelta, isEmptyDelta } from './delta';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:aaaa',
    provider: 'claude',
    nativeId: 'aaaa',
    title: 'A session',
    status: 'running',
    statusReason: 'A tool is running.',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
    filePath: '/tmp/a.jsonl',
    ...overrides,
  };
}

describe('computeDelta', () => {
  it('reports a session that appeared', () => {
    const delta = computeDelta([], [session()]);
    expect(delta.upserted.map((s) => s.id)).toEqual(['claude:aaaa']);
    expect(delta.removed).toEqual([]);
  });

  it('reports a session that left', () => {
    const delta = computeDelta([session()], []);
    expect(delta.upserted).toEqual([]);
    expect(delta.removed).toEqual(['claude:aaaa']);
  });

  it('reports a status that moved', () => {
    const delta = computeDelta([session()], [session({ status: 'idle' })]);
    expect(delta.upserted).toHaveLength(1);
  });

  it('reports a title that changed, which is how a rename reaches the browser', () => {
    expect(computeDelta([session()], [session({ title: 'Renamed' })]).upserted).toHaveLength(1);
  });

  it('says nothing when a scan re-read the same content', () => {
    const delta = computeDelta([session()], [session()]);
    expect(isEmptyDelta(delta)).toBe(true);
  });

  it('ignores a field the row does not show, so browsers are not woken for nothing', () => {
    // `nativeId` is carried but never displayed; it cannot change on its own.
    const delta = computeDelta([session()], [session({ nativeId: 'aaaa-other' })]);
    expect(isEmptyDelta(delta)).toBe(true);
  });

  it('handles an appearance, a change and a removal in the same scan', () => {
    const previous = [session(), session({ id: 'claude:bbbb', nativeId: 'bbbb' })];
    const next = [
      session({ status: 'failed' }),
      session({ id: 'claude:cccc', nativeId: 'cccc' }),
    ];
    const delta = computeDelta(previous, next);
    expect(delta.upserted.map((s) => s.id)).toEqual(['claude:aaaa', 'claude:cccc']);
    expect(delta.removed).toEqual(['claude:bbbb']);
  });
});
