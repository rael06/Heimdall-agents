import { ParsedArgs, UsageError, unknownOptions } from './args';
import { buildStore } from './context';
import { formatDate, renderRows, shortId, workspaceLabel } from './format';
import { write, writeError } from './output';
import { resolveSession } from './query';
import { SETTINGS_OPTIONS, settingsFrom } from './settings';

export async function status(args: ParsedArgs): Promise<number> {
  const unknown = unknownOptions(args, [...SETTINGS_OPTIONS, 'json']);
  if (unknown.length) {
    throw new UsageError(
      `Unknown option(s) for \`asm status\`: ${unknown.map((n) => `--${n}`).join(', ')}`,
    );
  }
  const needle = args.positionals[0];
  if (!needle) {
    throw new UsageError('`asm status` expects a session identifier. Run `asm list` to find one.');
  }

  const store = buildStore(settingsFrom(args));
  const snapshot = await store.refresh();
  const resolution = resolveSession(snapshot.sessions, needle);

  if (resolution.kind === 'none') {
    writeError(`No session matches "${needle}" among the ${snapshot.sessions.length} scanned.`);
    return 1;
  }
  if (resolution.kind === 'ambiguous') {
    writeError(`"${needle}" matches ${resolution.candidates.length} sessions:`);
    for (const line of renderRows(
      resolution.candidates.map((session) => [shortId(session), session.provider, session.title]),
    )) {
      writeError(`  ${line}`);
    }
    return 1;
  }

  const session = resolution.session;
  if (args.options.has('json')) {
    write(JSON.stringify(session, null, 2));
    return 0;
  }

  // The reason is the point of the command: an inferred status has to justify
  // itself, otherwise it is just a word.
  for (const line of renderRows([
    ['Id', session.id],
    ['Title', session.title],
    // Only when the conversation drifted from what it is called.
    ['Provider', session.provider],
    ['Status', session.status],
    ['Because', session.statusReason],
    ['Created', formatDate(session.createdAt)],
    ['Updated', formatDate(session.updatedAt)],
    ['Workspace', session.cwd ?? `${workspaceLabel(session.cwd)} (unknown)`],
    ['Transcript', session.filePath],
  ])) {
    write(line);
  }
  return 0;
}
