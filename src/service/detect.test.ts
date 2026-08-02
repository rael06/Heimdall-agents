import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { candidatePaths, detect } from './detect';

describe('candidatePaths', () => {
  const home = '/home/dev';

  it('offers the usual place', () => {
    // Joined rather than written out: the separator is the platform's.
    expect(candidatePaths('claude', {}, home).map((c) => c.path)).toContain(
      path.join(home, '.claude'),
    );
    expect(candidatePaths('codex', {}, home).map((c) => c.path)).toContain(
      path.join(home, '.codex'),
    );
  });

  it('puts an explicit environment variable first, since it was set on purpose', () => {
    const found = candidatePaths('claude', { CLAUDE_CONFIG_DIR: '/elsewhere' }, home);
    expect(found[0]).toMatchObject({ path: '/elsewhere', source: 'CLAUDE_CONFIG_DIR' });
  });

  it('offers a relocated profile as well', () => {
    const found = candidatePaths('codex', { USERPROFILE: '/other/home' }, home);
    expect(found.map((c) => c.path)).toContain(path.join('/other/home', '.codex'));
  });

  it('never suggests the same path twice', () => {
    const found = candidatePaths('claude', { CLAUDE_CONFIG_DIR: '/home/dev/.claude' }, home);
    expect(found.filter((c) => c.path === '/home/dev/.claude')).toHaveLength(1);
  });
});

describe('detect', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'asm-detect-'));
    // One home with transcripts, one that merely exists.
    const real = path.join(root, 'real', '.claude', 'projects', 'a-project');
    await fs.mkdir(real, { recursive: true });
    await fs.writeFile(path.join(real, 'one.jsonl'), '{}');
    await fs.writeFile(path.join(real, 'two.jsonl'), '{}');
    await fs.mkdir(path.join(root, 'empty', '.claude'), { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  it('finds the home that actually holds transcripts', async () => {
    const found = await detect('claude', {}, path.join(root, 'real'));
    expect(found.best).toBe(path.join(root, 'real', '.claude'));
    expect(found.candidates[0].transcripts).toBe(2);
  });

  it('refuses a directory that exists but holds nothing', async () => {
    // ~/.claude exists on a machine that only ever ran the extension.
    const found = await detect('claude', {}, path.join(root, 'empty'));
    expect(found.best).toBeUndefined();
    expect(found.candidates[0]).toMatchObject({ exists: true, transcripts: 0 });
  });

  it('reports a candidate that is not there at all', async () => {
    const found = await detect('codex', {}, path.join(root, 'nowhere'));
    expect(found.candidates[0]).toMatchObject({ exists: false, transcripts: 0 });
    expect(found.best).toBeUndefined();
  });

  it('prefers the fuller of two homes', async () => {
    const found = await detect(
      'claude',
      { CLAUDE_CONFIG_DIR: path.join(root, 'empty', '.claude') },
      path.join(root, 'real'),
    );
    expect(found.best).toBe(path.join(root, 'real', '.claude'));
  });
});
