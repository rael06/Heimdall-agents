import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withFileLock } from './fileLock';

let dir: string;
let filePath: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'file-lock-'));
  filePath = path.join(dir, 'counter.json');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** The shape every shared file uses: read, change, write back. */
async function increment(): Promise<void> {
  const current = Number(await fs.readFile(filePath, 'utf8').catch(() => '0'));
  // Yielding between the read and the write is what a real scan does, and what
  // lets another window slip in.
  await new Promise((resolve) => setTimeout(resolve, 1));
  await fs.writeFile(filePath, String(current + 1), 'utf8');
}

describe('withFileLock', () => {
  it('lets concurrent writers take turns instead of overwriting each other', async () => {
    await Promise.all(
      Array.from({ length: 12 }, () => withFileLock(filePath, () => increment())),
    );
    expect(Number(await fs.readFile(filePath, 'utf8'))).toBe(12);
  });

  it('shows the race it exists to prevent', async () => {
    await Promise.all(Array.from({ length: 12 }, () => increment()));
    // Unprotected, most of those reads saw the same value and wrote it back.
    expect(Number(await fs.readFile(filePath, 'utf8'))).toBeLessThan(12);
  });

  it('protects the very first write, before the directory exists', async () => {
    // The lock cannot be created in a directory that is not there yet, and that
    // first write is exactly the one several windows race for.
    const nested = path.join(dir, 'nested', 'counter.json');
    filePath = nested;
    await Promise.all(Array.from({ length: 8 }, () => withFileLock(nested, () => increment())));
    expect(Number(await fs.readFile(nested, 'utf8'))).toBe(8);
  });

  it('releases the lock once the change is written', async () => {
    await withFileLock(filePath, async () => undefined);
    await expect(fs.access(`${filePath}.lock`)).rejects.toThrow();
  });

  it('releases the lock even when the change fails', async () => {
    await expect(
      withFileLock(filePath, () => Promise.reject(new Error('write failed'))),
    ).rejects.toThrow('write failed');
    await expect(fs.access(`${filePath}.lock`)).rejects.toThrow();
  });

  it('takes over a lock left behind by a window that died', async () => {
    const lockPath = `${filePath}.lock`;
    await fs.writeFile(lockPath, '999999', 'utf8');
    const old = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, old, old);

    // Without the takeover this would wait, then give up on the change.
    await withFileLock(filePath, () => fs.writeFile(filePath, 'written', 'utf8'));
    expect(await fs.readFile(filePath, 'utf8')).toBe('written');
  });
});
