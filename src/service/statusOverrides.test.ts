import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { OverrideStore, emptyOverrides, overridesFilePath, sanitizeOverrides } from './statusOverrides';

const entry = { status: 'idle', inferred: 'running', at: '2026-08-17T20:47:00.000Z' };

describe('sanitizeOverrides', () => {
  it('reads back a complete file', () => {
    const read = sanitizeOverrides({ version: 1, entries: { a: entry } });
    expect(read.entries).toEqual({ a: entry });
  });

  /*
   * This file is a person's click today and could be a hand edit tomorrow, and
   * it is read back on every scan. A status nothing knows how to draw would
   * reach the table as an empty cell with no way to explain itself, so anything
   * that is not one of the four is dropped rather than trusted.
   */
  it('drops an entry whose status is not one of the four', () => {
    expect(sanitizeOverrides({ entries: { a: { ...entry, status: 'busy' } } }).entries).toEqual({});
    expect(sanitizeOverrides({ entries: { a: { ...entry, inferred: 'busy' } } }).entries).toEqual({});
  });

  it('drops an entry missing any of its three fields', () => {
    for (const missing of ['status', 'inferred', 'at']) {
      const broken: Record<string, unknown> = { ...entry };
      delete broken[missing];
      expect(sanitizeOverrides({ entries: { a: broken } }).entries, missing).toEqual({});
    }
  });

  it('survives anything that is not the shape it expects', () => {
    expect(sanitizeOverrides(null).entries).toEqual({});
    expect(sanitizeOverrides('a string').entries).toEqual({});
    expect(sanitizeOverrides({ entries: 'not an object' }).entries).toEqual({});
    expect(sanitizeOverrides({ entries: { a: null } }).entries).toEqual({});
    expect(sanitizeOverrides({}).version).toBe(emptyOverrides().version);
  });
});

describe('OverrideStore', () => {
  const store = async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'asm-overrides-'));
    return { directory, store: new OverrideStore(overridesFilePath(directory)) };
  };

  it('reads nothing from a file that is not there', async () => {
    // Which is the answer that shows what the transcripts say, and the state
    // every machine starts in.
    const { store: fresh } = await store();
    expect((await fresh.read()).entries).toEqual({});
  });

  it('writes and reads back one correction', async () => {
    const { store: fresh } = await store();
    await fresh.update((current) => {
      current.entries.a = entry as never;
    });
    expect((await fresh.read()).entries).toEqual({ a: entry });
  });

  it('reads nothing from a half-written file rather than throwing', async () => {
    const { directory, store: fresh } = await store();
    await fs.writeFile(overridesFilePath(directory), '{"entries":', 'utf8');
    expect((await fresh.read()).entries).toEqual({});
  });

  it('forgets a correction that was deleted', async () => {
    const { store: fresh } = await store();
    await fresh.update((current) => {
      current.entries.a = entry as never;
    });
    await fresh.update((current) => {
      delete current.entries.a;
    });
    expect((await fresh.read()).entries).toEqual({});
  });
});
