import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { readHeadLines, readTailLines } from '../core/jsonl';
import { ContentSearchCache } from '../core/search';
import { truncate } from '../core/text';
import { normalizeWorkspacePath } from '../core/workspace';
import { AgentSession } from '../model/types';
import { RolloutFragment, RolloutThread, groupFragments, isInjectedContext } from './codexThread';
import { codexTurnState } from './codexStatus';
import { ScanOptions, ScanResult, SessionProvider, TurnState, verdictFor } from './provider';

/**
 * Codex stores rollout files under
 * `<codexHome>/sessions/<year>/<month>/<day>/rollout-<timestamp>-<id>.jsonl`,
 * and human readable thread names in `<codexHome>/session_index.jsonl`.
 *
 * One conversation spans several rollout files: the user thread plus one file
 * per sub-agent. Files are grouped back into threads by `codexThread.ts`.
 */

const HEAD_LINES = 80;
const TAIL_LINES = 120;
const INDEX_FILE = 'session_index.jsonl';
const MAX_INDEX_LINES = 20000;
/** Guard on how many fragments are opened before grouping and capping. */
const CANDIDATE_FACTOR = 6;

type Json = Record<string, unknown>;

interface Candidate {
  filePath: string;
  fileId: string;
  mtimeMs: number;
  birthtimeMs: number;
  sizeBytes: number;
}

/**
 * What was learned from a thread, kept until one of its files changes. The
 * status is deliberately absent: it is graded again on every scan, since a
 * session ages without being written to.
 */
interface CachedSession {
  /** {@link fingerprint} of the thread when it was read. */
  fingerprint: string;
  session: Omit<AgentSession, 'status' | 'statusReason'>;
  turnState: TurnState;
  updatedAtMs: number;
  subagentNote: string;
}

/**
 * What has to differ for a thread to be worth reading again.
 *
 * Not the modification time alone, and that cost a real bug: Windows does not
 * update it while the writing process still holds the file open, and Codex
 * keeps its rollout open for the whole session. Measured — the file said
 * 00:39:41 while its last line was written at 00:39:49, so a scan looking only
 * at the clock decided nothing had changed and served a finished turn as
 * *running* for as long as the session stayed open. Touching the file was
 * enough to unstick it, which is how this was found.
 *
 * The size moves on every append, comes from the same `stat`, and costs
 * nothing.
 */
function fingerprint(mtimeMs: number, sizeBytes: number): string {
  return `${mtimeMs}:${sizeBytes}`;
}

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

/** `rollout-2026-07-27T13-35-38-<uuid>.jsonl` -> uuid + creation date. */
export function parseRolloutFileName(fileName: string): { id?: string; createdAtMs?: number } {
  const match = /^rollout-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(.+)\.jsonl$/.exec(fileName);
  if (!match) {
    return {};
  }
  const [, day, hours, minutes, seconds, id] = match;
  const parsed = Date.parse(`${day}T${hours}:${minutes}:${seconds}`);
  return { id, createdAtMs: Number.isNaN(parsed) ? undefined : parsed };
}

/** First genuine user prompt, skipping the context Codex injects as user messages. */
function firstUserPrompt(entries: Json[]): string | undefined {
  for (const entry of entries) {
    const payload = asObject(entry.payload);
    if (!payload) {
      continue;
    }
    let text: string | undefined;
    if (payload.type === 'user_message' && typeof payload.message === 'string') {
      text = payload.message;
    } else if (
      payload.type === 'message' &&
      payload.role === 'user' &&
      Array.isArray(payload.content)
    ) {
      for (const block of payload.content) {
        const part = asObject(block);
        if (part && typeof part.text === 'string' && part.text.trim()) {
          text = part.text;
          break;
        }
      }
    }
    if (text && text.trim() && !isInjectedContext(text)) {
      return text;
    }
  }
  return undefined;
}

export class CodexSessionProvider implements SessionProvider {
  readonly id = 'codex' as const;
  readonly root: string;

  private readonly home: string;
  private readonly includeSubagents: boolean;
  /** Every file backing a session, so search covers sub-agent transcripts too. */
  private readonly sessionFiles = new Map<string, { paths: string[]; mtimeMs: number }>();
  private readonly contentCache = new ContentSearchCache();
  private readonly cache = new Map<string, CachedSession>();

  constructor(home: string, includeSubagents = false) {
    this.home = home;
    this.root = path.join(home, 'sessions');
    this.includeSubagents = includeSubagents;
  }

  async scan(options: ScanOptions): Promise<ScanResult> {
    let candidates: Candidate[];
    try {
      candidates = await this.collectCandidates(this.root);
    } catch (error) {
      const available = await this.exists();
      return {
        sessions: [],
        truncated: 0,
        state: {
          provider: this.id,
          available,
          root: this.root,
          count: 0,
          error: available ? `Cannot read the directory: ${String(error)}` : undefined,
        },
      };
    }

    const cutoff = options.historyMs > 0 ? options.now - options.historyMs : 0;
    const withinWindow = candidates.filter((candidate) => candidate.mtimeMs >= cutoff);
    withinWindow.sort((a, b) => b.mtimeMs - a.mtimeMs);
    // Fragments are read before grouping, so the raw list is bounded well above
    // the session cap: one thread can own several files.
    const opened = withinWindow.slice(0, options.maxSessions * CANDIDATE_FACTOR);

    const fragments = (await Promise.all(opened.map((candidate) => this.readFragment(candidate))))
      .filter((fragment): fragment is RolloutFragment => Boolean(fragment));

    const threads = groupFragments(fragments, this.includeSubagents);
    threads.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const retained = threads.slice(0, options.maxSessions);

    const titles = await this.readTitleIndex();
    const sessions = await Promise.all(
      retained.map((thread) => this.resolveSession(thread, options, titles)),
    );
    const alive = new Set(retained.map((thread) => `codex:${thread.threadId}`));
    for (const id of this.cache.keys()) {
      if (!alive.has(id)) {
        this.cache.delete(id);
      }
    }

    return {
      sessions,
      truncated: Math.max(0, threads.length - retained.length),
      state: {
        provider: this.id,
        available: true,
        root: this.root,
        count: sessions.length,
      },
    };
  }

  async matchesContent(session: AgentSession, terms: string[]): Promise<boolean> {
    const entry = this.sessionFiles.get(session.id);
    if (!entry) {
      return false;
    }
    // A thread matches when any of its transcripts matches, sub-agents included.
    for (const filePath of entry.paths) {
      if (await this.contentCache.match(filePath, entry.mtimeMs, terms)) {
        return true;
      }
    }
    return false;
  }

  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.root);
      return true;
    } catch {
      return false;
    }
  }

  /** Rollouts are nested by year/month/day, so the tree is walked recursively. */
  private async collectCandidates(dir: string): Promise<Candidate[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const candidates: Candidate[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        try {
          candidates.push(...(await this.collectCandidates(entryPath)));
        } catch {
          continue;
        }
        continue;
      }
      if (!entry.name.endsWith('.jsonl')) {
        continue;
      }
      try {
        const stat = await fs.stat(entryPath);
        if (stat.size === 0) {
          continue;
        }
        const { id } = parseRolloutFileName(entry.name);
        candidates.push({
          filePath: entryPath,
          fileId: id ?? path.basename(entry.name, '.jsonl'),
          mtimeMs: stat.mtimeMs,
          birthtimeMs: stat.birthtimeMs || stat.mtimeMs,
          sizeBytes: stat.size,
        });
      } catch {
        continue;
      }
    }
    return candidates;
  }

  /** Only the first line is needed to attach a file to its thread. */
  private async readFragment(candidate: Candidate): Promise<RolloutFragment | undefined> {
    let meta: Json | undefined;
    try {
      const [first] = await readHeadLines(candidate.filePath, 1);
      const entry = first ? asObject(first.value) : undefined;
      meta = entry?.type === 'session_meta' ? asObject(entry.payload) : undefined;
    } catch {
      return undefined;
    }

    const fromName = parseRolloutFileName(path.basename(candidate.filePath));
    const threadId =
      (typeof meta?.session_id === 'string' && meta.session_id) ||
      (typeof meta?.id === 'string' && meta.id) ||
      candidate.fileId;
    const createdAtRaw = typeof meta?.timestamp === 'string' ? Date.parse(meta.timestamp) : NaN;

    return {
      filePath: candidate.filePath,
      threadId,
      isSubagent:
        meta?.thread_source === 'subagent' || typeof meta?.parent_thread_id === 'string',
      sizeBytes: candidate.sizeBytes,
      createdAtMs: Number.isNaN(createdAtRaw)
        ? (fromName.createdAtMs ?? candidate.birthtimeMs)
        : createdAtRaw,
      mtimeMs: candidate.mtimeMs,
    };
  }

  private async readTitleIndex(): Promise<Map<string, string>> {
    const titles = new Map<string, string>();
    try {
      const lines = await readHeadLines(path.join(this.home, INDEX_FILE), MAX_INDEX_LINES);
      for (const line of lines) {
        const entry = asObject(line.value);
        if (
          entry &&
          typeof entry.id === 'string' &&
          typeof entry.thread_name === 'string' &&
          entry.thread_name.trim()
        ) {
          titles.set(entry.id, entry.thread_name);
        }
      }
    } catch {
      // No index: fall back to the first user message of each thread.
    }
    return titles;
  }

  /**
   * Reads the rollout only when the thread changed since the last scan; the
   * status is graded every time, since a session ages without being written to.
   * The title is applied outside the cache, so renaming a thread in the index
   * shows up without waiting for the transcript to change.
   */
  private async resolveSession(
    thread: RolloutThread,
    options: ScanOptions,
    titles: Map<string, string>,
  ): Promise<AgentSession> {
    const id = `codex:${thread.threadId}`;
    this.sessionFiles.set(id, {
      paths: [thread.primary.filePath, ...thread.subagents.map((item) => item.filePath)],
      mtimeMs: thread.mtimeMs,
    });

    let cached = this.cache.get(id);
    if (!cached || cached.fingerprint !== fingerprint(thread.mtimeMs, thread.sizeBytes)) {
      cached = await this.readSession(thread, titles);
      if (cached) {
        this.cache.set(id, cached);
      }
    }
    if (!cached) {
      // An unreadable session is reported as unknown, never silently dropped, and
      // never cached: the next scan tries again.
      return {
        ...this.fallbackSession(thread, titles),
        status: 'unknown',
        statusReason: 'Transcript could not be read.',
      };
    }

    const verdict = await verdictFor(
      cached.turnState,
      { provider: this.id, nativeId: thread.threadId, updatedAtMs: cached.updatedAtMs },
      options,
    );
    const indexTitle = titles.get(thread.threadId);
    return {
      ...cached.session,
      title: indexTitle ?? cached.session.title,
      status: verdict.status,
      statusReason: `${verdict.reason}${cached.subagentNote}`,
    };
  }

  private fallbackSession(
    thread: RolloutThread,
    titles: Map<string, string>,
  ): Omit<AgentSession, 'status' | 'statusReason'> {
    const indexTitle = titles.get(thread.threadId);
    return {
      id: `codex:${thread.threadId}`,
      provider: this.id,
      nativeId: thread.threadId,
      title: indexTitle ?? `Session ${thread.threadId.slice(0, 8)}`,
      createdAt: new Date(thread.createdAtMs).toISOString(),
      updatedAt: new Date(thread.mtimeMs).toISOString(),
      filePath: thread.primary.filePath,
    };
  }

  private async readSession(
    thread: RolloutThread,
    titles: Map<string, string>,
  ): Promise<CachedSession | undefined> {
    const indexTitle = titles.get(thread.threadId);
    const base = this.fallbackSession(thread, titles);

    let headEntries: Json[];
    let tailEntries: Json[];
    try {
      const [head, tail] = await Promise.all([
        readHeadLines(thread.primary.filePath, HEAD_LINES),
        // No narrower window here: the status is decided on this whole tail, so
        // the floor and the demand are the same number.
        readTailLines(thread.primary.filePath, TAIL_LINES, { minLines: TAIL_LINES }),
      ]);
      headEntries = head.map((line) => asObject(line.value)).filter((e): e is Json => Boolean(e));
      tailEntries = tail.map((line) => asObject(line.value)).filter((e): e is Json => Boolean(e));
    } catch {
      return undefined;
    }

    const meta = headEntries.find((entry) => entry.type === 'session_meta');
    const metaPayload = meta ? asObject(meta.payload) : undefined;
    const cwd = normalizeWorkspacePath(
      typeof metaPayload?.cwd === 'string' ? metaPayload.cwd : undefined,
    );

    const updatedAtMs = tailEntries.reduce<number>((latest, entry) => {
      if (typeof entry.timestamp !== 'string') {
        return latest;
      }
      const value = Date.parse(entry.timestamp);
      return !Number.isNaN(value) && value > latest ? value : latest;
    }, thread.mtimeMs);

    const prompt = firstUserPrompt(headEntries);
    const title = indexTitle ?? (prompt ? truncate(prompt) : undefined) ?? base.title;

    return {
      fingerprint: fingerprint(thread.mtimeMs, thread.sizeBytes),
      updatedAtMs,
      turnState: codexTurnState(tailEntries),
      subagentNote:
        thread.subagents.length > 0
          ? ` Includes ${thread.subagents.length} sub-agent transcript(s).`
          : '',
      session: {
        ...base,
        title,
        cwd,
        updatedAt: new Date(updatedAtMs).toISOString(),
      },
    };
  }
}
