import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TitleIndex } from './titleIndex';

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'title-index-'));
  file = path.join(directory, 'nested', 'claude-titles.json');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('TitleIndex', () => {
  it('remembers how far a transcript was searched, and what was found', async () => {
    const index = new TitleIndex(file);
    await index.set('/a.jsonl', { scannedBytes: 4096, custom: 'Worktree feature-42' }, 1);
    await index.flush();

    expect(await new TitleIndex(file).get('/a.jsonl')).toEqual({
      scannedBytes: 4096,
      custom: 'Worktree feature-42',
      seenAt: 1,
    });
  });

  it('starts empty rather than failing on an unreadable file', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json', 'utf8');
    expect(await new TitleIndex(file).get('/a.jsonl')).toBeUndefined();
  });

  it('writes nothing when nothing was learned', async () => {
    const index = new TitleIndex(file);
    await index.set('/a.jsonl', { scannedBytes: 10 }, 1);
    await index.flush();
    const before = (await fs.stat(file)).mtimeMs;

    const same = new TitleIndex(file);
    await same.set('/a.jsonl', { scannedBytes: 10 }, 2);
    await same.flush();
    expect((await fs.stat(file)).mtimeMs).toBe(before);
  });

  it('keeps the passes other windows paid for', async () => {
    const first = new TitleIndex(file);
    await first.set('/a.jsonl', { scannedBytes: 100, custom: 'From the first window' }, 1);
    await first.flush();

    // A second window that never saw /a.jsonl, and a first one that goes on
    // without ever re-reading the file.
    const second = new TitleIndex(file);
    await second.set('/b.jsonl', { scannedBytes: 200 }, 2);
    await second.flush();
    await first.set('/c.jsonl', { scannedBytes: 300 }, 3);
    await first.flush();

    const merged = new TitleIndex(file);
    expect((await merged.get('/a.jsonl'))?.custom).toBe('From the first window');
    expect((await merged.get('/b.jsonl'))?.scannedBytes).toBe(200);
    expect((await merged.get('/c.jsonl'))?.scannedBytes).toBe(300);
  });

  it('keeps the deeper search, and a title the deeper one did not find', async () => {
    const first = new TitleIndex(file);
    await first.set('/a.jsonl', { scannedBytes: 100, custom: 'Found early' }, 1);
    await first.flush();

    // Another window searched further and found no newer rename: the known one
    // still holds, since a later rename would itself be a title.
    const second = new TitleIndex(file);
    await second.set('/a.jsonl', { scannedBytes: 900 }, 2);
    await second.flush();

    const entry = await new TitleIndex(file).get('/a.jsonl');
    expect(entry?.scannedBytes).toBe(900);
    expect(entry?.custom).toBe('Found early');
  });
});
