import { describe, expect, it } from 'vitest';
import {
  AgentSession,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  NO_MARKS,
  SessionStatus,
  normalizeSort,
} from '../model/types';
import {
  applyStructuralFilters,
  compareSessions,
  comparatorFor,
  hasActiveFilters,
  selectSessions,
  withMarksFirst,
} from './filter';

function session(overrides: Partial<AgentSession> & { id: string }): AgentSession {
  return {
    provider: 'claude',
    nativeId: overrides.id,
    title: 'Session',
    status: 'idle',
    statusReason: '',
    createdAt: '2026-07-01T10:00:00.000Z',
    updatedAt: '2026-07-01T10:00:00.000Z',
    filePath: `/tmp/${overrides.id}.jsonl`,
    ...overrides,
  };
}

describe('compareSessions', () => {
  it('orders running, failed, idle, unknown', () => {
    const order: SessionStatus[] = ['unknown', 'idle', 'failed', 'running'];
    const sessions = order.map((status, index) => session({ id: `s${index}`, status }));
    const sorted = [...sessions].sort(compareSessions).map((item) => item.status);
    expect(sorted).toEqual(['running', 'failed', 'idle', 'unknown']);
  });

  it('puts the most recently active session first within a status', () => {
    const older = session({ id: 'a', updatedAt: '2026-07-01T10:00:00.000Z' });
    const newer = session({ id: 'b', updatedAt: '2026-07-02T10:00:00.000Z' });
    expect([older, newer].sort(compareSessions)[0].id).toBe('b');
  });
});

describe('comparatorFor', () => {
  const sessions = [
    session({ id: 'old', title: 'B', createdAt: '2026-07-01T10:00:00.000Z', updatedAt: '2026-07-09T10:00:00.000Z' }),
    session({ id: 'mid', title: 'C', createdAt: '2026-07-05T10:00:00.000Z', updatedAt: '2026-07-06T10:00:00.000Z' }),
    session({ id: 'new', title: 'A', createdAt: '2026-07-09T10:00:00.000Z', updatedAt: '2026-07-07T10:00:00.000Z' }),
  ];

  const ids = (sort: Parameters<typeof comparatorFor>[0]) =>
    [...sessions].sort(comparatorFor(sort)).map((item) => item.id);

  it('orders by creation date, newest first, by default', () => {
    expect(ids(DEFAULT_SORT)).toEqual(['new', 'mid', 'old']);
    expect(DEFAULT_SORT).toBe('created-desc');
  });

  it('orders by creation date, oldest first', () => {
    expect(ids('created-asc')).toEqual(['old', 'mid', 'new']);
  });

  it('orders by last activity in both directions', () => {
    expect(ids('updated-desc')).toEqual(['old', 'new', 'mid']);
    expect(ids('updated-asc')).toEqual(['mid', 'new', 'old']);
  });

  it('orders by title, both ways', () => {
    expect(ids('title-asc')).toEqual(['new', 'old', 'mid']);
    expect(ids('title-desc')).toEqual(['mid', 'old', 'new']);
  });

  it('orders by provider and by workspace, so every column sorts', () => {
    expect(ids('provider-asc')).toHaveLength(3);
    expect(ids('workspace-asc')).toHaveLength(3);
  });

  it('accepts the names earlier versions wrote, so a bookmark still sorts', () => {
    expect(normalizeSort('status')).toBe('status-asc');
    expect(normalizeSort('title')).toBe('title-asc');
    expect(normalizeSort('created-desc')).toBe('created-desc');
    expect(normalizeSort('nonsense')).toBe('created-desc');
    expect(normalizeSort(undefined)).toBe('created-desc');
  });

  it('keeps the status priority ordering available', () => {
    const mixed = [
      session({ id: 'stopped', status: 'idle', updatedAt: '2026-07-10T10:00:00.000Z' }),
      session({ id: 'broken', status: 'failed', updatedAt: '2026-07-01T10:00:00.000Z' }),
    ];
    expect([...mixed].sort(comparatorFor('status-asc')).map((item) => item.id)).toEqual([
      'broken',
      'stopped',
    ]);
  });

  it('falls back to the title when the primary key ties', () => {
    const tied = [
      session({ id: 'z', title: 'Zulu', createdAt: '2026-07-01T10:00:00.000Z' }),
      session({ id: 'a', title: 'Alpha', createdAt: '2026-07-01T10:00:00.000Z' }),
    ];
    expect([...tied].sort(comparatorFor('created-desc')).map((item) => item.id)).toEqual(['a', 'z']);
  });

  it('does not crash on an unparsable date', () => {
    const broken = [
      session({ id: 'broken', createdAt: 'not-a-date' }),
      session({ id: 'valid', createdAt: '2026-07-01T10:00:00.000Z' }),
    ];
    expect([...broken].sort(comparatorFor('created-desc')).map((item) => item.id)).toEqual([
      'valid',
      'broken',
    ]);
  });
});

describe('withMarksFirst', () => {
  const older = session({ id: 'old', title: 'B', createdAt: '2026-07-01T10:00:00.000Z' });
  const newer = session({ id: 'new', title: 'A', createdAt: '2026-07-09T10:00:00.000Z' });
  const marks = (watched: string[], favorites: string[]) => ({
    watched: new Set(watched),
    favorites: new Set(favorites),
  });

  it('lifts starred sessions above the others', () => {
    const comparator = withMarksFirst(comparatorFor('created-desc'), marks([], ['old']));
    expect([newer, older].sort(comparator).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('lifts watched sessions above the starred ones', () => {
    const comparator = withMarksFirst(comparatorFor('created-desc'), marks(['old'], ['new']));
    expect([newer, older].sort(comparator).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('keeps the chosen ordering inside each group', () => {
    const alsoOld = session({ id: 'old-2', title: 'C', createdAt: '2026-07-05T10:00:00.000Z' });
    const comparator = withMarksFirst(comparatorFor('created-desc'), marks([], ['old', 'old-2']));
    expect([newer, older, alsoOld].sort(comparator).map((item) => item.id)).toEqual([
      'old-2',
      'old',
      'new',
    ]);
  });

  it('leaves the comparator untouched when nothing is marked', () => {
    const comparator = comparatorFor('created-desc');
    expect(withMarksFirst(comparator, NO_MARKS)).toBe(comparator);
  });
});

describe('applyStructuralFilters', () => {
  const sessions = [
    session({ id: 'a', status: 'running', provider: 'claude', createdAt: '2026-07-01T08:00:00' }),
    session({ id: 'b', status: 'idle', provider: 'codex', createdAt: '2026-07-05T08:00:00' }),
    session({
      id: 'c',
      status: 'failed',
      provider: 'codex',
      createdAt: '2026-07-10T08:00:00',
    }),
  ];

  it('filters by status', () => {
    const kept = applyStructuralFilters(sessions, { ...EMPTY_FILTERS, statuses: ['failed'] });
    expect(kept.map((item) => item.id)).toEqual(['c']);
  });

  it('filters by provider', () => {
    const kept = applyStructuralFilters(sessions, { ...EMPTY_FILTERS, providers: ['codex'] });
    expect(kept.map((item) => item.id)).toEqual(['b', 'c']);
  });

  it('combines the active filters with AND by default', () => {
    const kept = applyStructuralFilters(sessions, {
      ...EMPTY_FILTERS,
      statuses: ['failed'],
      providers: ['claude'],
    });
    // Nothing is both, so narrowing gives nothing.
    expect(kept).toEqual([]);
  });

  it('widens instead of narrowing when asked for any', () => {
    const kept = applyStructuralFilters(sessions, {
      ...EMPTY_FILTERS,
      match: 'any',
      statuses: ['failed'],
      providers: ['claude'],
    });
    expect(kept.map((item) => item.id).sort()).toEqual(['a', 'c']);
  });

  it('ignores a filter that is switched off, in either mode', () => {
    // An inactive filter must not count as a condition that "matched", or `any`
    // would return the whole list whatever else was asked for.
    for (const match of ['all', 'any'] as const) {
      const kept = applyStructuralFilters(sessions, {
        ...EMPTY_FILTERS,
        match,
        statuses: ['failed'],
      });
      expect(kept.map((item) => item.id)).toEqual(['c']);
    }
  });

  it('keeps everything when no filter is active, in either mode', () => {
    for (const match of ['all', 'any'] as const) {
      expect(applyStructuralFilters(sessions, { ...EMPTY_FILTERS, match })).toHaveLength(3);
    }
  });

  it('accepts a single inclusive date bound', () => {
    const kept = applyStructuralFilters(sessions, { ...EMPTY_FILTERS, createdFrom: '2026-07-05' });
    expect(kept.map((item) => item.id)).toEqual(['b', 'c']);
  });

  it('accepts a full inclusive range', () => {
    const kept = applyStructuralFilters(sessions, {
      ...EMPTY_FILTERS,
      createdFrom: '2026-07-05',
      createdTo: '2026-07-05',
    });
    expect(kept.map((item) => item.id)).toEqual(['b']);
  });

  it('keeps only the starred sessions when asked', () => {
    const kept = applyStructuralFilters(
      sessions,
      { ...EMPTY_FILTERS, favoritesOnly: true },
      { watched: new Set(), favorites: new Set(['b']) },
    );
    expect(kept.map((item) => item.id)).toEqual(['b']);
  });

  it('returns nothing when nothing is starred yet', () => {
    expect(applyStructuralFilters(sessions, { ...EMPTY_FILTERS, favoritesOnly: true })).toEqual([]);
  });

  it('combines the favorites filter with the other criteria', () => {
    const kept = applyStructuralFilters(
      sessions,
      { ...EMPTY_FILTERS, favoritesOnly: true, statuses: ['running'] },
      { watched: new Set(), favorites: new Set(['a', 'b']) },
    );
    expect(kept.map((item) => item.id)).toEqual(['a']);
  });

  it('filters by workspace, and drops the sessions that have none', () => {
    const withFolders = [
      session({ id: 'a', cwd: '/home/dev/webshop' }),
      session({ id: 'b', cwd: '/home/dev/other' }),
      session({ id: 'c' }),
    ];
    const kept = applyStructuralFilters(withFolders, {
      ...EMPTY_FILTERS,
      workspaces: ['/home/dev/webshop'],
    });
    expect(kept.map((item) => item.id)).toEqual(['a']);
  });

  it('accepts several workspaces at once', () => {
    const withFolders = [
      session({ id: 'a', cwd: '/home/dev/webshop' }),
      session({ id: 'b', cwd: '/home/dev/other' }),
    ];
    const kept = applyStructuralFilters(withFolders, {
      ...EMPTY_FILTERS,
      workspaces: ['/home/dev/webshop', '/home/dev/other'],
    });
    expect(kept.map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('keeps only the watched sessions when asked', () => {
    const kept = applyStructuralFilters(
      sessions,
      { ...EMPTY_FILTERS, watchedOnly: true },
      { watched: new Set(['c']), favorites: new Set(['a']) },
    );
    expect(kept.map((item) => item.id)).toEqual(['c']);
  });

  it('combines criteria with AND', () => {
    const kept = applyStructuralFilters(sessions, {
      ...EMPTY_FILTERS,
      providers: ['codex'],
      statuses: ['idle'],
      createdTo: '2026-07-05',
    });
    expect(kept.map((item) => item.id)).toEqual(['b']);
  });
});

describe('selectSessions', () => {
  const sessions = [
    session({ id: 'a', title: 'Review of PR 42' }),
    session({ id: 'b', title: 'Déploiement staging' }),
  ];

  it('finds a session by its title, without reading its content', async () => {
    const contentReads: string[] = [];
    const matches = await selectSessions(
      sessions,
      { ...EMPTY_FILTERS, query: 'review pr' },
      DEFAULT_SORT,
      async (candidate) => {
        contentReads.push(candidate.id);
        return false;
      },
    );
    expect(matches.map((match) => match.session.id)).toEqual(['a']);
    expect(matches[0].matchedOn).toEqual(['title']);
    expect(contentReads).not.toContain('a');
  });

  it('finds a session by a term present only in its content', async () => {
    const matches = await selectSessions(
      sessions,
      { ...EMPTY_FILTERS, query: 'kubernetes' },
      DEFAULT_SORT,
      async (candidate) => candidate.id === 'b',
    );
    expect(matches.map((match) => match.session.id)).toEqual(['b']);
    expect(matches[0].matchedOn).toEqual(['content']);
  });

  it('ignores case and accents in titles', async () => {
    const matches = await selectSessions(sessions, { ...EMPTY_FILTERS, query: 'DEPLOIEMENT' });
    expect(matches.map((match) => match.session.id)).toEqual(['b']);
  });

  it('never reads the transcript when the search is limited to titles', async () => {
    const contentReads: string[] = [];
    const matches = await selectSessions(
      sessions,
      { ...EMPTY_FILTERS, query: 'kubernetes', scope: 'title' },
      DEFAULT_SORT,
      async (candidate) => {
        contentReads.push(candidate.id);
        return true;
      },
    );
    expect(matches).toHaveLength(0);
    expect(contentReads).toEqual([]);
  });

  it('ignores title matches when the search is limited to contents', async () => {
    const matches = await selectSessions(
      sessions,
      { ...EMPTY_FILTERS, query: 'review pr', scope: 'content' },
      DEFAULT_SORT,
      async (candidate) => candidate.id === 'b',
    );
    expect(matches.map((match) => match.session.id)).toEqual(['b']);
    expect(matches[0].matchedOn).toEqual(['content']);
  });

  it('restores the full list when the search is cleared', async () => {
    const matches = await selectSessions(sessions, { ...EMPTY_FILTERS });
    expect(matches).toHaveLength(2);
    expect(matches[0].matchedOn).toEqual([]);
  });
});

describe('hasActiveFilters', () => {
  it('detects the absence and the presence of criteria', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, createdTo: '2026-07-01' })).toBe(true);
    expect(hasActiveFilters({ ...EMPTY_FILTERS, scope: 'title' })).toBe(true);
  });
});
