import * as fsSync from 'node:fs';
import { promises as fs, realpathSync } from 'node:fs';
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

/**
 * A second name for the same directory, made without launching anything.
 *
 * A junction is one of the three ways a path reaches libuv spelled differently
 * from how the operating system reports it — the others being an 8.3 short name
 * and the wrong casing — and it is the only one Node can produce on its own.
 *
 * Two earlier versions of this asked Windows for the 8.3 form instead. The
 * first spawned PowerShell, which on a cold runner cost more than Vitest's
 * entire five-second budget before doing anything: the test took 12.9 s, timed
 * out, and said nothing whatever about the watcher. The second spawned `cmd`,
 * which is fast but has `cmd /c` re-quoting a command that already contains
 * quotes, and handed back `C:\"C:\Users\...\"`. Neither failure was about the
 * code under test, which is the definition of a test worth deleting.
 */
function secondNameFor(directory: string): string | undefined {
  const link = path.join(path.dirname(directory), `${path.basename(directory)}-link`);
  try {
    // `junction` on Windows needs no privilege; elsewhere this is a plain
    // symlink, and the property being checked is the same either way.
    fsSync.symlinkSync(directory, link, 'junction');
    return link;
  } catch {
    // Some filesystems and some sandboxes refuse links outright.
    return undefined;
  }
}

describe('RootWatcher', () => {
  it('watches the path the operating system would name, not the one it was given', () => {
    const second = secondNameFor(home);
    if (!second) {
      // Links refused here, so there is no second spelling to canonicalise.
      return;
    }

    // Whichever spelling goes in, the canonical one is what libuv is handed.
    // Not compared against `home`: on a Windows CI runner TEMP is itself
    // `C:\Users\RUNNER~1\...`, so `home` is already a short path and the
    // canonical form of it is `runneradmin`. That is not a detail — it is
    // exactly the situation that aborted the service.
    const expected = realpathSync.native(home);
    for (const given of [second, home]) {
      const watcher = new RootWatcher([given], () => undefined, 10, 50);
      const report = watcher.start();
      try {
        expect(report.failed).toEqual([]);
        expect(report.watched[0]).toBe(expected);
        // Nothing that is merely another name for it survives into what libuv
        // compares its own reports against.
        expect(report.watched[0]).not.toBe(second);
      } finally {
        watcher.stop();
      }
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
