import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findLastMatch, forEachLine, readHeadLines, readTailLines } from './jsonl';
import { fileContainsAllTerms } from './search';

let dir: string;
let filePath: string;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-sessions-'));
  filePath = path.join(dir, 'session.jsonl');
  const lines = Array.from({ length: 500 }, (_, index) =>
    JSON.stringify({ index, text: `line ${index} déployée` }),
  );
  // The last line is truncated on purpose: a transcript may be mid-write.
  await fs.writeFile(filePath, `${lines.join('\n')}\n{"index":500,"tex`, 'utf8');
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('findLastMatch', () => {
  it('returns the last matching line, wherever it sits', async () => {
    const match = await findLastMatch(filePath, 'line 4 ');
    expect((match.value as { index: number }).index).toBe(4);
  });

  it('leaves a line still being written to the next search', async () => {
    const match = await findLastMatch(filePath, 'nothing matches this');
    expect(match.value).toBeUndefined();
    // The fixture ends mid-line: the offset stops before it rather than inside it.
    const { size } = await fs.stat(filePath);
    expect(match.endByte).toBe(size - '{"index":500,"tex'.length);
  });

  it('resumes where a previous search stopped', async () => {
    const resumable = path.join(dir, 'resumable.jsonl');
    // Accented, so a byte offset counted in characters would drift here.
    await fs.writeFile(resumable, `${JSON.stringify({ mark: 'première' })}\n`, 'utf8');
    const first = await findLastMatch(resumable, 'mark');
    expect((first.value as { mark: string }).mark).toBe('première');

    await fs.appendFile(resumable, `${JSON.stringify({ mark: 'deuxième' })}\n`, 'utf8');
    const second = await findLastMatch(resumable, 'mark', first.endByte);
    // Only the appended bytes are searched, so the earlier match is not seen again.
    expect((second.value as { mark: string }).mark).toBe('deuxième');

    const nothingNew = await findLastMatch(resumable, 'mark', second.endByte);
    expect(nothingNew.value).toBeUndefined();
  });
});

describe('readHeadLines', () => {
  it('reads only the requested head', async () => {
    const head = await readHeadLines(filePath, 3);
    expect(head).toHaveLength(3);
    expect((head[0].value as { index: number }).index).toBe(0);
  });
});

describe('readTailLines', () => {
  it('reads the tail and skips the truncated line', async () => {
    const tail = await readTailLines(filePath, 5);
    const indexes = tail.map((line) => (line.value as { index: number }).index);
    expect(indexes).toEqual([495, 496, 497, 498, 499]);
  });

  it('stays correct when the whole file fits in the buffer', async () => {
    const small = path.join(dir, 'small.jsonl');
    await fs.writeFile(small, '{"a":1}\n{"a":2}\n', 'utf8');
    const tail = await readTailLines(small, 10);
    expect(tail.map((line) => (line.value as { a: number }).a)).toEqual([1, 2]);
  });
});

describe('forEachLine', () => {
  it('stops as soon as the visitor asks for it', async () => {
    let seen = 0;
    await forEachLine(filePath, () => {
      seen += 1;
      return seen < 4;
    });
    expect(seen).toBe(4);
  });
});

describe('fileContainsAllTerms', () => {
  it('finds a content term regardless of accents', async () => {
    expect(await fileContainsAllTerms(filePath, ['deployee'])).toBe(true);
  });

  it('requires every term', async () => {
    expect(await fileContainsAllTerms(filePath, ['deployee', 'missing'])).toBe(false);
  });
});
