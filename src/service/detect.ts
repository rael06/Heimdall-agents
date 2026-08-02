import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ProviderId } from '../model/types';

/**
 * Finding where the providers keep their transcripts.
 *
 * The defaults are right on most machines and wrong on some — a relocated home,
 * a `CLAUDE_CONFIG_DIR`, a second account. Rather than ask everyone to type a
 * path, the candidates are probed and the ones that actually hold transcripts
 * are offered.
 *
 * A directory that exists is not enough: `~/.claude` exists on a machine that
 * has only ever run the extension. What counts is finding transcripts in it.
 */

export interface Candidate {
  path: string;
  /** Where the suggestion came from, so a surprising answer can be explained. */
  source: string;
  exists: boolean;
  /** Transcripts found beneath it. Zero means the directory is not the one. */
  transcripts: number;
}

export interface Detection {
  provider: ProviderId;
  candidates: Candidate[];
  /** The best candidate, or nothing when none holds a transcript. */
  best?: string;
}

/** Where each provider stores transcripts, relative to its home. */
const TRANSCRIPTS: Record<ProviderId, string> = {
  claude: 'projects',
  codex: 'sessions',
};

export function candidatePaths(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): { path: string; source: string }[] {
  const found: { path: string; source: string }[] = [];
  const add = (candidate: string | undefined, source: string): void => {
    if (candidate && !found.some((entry) => entry.path === candidate)) {
      found.push({ path: candidate, source });
    }
  };

  if (provider === 'claude') {
    add(env.CLAUDE_CONFIG_DIR, 'CLAUDE_CONFIG_DIR');
    add(path.join(home, '.claude'), 'the usual place');
  } else {
    add(env.CODEX_HOME, 'CODEX_HOME');
    add(path.join(home, '.codex'), 'the usual place');
  }
  // A relocated profile: the home the shell reports is not always the one the
  // CLI wrote into.
  add(env.USERPROFILE ? path.join(env.USERPROFILE, `.${provider}`) : undefined, 'USERPROFILE');
  return found;
}

/** Counts transcripts a few levels down, stopping early: this only ranks. */
async function countTranscripts(root: string, budget = 200): Promise<number> {
  let found = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (found >= budget || depth > 4) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found >= budget) {
        return;
      }
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name), depth + 1);
      } else if (entry.name.endsWith('.jsonl')) {
        found += 1;
      }
    }
  };
  await walk(root, 0);
  return found;
}

export async function detect(
  provider: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): Promise<Detection> {
  const candidates: Candidate[] = [];
  for (const { path: candidate, source } of candidatePaths(provider, env, home)) {
    const transcripts = await countTranscripts(path.join(candidate, TRANSCRIPTS[provider]));
    let exists: boolean;
    try {
      exists = (await fs.stat(candidate)).isDirectory();
    } catch {
      exists = false;
    }
    candidates.push({ path: candidate, source, exists, transcripts });
  }
  // Most transcripts wins; a directory that exists but holds none is not it.
  const best = [...candidates].sort((a, b) => b.transcripts - a.transcripts)[0];
  return { provider, candidates, best: best && best.transcripts > 0 ? best.path : undefined };
}
