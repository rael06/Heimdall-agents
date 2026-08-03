# Heimdall agents

A desktop application that watches your **Claude Code** and **Codex** sessions and tells you when a
model has stopped working.

In Norse myth Heimdall keeps the watch: he sleeps less than a bird, hears the wool growing on a
sheep's back — and blows the Gjallarhorn **once**, when something has actually happened. That is the
whole design. It watches everything and speaks only on evidence, never on a delay.

Three things, and nothing else:

1. **Monitor** your sessions — every one of them, whatever started it.
2. **Click to navigate** — open VS Code straight on that session.
3. **Notify** you when a model stops, with everything closed.

**Where it stands.** It monitors both providers, a click opens a session in VS Code, and it notifies
with everything closed. It ships as an installed Windows application with an identity of its own, so
a notification button opens the session in one click. What remains is macOS and Linux (each needs a
machine to be verified on) and code-signing the installer, which is a purchase rather than a change
to the code.

## The application

```sh
npm install
npm run dist        # builds "dist/Heimdall agents Setup <version>.exe"
```

Run the installer: it creates a Start Menu shortcut and registers the `heimdall-agents://` scheme.
The window closes to the tray rather than quitting, because a service that stops watching when you
close the window would defeat its own purpose. *Start with Windows* is in the tray menu and off
until you turn it on.

### Sharing it

The installer is self-contained. On a machine that has never seen this, it needs **no configuration
at all**: it finds `~/.claude` and `~/.codex` on its own, picks its own port, mints its own token,
and lists whatever is there. Nothing is read from this repository at runtime.

Two things worth saying to whoever you hand it to:

- **Windows will warn on first run.** The installer is not code-signed — SmartScreen shows *Windows
  protected your PC*, and it takes *More info → Run anyway*. Signing it needs a certificate, which
  is a purchase rather than a code change.
- **Nothing has to be installed, ever.** No hooks, no configuration in another program, nothing to
  keep in sync. Both providers already write the turn boundary into their own transcripts, and that
  is where every status comes from.

### Help

*About* says the version and where the shared files are. *Uninstall…* runs the uninstaller Windows
registered, and says first what it will leave behind: the marks, resolved titles and settings live
in their own folder, so a later install picks up where you left off.

*Check for updates…* asks GitHub for the latest release, and installs it when told to. It only
speaks when asked — no check at startup, no periodic one — because this application exists to
interrupt you about exactly one thing.

The installer is unsigned, so what is verified is worth stating: the address at **every** redirect
hop (GitHub serves assets from `objects.githubusercontent.com`, and each hop is checked to still be
a GitHub host over TLS), the length against what the release declared, and the `sha512` published in
electron-builder's `latest.yml`. That is the whole of it without a certificate, and the dialog says
as much rather than implying more.

**A release with no `latest.yml` is not installed from.** That manifest carries the only checksum
there is, so without it nothing about the download can be checked, and the alternative would be
running an installer whose sole credential is that it arrived over TLS. The dialog says so instead,
before you choose rather than after — and the release workflow refuses to publish a release that is
missing it, so the situation should not arise.

**It needs a published release to do anything.** An unauthenticated request to a private repository
answers 404, which is indistinguishable from having no releases — so both are reported as *no
published release was found*, in those words. Making releases reachable means making them public,
which is a decision about this repository's history rather than a code change.

### Where statuses come from

The transcripts, and only the transcripts. Each provider writes them itself, and each one states
when a turn is over — so this is read rather than guessed.

**Claude Code** puts `stop_reason` on every assistant entry, the field the [Messages
API](https://platform.claude.com/docs/en/api/messages) defines:

| Value | Documented as | Read as |
| --- | --- | --- |
| `end_turn` | *a natural stopping point* | the turn is over |
| `tool_use` | *the model invoked one or more tools* | a tool is running |
| `null` | *null in the `message_start` event* | the answer is being written right now |
| `pause_turn` | *we paused a long-running turn* | still going |
| `max_tokens`, `refusal` | — | the turn was cut short |

**Codex** writes `task_started` and `task_complete`, paired by `turn_id`, plus `turn_aborted`.

That `null` matters more than it looks: it is what keeps a ten-minute thinking phase from being
read as a finished turn. Work in progress is stated, not inferred from a delay.

**One thing neither provider writes: a permission waiting on screen.** Measured on a real rejection,
41 seconds passed between the tool starting and the answer, and not one byte was written in between
— the wait is the gap between two lines. Codex says nothing either: zero approval events across 104
sessions and ~32 000 events. So a session blocked on a permission reads as *running*, because that
is the only honest thing the file supports.

It used to guess: past a delay, an open turn was called *waiting for you*. That was wrong on every
command taking more than a couple of minutes, and a notification raised on it is a false alarm —
which is the one way a tool like this dies, since alerts you learn to distrust are alerts you stop
reading. The guess is gone. An open turn stays running until the stale delay, then becomes
*inconclusive*, which claims nothing.

200 MB installed, ~700 MB unpacked. That is what an Electron application costs.

`npm run app` runs it without installing, from the build in `dist`.

It costs what an Electron application costs — around **410–445 MB** against **54 MB** for the
service on its own, on the same 319 sessions, with a 200 MB installer. That trade was made
deliberately: it buys the protocol, the identity, and the one-click notification below.

Everything below still works exactly as it did: the application starts the same service and loads
the same page, and `asm serve` on its own is unchanged.

## Install

Node 20.11 or later, and nothing else — there are no runtime dependencies.

```sh
npm install
npm run build
npm link      # optional, puts `asm` on your PATH
```

Without `npm link`, run `node dist/cli/main.js` wherever `asm` appears below.

## Usage

```sh
asm list                       # every session, most recently created first
asm watch                      # the same list, then a line per status change
asm status 019fa3a1            # one session, and why it has that status
asm serve                      # run the service, and print the URL to open
asm help                       # every option
```

A session is named by any unambiguous prefix of its identifier, the way a commit is named by a
short SHA. An ambiguous prefix is reported rather than resolved to the first match.

```
$ asm list --status idle --workspace webshop
ID        STATUS  CREATED           UPDATED           PROVIDER  WORKSPACE  TITLE
019fa3a1  idle    2026-07-27 14:52  2026-07-27 15:17  codex     webshop    Compare the two report formats
0219de8c  idle    2026-07-21 11:09  2026-07-21 22:03  claude    webshop    Find the quick wins
```

```
$ asm status 019fa3a1
Id          codex:019fa3a1-f287-7291-801a-a6b01df0de16
Title       Compare the two report formats
Provider    codex
Status      idle
Because     The turn ended, nothing more happens without you. Includes 2 sub-agent transcript(s).
Created     2026-07-27 14:52
Updated     2026-07-27 15:17
Workspace   C:\Users\dev\projects\webshop
Transcript  C:\Users\dev\.codex\sessions\2026\07\27\rollout-...jsonl
```

The list goes to stdout and everything else to stderr — a provider that failed, a directory that
holds nothing, the sessions left out by the history window — so a pipe carries the list alone.
`--json` prints the raw sessions instead of the table.

`asm watch` re-scans on an interval and logs what moved. Watching the transcript directories with
`fs.watch` arrives with the service, in M2.

## The service

```
$ asm serve
http://127.0.0.1:27600/?token=f9cdabfd…
Watching 2 root(s); full scan every 30s as a safety net.
Ctrl-C to stop.
```

Open that URL and you get the list, live.

### What the interface does

- **Nothing reorders itself.** A row's position depends on the sort you chose and on nothing else.
  A status changing repaints that row where it is. If a sort *would* move rows, the list says so
  and waits: *"3 row(s) would move — reorder"*.
- **Every column sorts, both ways.** Click a header to sort by it, click again to reverse. The
  select and the headers are the same setting, and both live in the URL.
- **The title is the name a session keeps.** Claude rewrites its generated title as the subject
  drifts; the first one names the session, because a name that changes under you cannot be learned.
  The later ones are not shown — Codex writes nothing of the kind, and a column only one provider
  can fill is not a column this list offers. A title you typed yourself wins over all of them.
- **Filters combine with `all` or `any`.** `all` narrows, as usual; `any` widens, which is how you
  ask for "what is running, or anything on webshop". The search always narrows on top of it.
- **Watched sessions come first, then starred ones**, whatever the sort — the chosen ordering still
  applies inside each group. A marker can be set automatically when a session starts working, so
  this grouping can want to move a row; the affordance above is what keeps it from doing it under
  your cursor.
- **Updates are keyed.** Rows are addressed by identifier and their cells are rewritten in place,
  so focus, selection and scroll survive an update. Never a re-render.
- **Watched and starred are markers and filters.** Hollow when unset, filled when set — the shape
  carries it, not only the colour.
- **An acknowledgement dot** on the corner of the status icon means "this status is new to you". It
  lights when a session stops, and clears when it starts working again, when you click the icon, or
  with *Acknowledge visible* — which settles what is on screen and never the rows a filter hides.
- **Minutes in the current status**, on watched rows only, right-aligned over four characters with
  tabular digits.
- **Absolute dates**, a shape per status, a tooltip saying why the status was inferred, the full
  workspace path in a tooltip, and horizontal scrolling rather than truncated titles.
- **Filters, sort and search live in the URL**, so a view reloads and can be bookmarked.
- **A click opens the session** in VS Code — the title opens the conversation, the workspace opens
  its window, and the icon on the left opens the raw transcript. Opening a session acknowledges it.
- **Refresh** forces a scan *and* takes the whole list back from the service, so a push missed by a
  stream that dropped cannot leave the page quietly out of date. It applies a pending reorder
  without asking again — asking for a refresh is the asking — and keeps your search and filters.
- **Keyboard**: `/` to search, `j` and `k` to move, `Enter` to open, `t` for the transcript, `w` for
  the workspace, `e` to acknowledge, `r` to refresh, `Escape` to leave a field.
- **Light and dark**, following the system or forced either way, and a **3 mm frame** in a primary
  colour you pick or take at random. A random pick chooses a hue rather than a colour, and the
  accent derived from it is adjusted until it clears 4.5:1 on the background in use — the frame only
  has to be seen, the accent is read.
- **The palette is measured, not judged.** `node scripts/check-contrast.mjs` reads it out of the
  stylesheet and holds every pair to WCAG: 4.5:1 for text, 3:1 for a shape that carries meaning.

### How it scans

It watches the transcript roots with recursive `fs.watch` and scans when something is written
rather than every few seconds. A burst of writes collapses into one scan, but never for longer than
`--max-debounce`: a session mid-turn writes continuously, and it is exactly the one worth reporting.
A slow full scan runs behind all of it, because an event the filesystem drops would otherwise never
be noticed.

What it pushes is a **delta keyed by session**, never a whole list — the browser updates the rows
that moved, so focus, selection and scroll survive an update.

| | |
| --- | --- |
| `GET /api/state` | paused or not, roots watched, provider states, last scan |
| `GET /api/sessions` | the current list |
| `GET /api/events` | SSE: `state` on connect, then `delta` and `state` as they happen |
| `POST /api/pause` `/api/resume` | pausing stops the watchers too, not just the output |
| `POST /api/refresh` | forces a scan, even while paused |

Starting it twice is not an error: the second one finds the first, prints its URL and exits.

### Handing over to VS Code

VS Code routes a URI to the **focused** window, so opening a session takes two steps: the window
holding its workspace is brought up first, then asked to reveal the session. `--handoff-delay`
covers the time a window takes to come up; raise it if a session opens in the wrong one.

```
vscode://file/<path>                                      the workspace, or the transcript
vscode://Anthropic.claude-code/open?session=<sessionId>    a Claude session
vscode://openai.chatgpt/local/<threadId>                   a Codex thread
```

The last two are **internal, unversioned routes of other people's extensions**, found by reading
their bundled code rather than any documentation. A release of either can change them, so the raw
transcript sits behind every handover and is reachable directly on every row.

One honest limit: nothing comes back from a `vscode://` call, so a URI the operating system accepts
and a missing extension then quietly ignores cannot be detected. The fallback covers a failure to
*launch*; the transcript action covers the rest.

Windows is implemented. macOS and Linux are written down and untested.

### Notifications

The feature that makes the service worth running with everything closed, and the easiest to ruin:
one notification too many and the channel gets muted for good. So the rules are mean.

- **Only what blocks you**, by default: a session entering `needs-action`. A turn merely finishing
  says nothing unless you ask for it with `--notify-on`.
- **At most one per turn.** After a session has been notified about, it stays silent until it runs
  again — which is what starts a new turn.
- **Only once it has really stopped.** A notification is held for `--notify-delay` seconds (5 by
  default) and dropped if the session starts working again in the meantime. A turn can end and
  resume within a second, and nothing on disk tells the two apart until a moment has passed.
- **Which statuses raise one** is a row of chips beside the switch. `needs-action` alone is the
  default; add `completed` to be told when a turn simply finishes, which is the most common reason
  to want to know.
- **Only the sessions you follow**, by default: a notification requires the session to be watched,
  and un-watching one silences it until it works again. `--notify-scope unacknowledged`, or the
  select beside the switch, changes the trigger to the acknowledgement marker instead — anything
  holding something you have not seen, including a session that was already running when the
  service started and which the eye therefore never marked. Acknowledging then silences it.
- **Nothing for a session it is seeing for the first time**, or a cold start would raise a toast for
  the entire history at once.
- **Enough to decide without opening anything**: workspace, provider, title, and why it stopped.
- **An action button**, not just a click.
- **A sound per status**, so what happened is audible before it is read. Only the platform's own
  sound events can be named — an application without a packaged resource cannot point a toast at a
  file of its own.
- A **global switch in the toolbar**, where you can see it, and `--notify-on` per status.

A toast carries two buttons: **Open the session** and **Show the list**.

In the **desktop application** they hand `heimdall-agents://…` straight back to the running
instance, so one click opens the session. In the **browser**, where no scheme can be owned, they
point back at the service and the page asks it to perform the handover — a detour, and the reason
the application exists.

The application raises toasts itself, instantly and under its own name and icon. `asm serve` on its
own raises them through PowerShell instead, measured at **331 ms**, and they read *Windows
PowerShell* because a bare service has no registered identity to carry.

macOS and Linux raise nothing at all yet. A missing notifier never takes the service down.

### Security

A service on `127.0.0.1` is reachable from every page your browser has open, so:

- it **binds to the loopback address only**, never `0.0.0.0`;
- it **checks the `Origin`** of every request, and the `Host` too — a hostile site can point its own
  domain at `127.0.0.1` and would otherwise look same-origin;
- it **mints a token at every start**, written to `~/.heimdall-agents/service.json` with
  owner-only permissions and carried by the URL above. Without it every route answers `401`.

The token lives in a file no website can read and no one can guess. It is the reason the URL is
printed rather than just the port.

## Statuses

Four, and there are four because that is the **intersection** of what every provider states in its
own transcript. A fifth that only one of them could support would be a promise the list could not
keep on the other, and this window shows both in one table.

| | Meaning |
| --- | --- |
| `running` | the turn is open — the provider has not closed it |
| `failed` | the turn ended on an error, a refusal or an interruption |
| `idle` | the model stopped; nothing more happens without you |
| `unknown` | open so long that nothing in the file can still be trusted |

Every one is read from the transcript, never deduced from a delay. `asm status` prints the reason,
because a status has to justify itself.

`idle` means *not working* — not *succeeded*. A finished answer and a question left unanswered are
the same thing here, and that is the point: the model has stopped and the next move is yours. Claude
Code uses `idle_prompt` for the same notion in its own notification events.

The clock does one job: `--stale-after` (default **30 minutes**) is when an open turn stops being
believed at all. It never changes *what* a session is, only *whether the file is still worth
reading*. It is not optional decoration — no provider writes "I died", so without it a session
killed mid-turn claims to run forever: 46 of 426 real sessions here, sorted to the top of the list.

Thirty is measured, not guessed. Across 68 782 silences inside an open turn, 99.9 % last under ten
minutes and only 22 exceed an hour — and those were turns abandoned and picked up the next day,
where *inconclusive* was the truthful label at the time. What it cannot do is check whether anything
is still alive; it counts, and nothing more.

**There is no `needs-action`, deliberately.** Neither provider writes a pending permission anywhere —
measured, 41 seconds passed between a tool starting and a rejection with not one byte written in
between, and Codex has zero approval events across some 32 000. A status that only a delay could
produce is a guess, and guesses raise false alarms.

### One promise, two ways of keeping it

**You are told when the model stops working.** Each provider answers that from its own file:

| | Claude Code | Codex |
| --- | --- | --- |
| finished its answer | `stop_reason: end_turn` | `task_complete` |
| stopped to ask you something | an unanswered `AskUserQuestion` | no such tool — it ends its turn to ask, so the line above covers it |

Different evidence, same behaviour, nothing installed on either side.

## Settings

The gear in the toolbar opens them, and so does **File → Settings** on `Ctrl+,`: where the transcripts are, what is scanned, how a status ages,
whether to start with Windows, whether to show the tray icon.

**Detect** probes for the transcript directories rather than guessing — the environment variable,
the usual place, a relocated profile — and counts what it finds under each. A directory that exists
but holds no transcript never wins, and when none does it says so rather than filling the field with
a plausible wrong answer.

Anything the providers are built with — the paths, the caps, the timeouts — asks for a restart, and
takes one. Everything else applies as you change it.

**Language and dates.** English and French, following the system and falling back to English. The
date locale is separate and defaults to following the language, with `ISO` available on its own:
`01/08` is the first of August or the eighth of January depending on the reader, and a column of
dates is where that matters, so English stays on `2026-08-01 14:30` unless told otherwise.

## Configuration

Everything is a command-line option; `asm help` lists them all. The defaults are identical to the
extension's, so the same machine produces the same list from either side.

The shared files stay in `~/.heimdall-agents/`: the resolved Claude titles, the marks and the
settings. An installation that predates the renaming keeps reading `~/.agent-sessions-manager/`
while that is the directory holding data — nothing is copied and nothing is moved, so a rename
cannot lose what you marked.

## Development

```sh
npx tsc --noEmit
npx eslint src
npx vitest run --minWorkers=1 --maxWorkers=8
npm run build && npx playwright test
```

The end-to-end tests build their own transcripts in a temporary directory, start a service of their
own on a free port with its own `--shared-dir`, and drive a real browser. They never read or write
the sessions and marks of the machine they run on. They exist because unit tests are not enough
here: M1 shipped a `watch` command with every unit test green that exited a tenth of a second after
starting, and a page that throws on its first line looks just as finished.

The service reads the interface files once and keeps them; restart it after editing `src/web`.

ESLint 10 with a flat config, so `--ext` is gone: `eslint.config.mjs` decides which files are
linted.

`src/core`, `src/model` and `src/providers` came over from the extension without a single edit,
with their tests — they never imported anything from `vscode`. `src/cli` is the only new code.
Keeping those three directories editable in both repositories at once is not the plan: the
extension is frozen, and changes are made here.

## License

MIT.
