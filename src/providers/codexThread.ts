/**
 * Codex writes one rollout file per thread *and* one per sub-agent it spawns, so
 * a single user conversation is spread across several files. Fragments carry the
 * thread identity in `payload.session_id` and are flagged with
 * `thread_source: "subagent"` plus a `parent_thread_id`.
 *
 * This module holds the pure logic that turns a flat list of rollout fragments
 * back into threads, so it can be unit tested without touching the disk.
 */

export interface RolloutFragment {
  filePath: string;
  /** Identity of the conversation this fragment belongs to. */
  threadId: string;
  /** True when the fragment is a sub-agent transcript, not the user thread. */
  isSubagent: boolean;
  createdAtMs: number;
  mtimeMs: number;
  sizeBytes: number;
}

export interface RolloutThread {
  threadId: string;
  /** Fragment holding the user side of the conversation. */
  primary: RolloutFragment;
  /** Sub-agent transcripts attached to the same thread. */
  subagents: RolloutFragment[];
  /** Earliest creation across the thread. */
  createdAtMs: number;
  /** Most recent write across the thread, sub-agents included. */
  mtimeMs: number;
  /**
   * Bytes across the thread, which is what actually tells an append apart.
   *
   * Windows freezes the modification time of a file its writer keeps open, and
   * Codex holds its rollout open for the whole session — so the clock alone
   * says "nothing changed" while lines are being written.
   */
  sizeBytes: number;
}

/**
 * Groups fragments by thread. A thread without any user fragment only exists
 * through its sub-agents; `includeOrphanSubagents` decides whether it is kept,
 * so an orphan transcript is never silently lost when the user asks for it.
 */
export function groupFragments(
  fragments: RolloutFragment[],
  includeOrphanSubagents = false,
): RolloutThread[] {
  const byThread = new Map<string, RolloutFragment[]>();
  for (const fragment of fragments) {
    const bucket = byThread.get(fragment.threadId);
    if (bucket) {
      bucket.push(fragment);
    } else {
      byThread.set(fragment.threadId, [fragment]);
    }
  }

  const threads: RolloutThread[] = [];
  for (const [threadId, bucket] of byThread) {
    const userFragments = bucket.filter((fragment) => !fragment.isSubagent);
    const subagents = bucket.filter((fragment) => fragment.isSubagent);

    // Several user fragments happen when a thread is resumed: the oldest one
    // carries the original prompt, so it stays the primary.
    const primary = userFragments.sort((a, b) => a.createdAtMs - b.createdAtMs)[0];
    if (!primary) {
      if (!includeOrphanSubagents || subagents.length === 0) {
        continue;
      }
      const [orphan, ...rest] = subagents.sort((a, b) => a.createdAtMs - b.createdAtMs);
      threads.push({
        threadId,
        primary: orphan,
        subagents: rest,
        createdAtMs: orphan.createdAtMs,
        mtimeMs: Math.max(...bucket.map((fragment) => fragment.mtimeMs)),
        sizeBytes: bucket.reduce((total, fragment) => total + fragment.sizeBytes, 0),
      });
      continue;
    }

    threads.push({
      threadId,
      primary,
      subagents: [...subagents, ...userFragments.slice(1)],
      createdAtMs: primary.createdAtMs,
      // A thread is still active while one of its sub-agents is writing.
      mtimeMs: Math.max(...bucket.map((fragment) => fragment.mtimeMs)),
      sizeBytes: bucket.reduce((total, fragment) => total + fragment.sizeBytes, 0),
    });
  }

  return threads;
}

/**
 * Codex injects context as user messages (AGENTS.md, plugin lists, environment
 * blocks). They must never be mistaken for the prompt when falling back to the
 * first user message for a title.
 */
export function isInjectedContext(text: string): boolean {
  const trimmed = text.trimStart();
  return (
    trimmed.startsWith('<') ||
    /^#+\s*AGENTS\.md\b/i.test(trimmed) ||
    /^#+\s*(user_instructions|environment_context)\b/i.test(trimmed)
  );
}
