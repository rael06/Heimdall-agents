import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NotifyStore, notifyFilePath, sanitizeNotifyMarks } from './notifyMarks';

describe('sanitizeNotifyMarks', () => {
  it('keeps the identifiers and drops everything else', () => {
    expect(sanitizeNotifyMarks({ ids: ['a', 7, '', null, 'b'] }).ids).toEqual(['a', 'b']);
  });

  it('answers an empty set for anything that is not a log', () => {
    expect(sanitizeNotifyMarks(undefined).ids).toEqual([]);
    expect(sanitizeNotifyMarks('a,b').ids).toEqual([]);
  });

  it('says each session once, however many times the file names it', () => {
    expect(sanitizeNotifyMarks({ ids: ['a', 'a', 'b', 'a'] }).ids).toEqual(['a', 'b']);
  });
});

describe('NotifyStore', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'notify-marks-'));
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  const storeIn = (name: string) => new NotifyStore(notifyFilePath(path.join(directory, name)));

  it('reads an empty set where there is no file', async () => {
    expect((await storeIn('missing').read()).ids).toEqual([]);
  });

  it('adds and removes a bell', async () => {
    const store = storeIn('toggling');
    await store.update((marks) => {
      marks.ids = [...marks.ids, 'claude:one'];
    });
    expect((await store.read()).ids).toEqual(['claude:one']);
    await store.update((marks) => {
      marks.ids = marks.ids.filter((id) => id !== 'claude:one');
    });
    expect((await store.read()).ids).toEqual([]);
  });

  it('writes the starting set only where there is no file', async () => {
    const store = storeIn('seeding');
    expect((await store.seedIfMissing(['a', 'b'])).ids).toEqual(['a', 'b']);

    // Silenced by hand, and a restart must not put them back: the guard is the
    // file's absence, not the set being empty.
    await store.update((marks) => {
      marks.ids = [];
    });
    expect((await store.seedIfMissing(['a', 'b'])).ids).toEqual([]);
  });
});
