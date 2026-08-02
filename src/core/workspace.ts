/**
 * Normalizes the working directory recorded in a transcript.
 *
 * The same folder is written both ways by the providers: Claude Code records
 * `c:\Users\...` on some entries and `C:\Users\...` on others, which made one
 * workspace appear twice in the filter and split its session count. Windows
 * paths are case-insensitive, so the drive letter is the only part that can be
 * normalized without risk; the rest is left alone, since a POSIX path is
 * case-sensitive and must not be altered.
 */
export function normalizeWorkspacePath(cwd: string | undefined): string | undefined {
  if (!cwd) {
    return undefined;
  }
  const trimmed = cwd.replace(/[\\/]+$/, '');
  if (!trimmed) {
    return cwd;
  }
  return /^[a-z]:/.test(trimmed) ? trimmed[0].toUpperCase() + trimmed.slice(1) : trimmed;
}
