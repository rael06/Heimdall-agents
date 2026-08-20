#!/usr/bin/env node
import { UsageError, parseArgs } from './args';
import { list } from './list';
import { write, writeError } from './output';
import { serve } from './serve';
import { status } from './status';
import { watch } from './watch';

const HELP = `asm — local Claude Code and Codex sessions, from a terminal.

Usage
  asm list [options]           list the sessions, most recently created first
  asm watch [options]          list them, then log every status change
  asm status <id> [options]    one session, and why it has that status
  asm serve [options]          run the service, and print the URL to open
  asm help                     this text

Identifiers
  Any unambiguous prefix of the session identifier works, as with a commit SHA.

Selection (list and watch)
  --query <text>               search terms, combined with AND
  --scope both|title|content   where the search applies (default: both)
  --status <status>            repeatable, or comma separated
  --workspace <fragment>       repeatable, matched against the folder path
  --created-from <YYYY-MM-DD>  inclusive lower bound on the creation date
  --created-to <YYYY-MM-DD>    inclusive upper bound
  --sort <order>               <column>-asc or <column>-desc, where the column is
                               status, created, updated, provider, workspace or
                               title (default: created-desc). status-asc is the
                               priority order, needs action first
  --match all|any              whether every active filter has to hold, or one of
                               them is enough (default: all). The search always
                               narrows on top of it
  --json                       print the raw sessions instead of the table

Scanning (every command)
  --provider claude|codex      repeatable; both by default
  --claude-home <path>         defaults to ~/.claude
  --codex-home <path>          defaults to ~/.codex
  --include-subagents          list orphan Codex sub-agent transcripts too
  --history-days <n>           history window, 0 for everything (default: 30)
  --max <n>                    sessions loaded per provider (default: 300)
  --stale-after <minutes>      before an open turn stops being believed and
                               becomes unknown, 0 for never (default: 0)
  --auto-watch=false           stop marking a session watched when it starts working
  --shared-dir <path>          marks and resolved titles; defaults to
                               ~/.heimdall-agents
  --handoff-delay <seconds>    time a VS Code window is given to come up before it
                               is asked to reveal a session (default: 2)
  --notify=false               start with notifications off
  --notify-on <status>         statuses that raise one; repeatable or comma
                               separated (default: idle,failed)
  --notify-delay <seconds>     how long a session must stay stopped before it is
                               reported (default: 5). A turn that ends and
                               resumes inside that window is never notified
  --notify-scope watched|unacknowledged
                               which sessions may raise one (default: watched).
                               unacknowledged covers sessions the eye never
                               marked, including any already running when the
                               service started; acknowledging then silences them
  --interval <seconds>         delay between two scans in watch (default: 5)

Service (serve)
  --port <n>                   loopback port to listen on (default: 27600)
  --full-scan <seconds>        safety net behind the watcher (default: 30)
  --debounce <ms>              quiet period collapsing a burst of writes (default: 250)
  --max-debounce <ms>          longest a burst may delay a scan (default: 2000)

  The service binds to 127.0.0.1, checks the Origin of every request and mints a
  token per start, written to ~/.heimdall-agents/service.json. The URL it
  prints carries that token; without it the service answers nothing.`;

async function run(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  switch (args.command) {
    case 'list':
      return list(args);
    case 'watch':
      return watch(args);
    case 'status':
      return status(args);
    case 'serve':
      return serve(args);
    case 'help':
    case '--help':
    case '':
      write(HELP);
      return 0;
    default:
      throw new UsageError(`Unknown command "${args.command}". Run \`asm help\`.`);
  }
}

// `--help` and `-h` are options, not commands, so they never reach the switch
// above as a command unless they came first.
const argv = process.argv.slice(2);
const wantsHelp = argv.includes('--help') || argv.includes('-h');

run(wantsHelp ? ['help'] : argv)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      writeError(error.message);
      writeError('Run `asm help` for the available options.');
      process.exitCode = 2;
      return;
    }
    writeError(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
