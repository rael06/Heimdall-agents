import { describe, expect, it } from 'vitest';
import { AgentSession, SessionStatus } from '../model/types';
import { runningIds, sessionsToAutoWatch } from './autoWatch';

function session(id: string, status: SessionStatus): AgentSession {
  return {
    id,
    provider: 'claude',
    nativeId: id,
    title: id,
    status,
    statusReason: '',
    createdAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:00:00.000Z',
    filePath: `/tmp/${id}.jsonl`,
  };
}

describe('runningIds', () => {
  it('keeps the working sessions only', () => {
    const sessions = [
      session('running', 'running'),
      session('stopped', 'idle'),
      session('broken', 'failed'),
    ];
    expect(runningIds(sessions)).toEqual(['running']);
  });
});

describe('sessionsToAutoWatch', () => {
  const sessions = [session('a', 'running'), session('stopped', 'idle')];

  it('watches a session that just started working', () => {
    expect(sessionsToAutoWatch(sessions, new Set(), new Set())).toEqual(['a']);
  });

  it('leaves a turn already under way alone, so dismissing it holds', () => {
    expect(sessionsToAutoWatch(sessions, new Set(['a']), new Set())).toEqual([]);
  });

  it('watches again when a dismissed session starts working anew', () => {
    // The session stopped, so it left the running set; resuming it is a new
    // transition, which is what makes the marker come back.
    expect(sessionsToAutoWatch(sessions, new Set(['other']), new Set())).toEqual(['a']);
  });

  it('leaves a session already watched alone', () => {
    expect(sessionsToAutoWatch(sessions, new Set(), new Set(['a']))).toEqual([]);
  });

  it('never watches a session that is only waiting for the user', () => {
    expect(sessionsToAutoWatch(sessions, new Set(), new Set())).not.toContain('waiting');
  });
});
