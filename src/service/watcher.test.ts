import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RootWatcher } from './watcher';

/**
 * This module was at 0% coverage, which is exactly why the case below had never
 * been asked. CI on node 24 answered it instead, by aborting the service
 * process inside libuv where nothing in JavaScript could catch it.
 */

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'watcher-'));
  await fs.mkdir(path.join(home, 'projects'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true }).catch(() => undefined);
});

/** The 8.3 form Windows keeps for a directory, when it keeps one. */
function shortPath(directory: string): string | undefined {
  if (process.platform !== 'win32') {
    return undefined;
  }
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(New-Object -ComObject Scripting.FileSystemObject).GetFolder('${directory}').ShortPath`,
    ],
    { encoding: 'utf8' },
  );
  const value = result.stdout?.trim();
  return value && value !== directory ? value : undefined;
}

describe('RootWatcher', () => {
  it('watches the path the operating system would name, not the one it was given', () => {
    const short = shortPath(home);
    if (!short) {
      // No 8.3 alias on this volume, so there is nothing to canonicalise.
      return;
    }

    const watcher = new RootWatcher([short], () => undefined, 10, 50);
    const report = watcher.start();
    try {
      expect(report.failed).toEqual([]);
      // The short name is what went in; the long one is what is watched, because
      // libuv compares every reported path against this string and *asserts* if
      // it is not a prefix — which aborts the process rather than raising.
      expect(report.watched[0]).not.toBe(short);
      expect(report.watched[0].toLowerCase()).toBe(home.toLowerCase());
    } finally {
      watcher.stop();
    }
  });

  it('reports a root it cannot watch instead of throwing', () => {
    const watcher = new RootWatcher([path.join(home, 'nowhere')], () => undefined, 10, 50);
    const report = watcher.start();
    try {
      expect(report.watched).toEqual([]);
      expect(report.failed).toHaveLength(1);
      expect(report.failed[0].root).toContain('nowhere');
    } finally {
      watcher.stop();
    }
  });

  it('keeps the roots it can when one of them is missing', () => {
    const watcher = new RootWatcher(
      [home, path.join(home, 'nowhere')],
      () => undefined,
      10,
      50,
    );
    const report = watcher.start();
    try {
      expect(report.watched).toHaveLength(1);
      expect(report.failed).toHaveLength(1);
    } finally {
      watcher.stop();
    }
  });

  it('calls back once for a burst of writes, not once per write', async () => {
    const onChange = vi.fn();
    const watcher = new RootWatcher([home], onChange, 40, 400);
    watcher.start();
    try {
      for (let index = 0; index < 5; index += 1) {
        await fs.writeFile(path.join(home, 'projects', `file-${index}.jsonl`), 'x');
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(onChange).toHaveBeenCalled();
      // The point of the debounce: a session mid-turn writes constantly.
      expect(onChange.mock.calls.length).toBeLessThan(5);
    } finally {
      watcher.stop();
    }
  });

  it('goes quiet once stopped', async () => {
    const onChange = vi.fn();
    const watcher = new RootWatcher([home], onChange, 10, 50);
    watcher.start();
    watcher.stop();

    await fs.writeFile(path.join(home, 'projects', 'after.jsonl'), 'x');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onChange).not.toHaveBeenCalled();
  });
});
