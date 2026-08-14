import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * A session waiting for you, reported by a hook rather than read from a
 * transcript.
 *
 * This is the one thing neither transcript can say. When a tool needs your
 * permission, the file ends on a tool call with no result — and so does a tool
 * that is simply taking four minutes. On disk the two are the same object,
 * which is why calling the second one "waiting for you" past a delay was tried,
 * was wrong on every slow command, and was removed.
 *
 * Both agents can be asked to say it out loud instead. Claude Code and Codex
 * each fire a `PermissionRequest` hook, and a hook that writes one small file
 * per session turns the unsayable into a fact on disk. The two write the same
 * shape into the same directory, so this reads one format and neither provider
 * gets a mechanism the other lacks — the difference from
 * `~/.claude/sessions/<pid>.json`, which was dropped precisely because only one
 * side had it.
 *
 * Nothing here is required: with no hook installed there are no files, every
 * lookup comes back empty, and the status is decided exactly as before.
 */

/** The event that means the agent has stopped and is waiting for an answer. */
export const WAITING_EVENT = 'PermissionRequest';

/** One file per session, named so a lookup needs no directory listing. */
export function reportPath(sharedDir: string, provider: string, nativeId: string): string {
  return path.join(sharedDir, 'status', `${provider}-${nativeId}.json`);
}

/**
 * When the report says the session started waiting, or nothing.
 *
 * A file that holds any other event is a session that is *not* waiting: the
 * hook overwrites the same file as the session goes on, so the last event is
 * the current one. Anything unparsable is treated the same way — a status
 * inferred from a transcript is worth more than a guess at a broken file.
 */
export function waitingAt(text: string): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const report =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  if (!report || report.event !== WAITING_EVENT || typeof report.at !== 'string') {
    return undefined;
  }
  const at = Date.parse(report.at);
  return Number.isFinite(at) ? at : undefined;
}

/**
 * Reads one session's report. Absent, unreadable or unparsable all mean the
 * same thing: nothing is known, so nothing is claimed.
 */
export function waitingReader(
  sharedDir: string,
): (provider: string, nativeId: string) => Promise<number | undefined> {
  return async (provider, nativeId) => {
    try {
      return waitingAt(await fs.readFile(reportPath(sharedDir, provider, nativeId), 'utf8'));
    } catch {
      return undefined;
    }
  };
}
