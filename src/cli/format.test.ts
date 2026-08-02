import { describe, expect, it } from 'vitest';
import { AgentSession } from '../model/types';
import { formatDate, renderRows, shortId, workspaceLabel } from './format';

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 'claude:0123456789abcdef',
    provider: 'claude',
    nativeId: '0123456789abcdef',
    title: 'A session',
    status: 'idle',
    statusReason: 'The last turn is finished.',
    createdAt: '2026-07-31T08:00:00.000Z',
    updatedAt: '2026-07-31T09:00:00.000Z',
    filePath: '/tmp/a.jsonl',
    ...overrides,
  };
}

describe('formatDate', () => {
  it('renders an absolute local date', () => {
    // Built from local parts, so the expectation holds in any timezone.
    const iso = new Date(2026, 6, 31, 14, 5).toISOString();
    expect(formatDate(iso)).toBe('2026-07-31 14:05');
  });

  it('does not pretend to know an unparsable date', () => {
    expect(formatDate('not a date')).toBe('?');
  });
});

describe('shortId', () => {
  it('keeps the first eight characters of the native identifier', () => {
    expect(shortId(session())).toBe('01234567');
  });
});

describe('workspaceLabel', () => {
  it('shows the folder name', () => {
    expect(workspaceLabel('/home/me/projects/webshop')).toBe('webshop');
  });

  it('marks an unknown workspace rather than leaving a hole', () => {
    expect(workspaceLabel(undefined)).toBe('-');
  });
});

describe('renderRows', () => {
  it('aligns every column but the last', () => {
    expect(renderRows([['a', 'long title here'], ['bbb', 'x']])).toEqual([
      'a    long title here',
      'bbb  x',
    ]);
  });

  it('never truncates the last column', () => {
    const title = 'a'.repeat(200);
    expect(renderRows([['id', title]])[0].endsWith(title)).toBe(true);
  });

  it('renders nothing for no rows', () => {
    expect(renderRows([])).toEqual([]);
  });
});
