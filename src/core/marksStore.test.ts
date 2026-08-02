import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MarksStore, add, toggle } from './marksStore';

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'marks-'));
  file = path.join(directory, 'nested', 'marks.json');
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('MarksStore', () => {
  it('starts empty when no file exists yet', async () => {
    const store = new MarksStore(file);
    expect(await store.read()).toEqual({ version: 1, watched: [], favorites: [], running: [] });
  });

  it('keeps every star when several windows write at once', async () => {
    // One store per window, as in real life: they share nothing but the file.
    const windows = Array.from({ length: 8 }, () => new MarksStore(file));
    await Promise.all(
      windows.map((store, index) =>
        store.update((marks) => {
          marks.favorites = [...marks.favorites, `claude:${index}`];
        }),
      ),
    );

    const favorites = (await new MarksStore(file).read()).favorites;
    expect(favorites).toHaveLength(8);
    expect(new Set(favorites)).toEqual(
      new Set(Array.from({ length: 8 }, (_, index) => `claude:${index}`)),
    );
  });

  it('creates the directory and persists a change', async () => {
    const store = new MarksStore(file);
    await store.update((marks) => {
      marks.favorites = ['claude:a'];
    });
    expect((await store.read()).favorites).toEqual(['claude:a']);
  });

  it('keeps what another window wrote in between', async () => {
    const store = new MarksStore(file);
    await store.update((marks) => {
      marks.favorites = ['claude:a'];
    });

    // A second window, with its own instance and its own stale view.
    const other = new MarksStore(file);
    await other.update((marks) => {
      marks.watched = ['codex:b'];
    });

    // The first one changes something else: it must not drop the other's mark.
    const merged = await store.update((marks) => {
      marks.favorites = add(marks.favorites, ['claude:c']);
    });
    expect(merged.watched).toEqual(['codex:b']);
    expect(merged.favorites).toEqual(['claude:a', 'claude:c']);
  });

  it('falls back to empty on a corrupted file rather than failing', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, '{ not json', 'utf8');
    expect((await new MarksStore(file).read()).favorites).toEqual([]);
  });

  it('drops entries that are not identifiers', async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({ favorites: ['ok', 42, null, ''] }), 'utf8');
    expect((await new MarksStore(file).read()).favorites).toEqual(['ok']);
  });

  it('seeds once, and never overwrites an existing file', async () => {
    const store = new MarksStore(file);
    await store.seed(['codex:b'], ['claude:a']);
    expect(await store.read()).toMatchObject({ watched: ['codex:b'], favorites: ['claude:a'] });

    await store.seed(['codex:z'], ['claude:z']);
    expect((await store.read()).favorites).toEqual(['claude:a']);
  });

  it('writes nothing when there is nothing to carry over', async () => {
    await new MarksStore(file).seed([], []);
    await expect(fs.access(file)).rejects.toThrow();
  });
});

describe('toggle and add', () => {
  it('toggles an identifier both ways', () => {
    expect(toggle([], 'a')).toEqual(['a']);
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('adds only what is missing, and keeps the array when nothing changes', () => {
    const ids = ['a'];
    expect(add(ids, ['a', 'b'])).toEqual(['a', 'b']);
    expect(add(ids, ['a'])).toBe(ids);
  });
});
