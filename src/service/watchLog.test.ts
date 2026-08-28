import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WatchLogStore, sanitizeWatchLog, watchChanges, watchLogFilePath } from './watchLog';

describe('watchChanges', () => {
  it('names what joined and what left', () => {
    expect(watchChanges(['a', 'b'], ['b', 'c'])).toEqual({ c: true, a: false });
  });

  it('says nothing when the set held still', () => {
    // Called on every scan, so "no change" has to be the cheap and silent case:
    // a log rewritten thirty seconds apart with the same answer would date every
    // session to the last time the service happened to look.
    expect(watchChanges(['a', 'b'], ['b', 'a'])).toEqual({});
  });
});

describe('sanitizeWatchLog', () => {
  it('keeps a whole entry and drops a half-written one', () => {
    const log = sanitizeWatchLog({
      version: 1,
      entries: {
        good: { at: '2026-08-28T10:00:00.000Z', watched: true },
        noDate: { watched: true },
        noFlag: { at: '2026-08-28T10:00:00.000Z' },
        empty: { at: '', watched: false },
        wrong: 'not an entry',
      },
    });
    expect(Object.keys(log.entries)).toEqual(['good']);
  });

  it('answers an empty log for anything that is not one', () => {
    expect(sanitizeWatchLog(undefined).entries).toEqual({});
    expect(sanitizeWatchLog('marks').entries).toEqual({});
  });
});

describe('WatchLogStore', () => {
  let directory: string;

  beforeAll(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'watch-log-'));
  });

  afterAll(async () => {
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('reads an empty log where there is no file', async () => {
    const store = new WatchLogStore(path.join(directory, 'missing', 'watch-log.json'));
    expect((await store.read()).entries).toEqual({});
  });

  it('records a change and reads it back', async () => {
    const store = new WatchLogStore(watchLogFilePath(directory));
    const at = new Date('2026-08-28T09:30:00.000Z');
    await store.record({ 'claude:one': true }, at);
    expect((await store.read()).entries['claude:one']).toEqual({
      at: '2026-08-28T09:30:00.000Z',
      watched: true,
    });
  });

  it('keeps the latest answer for a session that changed twice', async () => {
    const store = new WatchLogStore(watchLogFilePath(directory));
    await store.record({ 'claude:two': true }, new Date('2026-08-28T09:00:00.000Z'));
    await store.record({ 'claude:two': false }, new Date('2026-08-28T11:00:00.000Z'));
    const entry = (await store.read()).entries['claude:two'];
    expect(entry).toEqual({ at: '2026-08-28T11:00:00.000Z', watched: false });
  });

  it('writes nothing at all when nothing changed', async () => {
    const file = path.join(directory, 'untouched.json');
    const store = new WatchLogStore(file);
    await store.record({}, new Date());
    await expect(fs.stat(file)).rejects.toThrow();
  });
});
