import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { findLastMatch, readHeadLines, readTailLines } from '../core/jsonl';
import { ContentSearchCache } from '../core/search';
import { TitleIndex } from '../core/titleIndex';
import { truncate } from '../core/text';
import { normalizeWorkspacePath } from '../core/workspace';
import { AgentSession } from '../model/types';
import { claudeTurnState, pendingBackgroundTask } from './claudeStatus';
import { ScanOptions, ScanResult, SessionProvider, TurnState, gradeTurnState } from './provider';

/**
 * Claude Code stores one JSONL transcript per session, grouped by project folder,
 * under `<claudeHome>/projects/<encoded-project>/<session-id>.jsonl`.
 */

const HEAD_LINES = 60;
/** Enough to decide the status of the last turn. */
const STATUS_LINES = 80;
/**
 * Titles are looked up over a much wider window: a rename is written once, so it
 * scrolls away as the session continues, while the status only needs the end.
 * The tail read parses its whole buffer anyway, so a wider window costs no I/O.
 */
const TAIL_LINES = 600;
/**
 * Cheap text probe for a rename, checked before anything is parsed. The entry
 * itself is `{"type":"custom-title",...}`; matching the value alone keeps the
 * probe independent of how the JSON is laid out, at the cost of parsing the odd
 * message that happens to mention it.
 */
const CUSTOM_TITLE_NEEDLE = 'custom-title';

type Json = Record<string, unknown>;

interface Candidate {
  filePath: string;
  nativeId: string;
  mtimeMs: number;
  birthtimeMs: number;
  sizeBytes: number;
}

/**
 * What was learned from a transcript, kept until the file changes. The status is
 * deliberately absent: it is graded again on every scan, since a session ages
 * without being written to.
 */
interface CachedSession {
  /** {@link fingerprint} of the file when it was read. */
  fingerprint: string;
  session: Omit<AgentSession, 'status' | 'statusReason'>;
  turnState: TurnState;
  updatedAtMs: number;
}

/**
 * What has to differ for a transcript to be worth reading again.
 *
 * The modification time alone is not enough, and that cost a real bug: Windows
 * does not update it while the writing process still holds the file open, and
 * both CLIs keep their transcript open for the whole session. Measured on a
 * Codex rollout — the file said 00:39:41 while its last line was written at
 * 00:39:49, so a scan looking only at the clock decided nothing had changed and
 * served a finished turn as *running* for as long as the session stayed open.
 *
 * The size moves on every append, comes from the same `stat`, and costs
 * nothing. Together the two are wrong only if a file is rewritten to exactly
 * the same length within the same millisecond.
 */
function fingerprint(mtimeMs: number, sizeBytes: number): string {
  return `${mtimeMs}:${sizeBytes}`;
}

function asObject(value: unknown): Json | undefined {
  return typeof value === 'object' && value !== null ? (value as Json) : undefined;
}

function timestampOf(entry: Json): number | undefined {
  if (typeof entry.timestamp === 'string') {
    const parsed = Date.parse(entry.timestamp);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

function firstUserText(entries: Json[]): string | undefined {
  for (const entry of entries) {
    if (entry.type !== 'user') {
      continue;
    }
    const message = asObject(entry.message);
    const content = message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content;
    }
    if (Array.isArray(content)) {
      for (const block of content) {
        const part = asObject(block);
        if (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
          return part.text;
        }
      }
    }
  }
  return undefined;
}

/**
 * Titles Claude appends as the conversation evolves.
 *
 * It rewrites its generated title as the subject drifts, so a session can carry
 * several. The **first** is what names the session: a name that changes under
 * you cannot be learned, and a list you scan is worth more than a list that is
 * always current. The later ones are ignored — Codex has no equivalent, and a
 * column only one provider can fill is not a column this list can offer.
 *
 * A title the user typed is recorded as `custom-title` and wins over both,
 * whatever their order in the file.
 */
function pickTitle(
  entries: Json[],
  type: string,
  field: string,
  from: 'first' | 'last',
): string | undefined {
  const matches = entries.filter((entry) => {
    const value = entry[field];
    return entry.type === type && typeof value === 'string' && value.trim();
  });
  const chosen = from === 'first' ? matches[0] : matches[matches.length - 1];
  return chosen ? (chosen[field] as string) : undefined;
}

function customTitle(entries: Json[]): string | undefined {
  return pickTitle(entries, 'custom-title', 'customTitle', 'last');
}

/** The name the session keeps. */
function firstAiTitle(entries: Json[]): string | undefined {
  return pickTitle(entries, 'ai-title', 'aiTitle', 'first');
}

export class ClaudeSessionProvider implements SessionProvider {
  readonly id = 'claude' as const;
  readonly root: string;

  private readonly mtimes = new Map<string, number>();
  private readonly contentCache = new ContentSearchCache();
  private readonly cache = new Map<string, CachedSession>();
  /** Retained by the last full scan, so a focused scan can skip the walk. */
  private lastRetained?: Candidate[];
  private lastTruncated = 0;
  private readonly titleIndex: TitleIndex;

  /**
   * `titleIndexPath` defaults inside the Claude home, which keeps a test on a
   * temporary home from writing anywhere else; the extension points it at its
   * own directory, so the cache is shared by every window.
   */
  constructor(home: string, titleIndexPath?: string) {
    this.root = path.join(home, 'projects');
    this.titleIndex = new TitleIndex(
      titleIndexPath ?? path.join(home, '.heimdall-agents-titles.json'),
    );
  }

  async scan(options: ScanOptions): Promise<ScanResult> {
    // Decided before collecting, since a full scan is what fills the retained list.
    const focused = Boolean(options.focusIds && this.lastRetained);
    let candidates: Candidate[];
    try {
      candidates = await this.collectCandidates(options);
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

    // A focused scan keeps the list of the last full scan as it stands: applying
    // the history window again would drop sessions the next full scan brings
    // back, making them blink in and out of the panel.
    let retained = candidates;
    let truncated = this.lastTruncated;
    if (!focused) {
      const cutoff = options.historyMs > 0 ? options.now - options.historyMs : 0;
      const withinWindow = candidates.filter((candidate) => candidate.mtimeMs >= cutoff);
      withinWindow.sort((a, b) => b.mtimeMs - a.mtimeMs);
      retained = withinWindow.slice(0, options.maxSessions);
      truncated = candidates.length - retained.length;
      this.lastRetained = retained;
      this.lastTruncated = truncated;
    }

    const sessions = await Promise.all(
      retained.map((candidate) => this.resolveSession(candidate, options)),
    );
    this.forgetSessionsOutside(retained);
    await this.titleIndex.flush();

    return {
      sessions,
      truncated,
      state: {
        provider: this.id,
        available: true,
        root: this.root,
        count: sessions.length,
      },
    };
  }

  async matchesContent(session: AgentSession, terms: string[]): Promise<boolean> {
    const mtimeMs = this.mtimes.get(session.id) ?? 0;
    return this.contentCache.match(session.filePath, mtimeMs, terms);
  }

  private async exists(): Promise<boolean> {
    try {
      await fs.access(this.root);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A focused scan only re-stats the sessions it was asked about and reuses the
   * list of the last full scan for the others, so the whole tree is not walked.
   * It falls back to a full scan while no list is known yet.
   */
  private async collectCandidates(options: ScanOptions): Promise<Candidate[]> {
    const focus = options.focusIds;
    const previous = this.lastRetained;
    if (!focus || !previous) {
      return this.walkCandidates();
    }
    return Promise.all(
      previous.map(async (candidate) => {
        if (!focus.has(`claude:${candidate.nativeId}`)) {
          return candidate;
        }
        try {
          const stat = await fs.stat(candidate.filePath);
          return { ...candidate, mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
        } catch {
          // Deleted since the last full scan: the cached session stands until then.
          return candidate;
        }
      }),
    );
  }

  private async walkCandidates(): Promise<Candidate[]> {
    const projectDirs = await fs.readdir(this.root, { withFileTypes: true });
    const candidates: Candidate[] = [];
    for (const dir of projectDirs) {
      if (!dir.isDirectory()) {
        continue;
      }
      const dirPath = path.join(this.root, dir.name);
      let files: string[];
      try {
        files = await fs.readdir(dirPath);
      } catch {
        continue;
      }
      const stats = await Promise.all(
        files
          .filter((file) => file.endsWith('.jsonl'))
          .map(async (file) => {
            const filePath = path.join(dirPath, file);
            try {
              const stat = await fs.stat(filePath);
              if (stat.size === 0) {
                return undefined;
              }
              return {
                filePath,
                nativeId: path.basename(file, '.jsonl'),
                mtimeMs: stat.mtimeMs,
                birthtimeMs: stat.birthtimeMs || stat.mtimeMs,
                sizeBytes: stat.size,
              } satisfies Candidate;
            } catch {
              return undefined;
            }
          }),
      );
      for (const stat of stats) {
        if (stat) {
          candidates.push(stat);
        }
      }
    }
    return candidates;
  }

  /** Drops from the cache what the last scan no longer lists. */
  private forgetSessionsOutside(retained: Candidate[]): void {
    const alive = new Set(retained.map((candidate) => `claude:${candidate.nativeId}`));
    for (const id of this.cache.keys()) {
      if (!alive.has(id)) {
        this.cache.delete(id);
      }
    }
  }

  /**
   * Reads the transcript only when it changed since the last scan; the status is
   * graded every time, since a session ages without being written to.
   */
  private async resolveSession(
    candidate: Candidate,
    options: ScanOptions,
  ): Promise<AgentSession> {
    const id = `claude:${candidate.nativeId}`;
    this.mtimes.set(id, candidate.mtimeMs);

    let cached = this.cache.get(id);
    if (!cached || cached.fingerprint !== fingerprint(candidate.mtimeMs, candidate.sizeBytes)) {
      cached = await this.readSession(candidate);
      if (cached) {
        this.cache.set(id, cached);
      }
    }
    if (!cached) {
      // An unreadable session is reported as unknown, never silently dropped, and
      // never cached: the next scan tries again.
      return {
        ...this.fallbackSession(candidate),
        status: 'unknown',
        statusReason: 'Transcript could not be read.',
      };
    }

    const ageMs = Math.max(0, options.now - cached.updatedAtMs);
    const verdict = gradeTurnState(cached.turnState, ageMs, options);
    return { ...cached.session, status: verdict.status, statusReason: verdict.reason };
  }

  private fallbackSession(candidate: Candidate): Omit<AgentSession, 'status' | 'statusReason'> {
    return {
      id: `claude:${candidate.nativeId}`,
      provider: this.id,
      nativeId: candidate.nativeId,
      title: `Session ${candidate.nativeId.slice(0, 8)}`,
      createdAt: new Date(candidate.birthtimeMs).toISOString(),
      updatedAt: new Date(candidate.mtimeMs).toISOString(),
      filePath: candidate.filePath,
    };
  }

  /**
   * The title the user typed, wherever it sits in the transcript.
   *
   * A rename is written once, so it drifts out of the head and the tail as the
   * conversation goes on: those are searched first, since a fresh rename is
   * right there, and the rest of the file only when they came up empty. That
   * search resumes where the last one stopped, so a transcript is read in full
   * once and then only over the bytes appended since.
   */
  private async renamedTitle(
    candidate: Candidate,
    tailEntries: Json[],
    headEntries: Json[],
  ): Promise<string | undefined> {
    const nearby = customTitle(tailEntries) ?? customTitle(headEntries);
    if (nearby) {
      await this.titleIndex.set(
        candidate.filePath,
        { scannedBytes: candidate.sizeBytes, custom: nearby },
        candidate.mtimeMs,
      );
      return nearby;
    }

    const known = await this.titleIndex.get(candidate.filePath);
    // A file that shrank was rewritten: what was learned from it no longer holds.
    const from = known && known.scannedBytes <= candidate.sizeBytes ? known.scannedBytes : 0;
    let custom = from === 0 ? undefined : known?.custom;
    try {
      const match = await findLastMatch(candidate.filePath, CUSTOM_TITLE_NEEDLE, from);
      const found = customTitle([asObject(match.value)].filter((e): e is Json => Boolean(e)));
      await this.titleIndex.set(
        candidate.filePath,
        { scannedBytes: match.endByte, custom: found ?? custom },
        candidate.mtimeMs,
      );
      custom = found ?? custom;
    } catch {
      // Unreadable right now: the generated title stands until the next scan.
    }
    return custom;
  }

  private async readSession(candidate: Candidate): Promise<CachedSession | undefined> {
    const base = this.fallbackSession(candidate);

    let headEntries: Json[];
    let tailEntries: Json[];
    try {
      const [head, tail] = await Promise.all([
        readHeadLines(candidate.filePath, HEAD_LINES),
        readTailLines(candidate.filePath, TAIL_LINES),
      ]);
      headEntries = head.map((line) => asObject(line.value)).filter((e): e is Json => Boolean(e));
      tailEntries = tail.map((line) => asObject(line.value)).filter((e): e is Json => Boolean(e));
    } catch {
      return undefined;
    }

    const createdAtMs =
      headEntries.map(timestampOf).find((value): value is number => value !== undefined) ??
      candidate.birthtimeMs;
    const updatedAtMs = tailEntries.reduce<number>((latest, entry) => {
      const value = timestampOf(entry);
      return value !== undefined && value > latest ? value : latest;
    }, candidate.mtimeMs);

    // The working directory moves during a session, because the agent works in
    // sub folders; the workspace is the one the session started in, so the head
    // is read first and the tail only serves as a fallback. Claude also records
    // the drive letter both ways, hence the normalization.
    const cwd = normalizeWorkspacePath(
      [...headEntries, ...tailEntries].find((entry) => typeof entry.cwd === 'string' && entry.cwd)
        ?.cwd as string | undefined,
    );

    const promptTitle = firstUserText(headEntries);
    // A title the user typed comes first, then the first generated one, then the
    // opening prompt. The head is read before the tail here: the name is the
    // earliest one, not the most recent.
    const title =
      (await this.renamedTitle(candidate, tailEntries, headEntries)) ??
      firstAiTitle(headEntries) ??
      firstAiTitle(tailEntries) ??
      (promptTitle ? truncate(promptTitle) : undefined) ??
      base.title;

    return {
      fingerprint: fingerprint(candidate.mtimeMs, candidate.sizeBytes),
      updatedAtMs,
      // Two windows on purpose: the turn state only needs the end, while a
      // background task can have been launched long before the turn that
      // outlives it ended, and the notification pairing it is written after it.
      turnState: claudeTurnState(
        tailEntries.slice(-STATUS_LINES),
        pendingBackgroundTask(tailEntries),
      ),
      session: {
        ...base,
        title,
        cwd,
        createdAt: new Date(createdAtMs).toISOString(),
        updatedAt: new Date(updatedAtMs).toISOString(),
      },
    };
  }
}
