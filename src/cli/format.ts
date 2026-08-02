import * as path from 'node:path';
import { AgentSession } from '../model/types';

/** Absolute dates, chosen over "2 hours ago": a relative date has to be decoded. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '?';
  }
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export function formatClock(atMs: number): string {
  const date = new Date(atMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Enough of the native identifier to name a session in a command, the way a
 * short SHA names a commit. `asm status` resolves any unambiguous prefix, so a
 * collision is reported rather than guessed.
 */
export function shortId(session: AgentSession): string {
  return session.nativeId.slice(0, 8);
}

/** The folder name; the full path stays available through `--json`. */
export function workspaceLabel(cwd: string | undefined): string {
  if (!cwd) {
    return '-';
  }
  return path.basename(cwd) || cwd;
}

/**
 * Pads every column but the last, which is the title: titles are long and
 * meaningful, so they are never truncated — the terminal scrolls instead.
 */
export function renderRows(rows: readonly (readonly string[])[]): string[] {
  if (!rows.length) {
    return [];
  }
  const columns = Math.max(...rows.map((row) => row.length));
  const widths: number[] = [];
  for (let column = 0; column < columns - 1; column += 1) {
    widths[column] = Math.max(...rows.map((row) => (row[column] ?? '').length));
  }
  return rows.map((row) =>
    row
      .map((cell, column) => (column < columns - 1 ? cell.padEnd(widths[column]) : cell))
      .join('  ')
      .trimEnd(),
  );
}
