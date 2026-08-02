import { describe, expect, it } from 'vitest';
import { RolloutFragment, groupFragments, isInjectedContext } from './codexThread';

function fragment(overrides: Partial<RolloutFragment> & { filePath: string }): RolloutFragment {
  return {
    threadId: 'thread-1',
    isSubagent: false,
    createdAtMs: 1_000,
    mtimeMs: 1_000,
    sizeBytes: 100,
    ...overrides,
  };
}

describe('groupFragments', () => {
  it('merges sub-agent transcripts into their parent thread', () => {
    const threads = groupFragments([
      fragment({ filePath: 'main.jsonl', createdAtMs: 100, mtimeMs: 100 }),
      fragment({ filePath: 'guardian.jsonl', isSubagent: true, createdAtMs: 200, mtimeMs: 500 }),
      fragment({ filePath: 'worker.jsonl', isSubagent: true, createdAtMs: 300, mtimeMs: 300 }),
    ]);

    expect(threads).toHaveLength(1);
    expect(threads[0].primary.filePath).toBe('main.jsonl');
    expect(threads[0].subagents).toHaveLength(2);
  });

  it('keeps the thread active while a sub-agent is still writing', () => {
    const threads = groupFragments([
      fragment({ filePath: 'main.jsonl', createdAtMs: 100, mtimeMs: 100 }),
      fragment({ filePath: 'guardian.jsonl', isSubagent: true, createdAtMs: 200, mtimeMs: 900 }),
    ]);

    expect(threads[0].createdAtMs).toBe(100);
    expect(threads[0].mtimeMs).toBe(900);
  });

  it('keeps the oldest user fragment as primary when a thread was resumed', () => {
    const threads = groupFragments([
      fragment({ filePath: 'resumed.jsonl', createdAtMs: 900 }),
      fragment({ filePath: 'original.jsonl', createdAtMs: 100 }),
    ]);

    expect(threads[0].primary.filePath).toBe('original.jsonl');
    expect(threads[0].subagents.map((item) => item.filePath)).toEqual(['resumed.jsonl']);
  });

  it('separates distinct threads', () => {
    const threads = groupFragments([
      fragment({ filePath: 'a.jsonl', threadId: 'a' }),
      fragment({ filePath: 'b.jsonl', threadId: 'b' }),
    ]);

    expect(threads.map((thread) => thread.threadId).sort()).toEqual(['a', 'b']);
  });

  it('drops sub-agents whose parent thread is out of scope', () => {
    const orphans = [fragment({ filePath: 'orphan.jsonl', isSubagent: true })];
    expect(groupFragments(orphans)).toHaveLength(0);
  });

  it('keeps orphan sub-agents when the user asks for them', () => {
    const orphans = [
      fragment({ filePath: 'orphan.jsonl', isSubagent: true, createdAtMs: 10 }),
      fragment({ filePath: 'orphan-2.jsonl', isSubagent: true, createdAtMs: 20 }),
    ];
    const threads = groupFragments(orphans, true);
    expect(threads).toHaveLength(1);
    expect(threads[0].primary.filePath).toBe('orphan.jsonl');
  });
});

describe('isInjectedContext', () => {
  it('recognizes the context Codex injects as user messages', () => {
    expect(isInjectedContext('# AGENTS.md instructions for C:\\Users\\dev')).toBe(true);
    expect(isInjectedContext('<recommended_plugins> Here is a list')).toBe(true);
    expect(isInjectedContext('  <environment_context>')).toBe(true);
  });

  it('leaves a genuine prompt alone', () => {
    expect(isInjectedContext('Review PR 1585')).toBe(false);
    expect(isInjectedContext('# Refactor the parser')).toBe(false);
  });
});
