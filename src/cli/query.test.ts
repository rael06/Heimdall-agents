import { describe, expect, it } from 'vitest';
import { AgentSession } from '../model/types';
import { UsageError, parseArgs } from './args';
import { filtersFrom, resolveSession, resolveWorkspaces, sortFrom } from './query';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:aaaa1111',
    provider: 'claude',
    nativeId: 'aaaa1111',
    title: 'A session',
    status: 'idle',
    statusReason: 'done',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
    filePath: '/tmp/a.jsonl',
    ...overrides,
  };
}

describe('filtersFrom', () => {
  it('defaults to no filter at all', () => {
    const filters = filtersFrom(parseArgs(['list']), []);
    expect(filters).toMatchObject({ query: '', scope: 'both', statuses: [], workspaces: [] });
    expect(filters.createdFrom).toBeUndefined();
  });

  it('reads the search, its scope and the statuses', () => {
    const filters = filtersFrom(
      parseArgs(['list', '--query', 'webshop', '--scope', 'title', '--status', 'running']),
      [],
    );
    expect(filters).toMatchObject({ query: 'webshop', scope: 'title', statuses: ['running'] });
  });

  it('rejects a date that is not a day', () => {
    expect(() => filtersFrom(parseArgs(['list', '--created-from', '31/07/2026']), [])).toThrow(
      UsageError,
    );
  });

  it('keeps a valid day bound', () => {
    expect(filtersFrom(parseArgs(['list', '--created-from', '2026-07-01']), []).createdFrom).toBe(
      '2026-07-01',
    );
  });
});

describe('sortFrom', () => {
  it('defaults to the most recently created first', () => {
    expect(sortFrom(parseArgs(['list']))).toBe('created-desc');
  });

  it('rejects an unknown ordering', () => {
    expect(() => sortFrom(parseArgs(['list', '--sort', 'newest']))).toThrow(UsageError);
  });
});

describe('resolveWorkspaces', () => {
  const sessions = [
    session({ cwd: '/home/me/projects/webshop' }),
    session({ cwd: '/home/me/projects/platform' }),
    session({ cwd: undefined }),
  ];

  it('is empty when no workspace was asked for', () => {
    expect(resolveWorkspaces(parseArgs(['list']), sessions)).toEqual([]);
  });

  it('resolves a fragment to the full paths it matches', () => {
    expect(resolveWorkspaces(parseArgs(['list', '--workspace', 'websh']), sessions)).toEqual([
      '/home/me/projects/webshop',
    ]);
  });

  it('ignores case', () => {
    expect(resolveWorkspaces(parseArgs(['list', '--workspace', 'WEBSHOP']), sessions)).toEqual([
      '/home/me/projects/webshop',
    ]);
  });

  it('fails on a fragment matching nothing, rather than listing everything', () => {
    expect(() => resolveWorkspaces(parseArgs(['list', '--workspace', 'nope']), sessions)).toThrow(
      UsageError,
    );
  });
});

describe('resolveSession', () => {
  const sessions = [
    session({ id: 'claude:aaaa1111', nativeId: 'aaaa1111' }),
    session({ id: 'claude:aaaa2222', nativeId: 'aaaa2222' }),
    session({ id: 'codex:bbbb3333', nativeId: 'bbbb3333' }),
  ];

  it('finds by full identifier', () => {
    const found = resolveSession(sessions, 'claude:aaaa1111');
    expect(found).toMatchObject({ kind: 'found' });
  });

  it('finds by native identifier', () => {
    expect(resolveSession(sessions, 'bbbb3333')).toMatchObject({ kind: 'found' });
  });

  it('finds by an unambiguous prefix', () => {
    expect(resolveSession(sessions, 'bbbb')).toMatchObject({ kind: 'found' });
  });

  it('reports an ambiguous prefix rather than picking one', () => {
    const resolution = resolveSession(sessions, 'aaaa');
    expect(resolution.kind).toBe('ambiguous');
    expect(resolution.kind === 'ambiguous' && resolution.candidates).toHaveLength(2);
  });

  it('reports nothing found', () => {
    expect(resolveSession(sessions, 'zzzz')).toMatchObject({ kind: 'none' });
    expect(resolveSession(sessions, '  ')).toMatchObject({ kind: 'none' });
  });
});
