import { createReadStream, promises as fs } from 'node:fs';
import { createInterface } from 'node:readline';
import { StringDecoder } from 'node:string_decoder';

/**
 * Targeted reading of potentially very large JSONL files.
 *
 * Claude and Codex transcripts easily reach tens of megabytes, so only the head
 * (metadata, title) and the tail (last conversation turn) are read. Full text
 * search streams the file line by line instead of loading it in memory.
 */

const DEFAULT_TAIL_BYTES = 256 * 1024;

export interface JsonlLine {
  raw: string;
  value: unknown;
}

function parseLines(lines: string[]): JsonlLine[] {
  const parsed: JsonlLine[] = [];
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    try {
      parsed.push({ raw: trimmed, value: JSON.parse(trimmed) });
    } catch {
      // Truncated line (transcript still being written) or unknown format: it is
      // skipped instead of failing the whole session.
    }
  }
  return parsed;
}

/** Reads at most `maxLines` lines from the beginning of the file. */
export async function readHeadLines(filePath: string, maxLines: number): Promise<JsonlLine[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  const lines: string[] = [];
  try {
    for await (const line of reader) {
      lines.push(line);
      if (lines.length >= maxLines) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
  return parseLines(lines);
}

/**
 * Reads the end of the file and returns the last complete lines. The first line
 * of the buffer is dropped when the read started in the middle of a line.
 */
export async function readTailLines(
  filePath: string,
  maxLines: number,
  maxBytes = DEFAULT_TAIL_BYTES,
): Promise<JsonlLine[]> {
  const handle = await fs.open(filePath, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, maxBytes);
    const position = size - length;
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, position);
    let text = buffer.toString('utf8');
    if (position > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
    }
    // Parse first, then slice: the last line of a transcript being written is
    // often incomplete and must not consume one of the requested slots.
    const parsed = parseLines(text.split('\n'));
    return parsed.slice(Math.max(0, parsed.length - maxLines));
  } finally {
    await handle.close();
  }
}

/**
 * Last line matching `needle`, looked up from `startByte` to the end of the file.
 *
 * `needle` is matched as raw text before anything is parsed, so a pass over a
 * large transcript costs a read and a substring search rather than parsing every
 * line. Only the candidates are parsed, which also makes the match independent
 * of how the JSON happens to be laid out.
 *
 * The offset returned always lands just after a complete line, never inside one.
 * That is what makes resuming exact: a transcript caught mid-write leaves its
 * last, incomplete line to the next search rather than splitting it in two.
 */
export async function findLastMatch(
  filePath: string,
  needle: string,
  startByte = 0,
): Promise<{ value?: unknown; endByte: number }> {
  const { size } = await fs.stat(filePath);
  if (startByte >= size) {
    return { endByte: startByte };
  }

  const stream = createReadStream(filePath, { start: startByte });
  // Chunks cut wherever they please, including through a character, so the text
  // is decoded across boundaries and the offset counted in bytes, not in chars.
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let endByte = startByte;
  let last: unknown;

  try {
    for await (const chunk of stream) {
      pending += decoder.write(chunk as Buffer);
      let breakAt = pending.indexOf('\n');
      while (breakAt !== -1) {
        const line = pending.slice(0, breakAt);
        if (line.includes(needle)) {
          try {
            last = JSON.parse(line.trim());
          } catch {
            // Malformed line: keep the previous match.
          }
        }
        endByte += Buffer.byteLength(line, 'utf8') + 1;
        pending = pending.slice(breakAt + 1);
        breakAt = pending.indexOf('\n');
      }
    }
  } finally {
    stream.destroy();
  }

  // The end offset is returned even with nothing found, so the caller can record
  // how far this file has been searched and never search that region again.
  return { value: last, endByte };
}

/**
 * Walks the file line by line. `visit` returns false to stop the walk. Used by
 * full text search: no transcript is ever kept in memory.
 */
export async function forEachLine(
  filePath: string,
  visit: (line: string) => boolean,
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of reader) {
      if (!visit(line)) {
        return;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
  }
}
