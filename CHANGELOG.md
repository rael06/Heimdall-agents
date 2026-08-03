# Changelog

## 1.1.1

The window comes back after an update, which the dialog had been promising for
as long as it had existed.

`runInstaller` launched the installer with `/S` and nothing else. That installs
silently and exits, so updating from the interface closed the application and
left the screen empty — correct on disk, and indistinguishable from a failure
to anyone watching.

The relaunch needs `--force-run` **beside** `/S`, and neither works alone. It is
not a guess; it is in the NSIS template that builds this installer, on the
assisted branch this project takes by setting `oneClick: false`:

```nsis
# for assisted installer run only if silent, because assisted installer has run after finish option
${if} ${isForceRun}
${andIf} ${Silent}
  !insertmacro doStartApp
${endIf}
```

Found by updating 1.0.1 to 1.1.0 through the interface on a real machine. The
install was faultless — `1.1.0.0` on disk, `app.asar` down to 376,456 bytes —
and nothing was running afterwards.

The audit that produced 1.1.0 read `runInstaller`, noted the `detached` and the
`unref`, and took the dialog's sentence at face value instead of checking it
against the arguments being passed. Which is the whole argument for the test
that comes with this: the launch is injected now, so what gets run can be asked
about without running it, and the order — launch, then quit — is pinned as well.
`update.ts` had been left as "the network and the process launch, which cannot
be tested"; half of that was true.

## 1.1.0 — What an audit found

A review of the whole repository against security, interface, accessibility,
architecture, CI and release practice. Twenty-five findings, all of them fixed
here. Three were bugs rather than gaps, and each was found by writing the test
that should already have existed.

### A folder name could run a command

`folderUri` builds a handover URI with `encodeURI`, which leaves `&` alone
because an ampersand is legal in a URI path. That URI was handed to
`cmd /c start`, where `&` separates two commands. Measured through a protocol
handler registered for the test: a workspace called `R&D` reached the handler as
`…/projects/R`, and `D` was run as a command of its own. `cwd` is read out of a
transcript this program neither writes nor controls.

It goes through `rundll32 url.dll,FileProtocolHandler` now, which reaches the
same `ShellExecute` with nothing in between that reparses anything. `explorer.exe`
delivers the URI whole too and was rejected for answering `1` whether or not it
worked — an exit code that means nothing is worse than none, because the caller
believes it.

The existing test that looked like it covered this opened
`vscode://file/x" & calc` and expected a refusal. It passed on the quote. The
same check admits `vscode://file/C:/projects/R&D` without complaint.

### The accent could be a shade too pale to read

`readable` walks a colour towards white or black until it clears 4.5:1, then
rounds it to eight bits on the way out — and it was judging the fractional
colour rather than the rounded one it returns. A hue picked at random came back
at 4.4967:1 having been checked at more. The interface test asserted 4.4 rather
than 4.5, and that tenth of tolerance is exactly the width of the bug.

Found by moving the arithmetic into `src/web/lib.js`, where it can be asked
directly instead of through a browser.

### A newer release was announced as "up to date"

A release carrying no Windows installer was reported under that title, with the
reader's own older version printed underneath.

### Said plainly rather than implied

The update dialog claimed the installer is "checked against the length and
checksum published with the release", without a condition. The checksum was only
computed when the release carried `latest.yml`; without one the comparison was
skipped and a declared byte length was all that stood between a download and
running it. **A release with no manifest is no longer installed from**, and the
dialog says so before you choose rather than failing after.

### Accessibility

- `aria-sort` was set on the sort button. It is supported on a `columnheader`
  and nothing else, so it was read by nobody — which column orders the list, and
  which way, reached only people who could see the arrow, and the arrow is drawn
  in CSS. It is on the `th` now.
- The notices, the counter, the reorder offer and the empty message are live
  regions. That could not simply be switched on: each was rewritten on every
  state event, which is every scan, so a region would have announced the same
  sentence every thirty seconds until the channel was switched off. They are now
  written only when their content differs.
- `service-state` is deliberately **not** a region: it restates the last scan
  time, so it changes on that timer. What matters in it is exceptional — the
  stream dropping, a handover that led nowhere — and that goes to a hidden
  announcer instead.
- The table and the `main` landmark say what they hold.

### Interface

- **The toolbars wrap.** There was no media query anywhere, and `wrap` was a
  class on one bar out of four; the one with eleven controls was not it, so
  narrowing the window pushed the document sideways under a frame that is fixed
  and cannot follow. The suite now measures sideways scroll at five widths.
- **The body font size follows the reader.** It was the last value written in
  `px` while everything around it was in `rem`.
- **Two notification tooltips were English in place.** The interface test
  asserted that English wording, so the suite was holding the gap open.

### Security

- A content security policy, `Referrer-Policy: no-referrer` and `nosniff` on
  every answer. The token rides in the address — which is what lets a reload work
  and a filtered view be kept as a favourite — so the address is a credential.
  Moving it into a cookie was considered and dropped: a favourite that no longer
  authenticates is worse than the problem.
- Scan settings are bounded by the service rather than only by the form.
- The installer is written as it downloads instead of being held whole in
  memory, and a half-verified one is deleted rather than left in a temporary
  directory.

### Everything that runs the checks

There was no CI. Every gate in `CLAUDE.md` ran because somebody remembered, on
one machine — and a fresh checkout could not run any of them until `npm ci`.
Now: checks on push and pull request, on Windows, on node 20 and 24; a weekly
audit; Dependabot; and a release workflow that publishes from a tag and refuses
unless the tag, `package.json` and this file agree and both artefacts are
present with the manifest covering the installer.

`npm run dist` writes to `release/` rather than `dist/`. They shared a
directory, which made `files: ["dist"]` describe a **209 MB** npm package with
the installer inside it. It is 193 kB.

### The application was carrying its own history

Building 1.1.0 after separating those directories measured something the audit
had only called a risk. `dist/` was the TypeScript output *and* electron-builder's
output, and the packaging rule was `dist/**/*` — so every build packed the
previous installer inside the next application.

| | 1.0.1 | 1.1.0 |
|---|---|---|
| `app.asar` | 364,535,336 bytes | **376,456 bytes** |
| installer | 209 MB | **100 MB** |
| unpacked | 696 MB | **348 MB** |

The README said "200 MB installed, ~700 MB unpacked — that is what an Electron
application costs". The measurement was honest; the explanation was wrong. It
is corrected there rather than quietly dropped.

### Tests

412 from 335, and coverage measured for the first time: 63% from 49%, with a
floor so it can only go up. The Codex provider had 414 lines of source against
sixteen lines of test while the Claude provider next to it had 269 — it is at
87% now. `server.ts` carried every route and all request validation with no test
of its own; it is driven over a real socket, including the `Host` check, which
needed raw `node:http` because `fetch` drops a `Host` override silently and a
`fetch` version of that test would have passed against no check at all.

## 1.0.1

The checksum the update dialog promises was never being checked.

Publishing 1.0.0 revealed that the same installer is called three different
things: electron-builder writes `Heimdall-agents-Setup-1.0.0.exe` into
`latest.yml`, GitHub serves the asset as `Heimdall.agents.Setup.1.0.0.exe`, and
the file on disk has spaces. The lookup compared them literally, found nothing,
and **silently carried on without verifying** — the check advertised in the
dialog, and quietly not performed.

Found by running the real thing against the release two minutes after publishing
it, which is the only place three spellings could exist at once.

Two halves are fixed, because the comparison alone would have left the hole open
next time:

- **Names are compared as the same file** whatever separates their words —
  spaces, dots, hyphens or percent-encoding — while a genuinely different
  version is still refused.
- **A manifest that does not cover the file is now a refusal**, not a shrug. A
  release publishing a checksum that says nothing about what you are about to
  run is not a release to install from, and failing loudly beats downgrading
  silently.

## 1.0.0 — Heimdall agents

First public release, and a name that carries the design rather than describing
the function.

In Norse myth Heimdall keeps the watch on the Bifröst. Snorri writes that he
sleeps less than a bird, sees a hundred leagues by day and night, and hears the
wool growing on a sheep's back. And he blows the Gjallarhorn **once** — when the
enemy actually comes, not for every rustle in the dark.

That is the two halves of this application in one figure: a watch that never
sleeps, and an alarm that only sounds on evidence. Ten releases went into
removing every status this thing could only guess at; the name now says so.

### Everything is aligned, once

The URI scheme becomes `heimdall-agents://` and the application identifier
`com.rael06.heimdall-agents`. Changing the identifier costs one round of Windows
notification permissions — paid now, while there is a single user, rather than
by everyone the installer is later handed to.

The shared folder becomes `~/.heimdall-agents`. An installation that predates
this keeps reading `~/.agent-sessions-manager` for as long as that is the
directory holding data: nothing is copied and nothing is moved, so a rename
cannot lose what you marked.

### Published, and what that took

The repository this grew in was private, and the code carried the names of real
client projects in its test fixtures and its README examples, along with a
workspace path holding a home directory. All of it is replaced with neutral
names, and the search that found them was run again, widened, until it came back
empty.

Two of them are worth recording. One survivor was caught by a *test* rather than
by the search — a **truncated** fragment, used to check prefix matching, which
no search for the whole word could find. The other was this very entry: the
first draft named the projects while explaining that they had been removed, and
the check on the extracted tree caught it before anything was pushed.

The history is not carried over. Rewriting eight hundred commits to remove the
same strings is the surest way to miss one; this starts from a single commit,
and the private repository stays as the archive.

The README examples were stale on a second count, which is why they were
rewritten rather than patched: they still showed a `needs-action` status that
stopped existing in 0.23.0.

## 0.27.0

*Help → Check for updates…* asks GitHub what the latest release is, and installs
it when told to.

### Why not a ready-made updater

Electron's own `autoUpdater` [documents Squirrel.Windows and
MSIX](https://www.electronjs.org/docs/latest/api/auto-updater) on Windows and
says nothing about NSIS, which is what this application ships. `electron-updater`
does handle NSIS, and is a runtime dependency — of which this project has none,
deliberately.

So it is three built-in modules and one endpoint,
[`/repos/{owner}/{repo}/releases/latest`](https://docs.github.com/en/rest/releases/releases).
Every decision — which asset is the installer, whether a version is newer, what
the published checksum is, which hosts may be followed — lives in a pure module
with 15 tests. What is left over the network is the part that cannot be tested
without one.

### What it checks before running anything

The installer is unsigned, so it is worth being exact about what is verified:

- **the address**, at every hop — GitHub serves an asset by redirecting to
  `objects.githubusercontent.com`, and each redirect is checked to still be a
  GitHub host over TLS rather than only the first
- **the length**, against what the release declared
- **the checksum**, when the release carries electron-builder's `latest.yml`;
  the parser refuses to lend one entry's `sha512` to a neighbouring file, and
  says nothing rather than accept a near match

Without a code-signing certificate that is the whole of what can be verified,
and the dialog says so instead of implying more.

### It only speaks when asked

There is no check at startup and no periodic one. This application exists to
interrupt you about exactly one thing, and a second voice would cost the first
one its credit.

### It reports nothing rather than pretending

**There is no published release yet, and the repository is private** — an
unauthenticated request to a private repository answers 404, which is
indistinguishable from a repository with no releases. Both are reported in those
words: *no published release was found, and this says nothing about which it
is.* Verified against the real repository, which answers exactly that today.

The check itself is verified against real GitHub payloads: a release whose
version parses and compares correctly, and one shipping several `.exe` files —
where taking merely the first picked the arm64 build, which is why the installer
is now chosen by name.

**To make it do something**, a release has to exist and be reachable without a
token, which means the repository — or at least its releases — being public.
That is a decision about exposing this repository's history, and it is not one
a tool should take on its own.

## 0.26.0

**agent sessions** becomes **Agent sessions manager**, and the menu bar gains
the *Help* entry an application is expected to have.

### What the renaming touches, and what it deliberately does not

The window title, the tray tooltip, the page, the Start Menu shortcut and the
installed folder all take the new name. Two things keep the old one on purpose:

- **The application identifier** stays `com.rael06.agent-sessions`. Windows
  files notifications under it and remembers what you allowed against it — a new
  one would read as a different application, so the toasts you already permitted
  would go back to asking. The name on screen is ours to change; the identity
  the operating system was handed is not.
- **The shared folder** stays `~/.agent-sessions-manager`, which the new name
  happens to match already. Moving it would orphan every mark, resolved title
  and setting for no benefit.

The installed folder changes with the name, so the previous version has to be
uninstalled rather than installed over — two entries would otherwise sit side by
side in Add or remove programs.

### Help → Uninstall

It runs the uninstaller Windows already registered, rather than a home-made
removal: NSIS wrote the shortcuts, the registry entry and the protocol handler,
and it is the only thing that knows how to take them all back.

What it will not remove is said **before** it runs rather than discovered after.
The marks, resolved titles and settings live in their own folder and stay there,
so a later install picks up where you left off — and so uninstalling never
throws away what you spent time marking. The dialog names the folder, for
anyone who does want it gone.

*Help → About* says the version, the Electron and Node it runs on, and where
those shared files are.

## 0.25.0

The one remaining clock gets a defensible value, an explanation, and one fewer
reason to wake you.

### Three hours becomes thirty minutes

*Stop believing an open turn after* is what keeps a session killed mid-turn from
claiming to run forever — no provider writes "I died", so silence is all there
is to go on. Without it, **46 of 426 real sessions** would sit at *running*
permanently, and sort to the top of the list while doing it.

The old 180 was a guess. Measured instead, across **68 782 silences inside an
open turn**:

| | |
| --- | --- |
| median | 0.0 min |
| 99th percentile | 1.3 min |
| 99.9th percentile | 10.3 min |
| longer than 30 min | 38 of 68 782 |
| longer than 60 min | 22 of 68 782 |

Thirty minutes clears normal work three times over, and cuts the window a dead
session spends lying about itself from three hours to half an hour. The handful
of silences beyond it turned out to be turns abandoned and picked up the next
day — where *inconclusive* was the truthful label at the time anyway.

The setting now explains itself in the panel, including what it cannot do:
it counts, it does not check whether anything is still alive.

### `unknown` no longer rings

Each notification chip now says what being told about it actually means. Two of
the four are the model stopping work; the other two are not.

`unknown` is dropped from the notification list, because an open turn going
quiet is a fact about a **stale file**, not about a model stopping — and being
woken at three in the morning for a session abandoned yesterday is exactly the
alert that teaches people to ignore the channel. It keeps its column and its
filter; only the sound goes.

Dropped **once**, on a preferences file written before this version, and never
again: a chip you can tick that quietly un-ticks itself at the next start is a
setting that pretends to save. The choice is made for you the first time and
stays yours afterwards.

## 0.24.1

Acknowledging a session did nothing you could see. Neither did starring one, or
following one. The service was right the whole time — the window had stopped
redrawing.

### One wrong index, thirty seconds after every load

The minute counts on watched rows climb without anything being written, so they
are redrawn on a timer. That timer wrote into `children[3]`, which is the
**transcript** cell, not the minutes cell. Setting text on a cell destroys what
it contains, so the `▤` button was deleted. The next redraw looked for that
button, found `null`, and threw:

```
TypeError: Cannot set properties of null (setting 'title')
  at updateRow → syncRows → render
```

A redraw that throws stops where it is. Every row **after** the first watched one
kept whatever it was last painted with — its unseen dot, its star, its eye —
regardless of what the service said. Clicking a notification, opening a session
and *mark all as seen* all failed the same way, because all three end in the
same redraw.

It looked provider-specific because it is positional: watched sessions sit at the
top of the list, and everything below them freezes. Codex rows happened to be
above the first watched row.

Traced by comparing what the service reported with what the window drew: the
acknowledgement was recorded on disk within milliseconds and the dot stayed lit.

### The fix, and the class of bug it closes

Every cell is now addressed **by name** rather than by position, in both writers,
so they cannot drift apart again. Positional access is what let one of them fall
out of step with the markup and go unnoticed.

The end-to-end suite gains the invariant the bug violated: the minutes land in
their own cell, and the transcript button is still there afterwards. The timer
itself is not covered — a test would have to wait thirty seconds, and adding a
hook to hurry it along would be test-only machinery in a production path.

## 0.24.0

A session could sit at *running* forever and never notify. The status was right
on disk and wrong in the window, and the cause was one line of caching.

### A clock that does not tick

Both providers keep their transcript **open** for the whole session and append
to it. On Windows the modification time of a file is not updated while its
writer still holds it open — so the clock stands still while lines are being
written.

Measured on a real Codex rollout: the file reported `00:39:41` while its last
line, a `task_complete`, was written at `00:39:49`. The provider cache asked
only *has the modification time changed?*, concluded nothing had, and served a
finished turn as *running* for as long as the session stayed open. A fresh `asm
list` was right every time, because it has no cache — which is exactly what made
this hard to see.

Nothing downstream was broken: the transition never happened, so there was
nothing to notify. Touching the file was enough to unstick it, and the
notification fired the same second. That is how it was found.

The cache now compares **modification time *and* size**. The size moves on every
append, comes from the same `stat`, and costs nothing. Applied to both providers,
because the same file habit affects both.

The test that guarded the old behaviour asserted the bug — *same mtime, trust
what was read* — and is replaced by one that appends without moving the clock.

### The *now about* column is gone

Claude rewrites its generated title as the subject drifts, and the later ones
filled a second column. Codex writes nothing of the kind, so the column was
blank on half the list. A column only one provider can fill is not a column this
application can offer, so it is removed along with its sort options — the same
rule that settled the statuses in 0.23.0.

The title itself is unchanged: still the first one, because a name that changes
under you cannot be learned.

## 0.23.0

One promise, kept identically on every provider: **you are told when the model stops working.**
Nothing else, and nothing installed anywhere.

### Four statuses, because four is the intersection

The window shows both providers in one table, so a status only one of them could support would be a
promise the list cannot keep on the other. What every provider states in its own transcript:

| | Meaning | Claude Code | Codex |
| --- | --- | --- | --- |
| `running` | the turn is open | `tool_use`, `null`, `pause_turn` | `task_started` unmatched |
| `failed` | it ended badly | `refusal`, `max_tokens`, an interruption | `turn_aborted`, `error` |
| `idle` | it stopped; your move | `end_turn`, `stop_sequence` | `task_complete` |
| `unknown` | open so long nothing is trustworthy | the clock, identically on both |

`completed` is renamed **`idle`**, because the old name was no longer true: it now covers a finished
answer *and* a question left unanswered. `idle` says what is actually known — the model is not
working — without claiming anything succeeded. Claude Code uses `idle_prompt` for the same notion in
its own notification vocabulary. In French it reads *en attente*.

Stored preferences are migrated on read: `completed` and `needs-action` both become `idle`, deduped.
Dropping them would have silently emptied the notification list of anyone who had asked to be told,
which is worse than a setting that was never offered. The sound a finished turn had is kept, so
nothing changes to the ear.

### `needs-action` is gone, and it is the point

It was the one status that rested on a capability a single provider has, and on a delay for the
rest. Neither provider records a pending permission anywhere: 41 seconds passed between a tool
starting and a rejection with not one byte written in between, and Codex has zero approval events
across some 32 000 — searched in the rollouts *and* in 131 324 log rows, for five different event
names. A status no file supports is a guess, and a guess raises false alarms.

With it go the tagged-answer route and *treat a final answer that asks something as needing action*,
a text heuristic that was true on neither side. A turn that ends on a question still notifies — as
`idle`, because the turn ended.

### How a question is handled on each side

Claude Code has a tool for it, and writes it down: an `AskUserQuestion` left unanswered is the model
having stopped, so it reads `idle` — verified, it carries `stop_reason: tool_use` and the turn stays
open while you think. Codex has no such tool: measured across 104 sessions, every tool it calls is
`shell_command`, `exec`, `apply_patch`, `wait` and the sub-agent family, and none of them asks you
anything. It ends its turn to ask instead, which `task_complete` already covers.

Two mechanisms, one behaviour — which is what [CLAUDE.md](CLAUDE.md) requires, and the test it sets:
not *is it the same code*, but *does the reader see the same thing*.

### Extending it

A new provider owes three things: identity, a title, and the turn in a closed set — *working*,
*stopped cleanly*, *stopped on an error*. Anything else it can add must not change what is shown.
And if it cannot answer explicitly, it does not guess: it says so, and the session reads `unknown`.

## 0.22.0

The hooks are gone, and the statuses got **more** accurate, not less. Both providers were already
writing the answer into their own transcripts; nothing was reading it.

### What the files actually say

Claude Code puts `stop_reason` on every assistant entry — the field the [Messages
API](https://platform.claude.com/docs/en/api/messages) defines. Measured over 60 transcripts and
26 911 assistant entries: `tool_use` 24 689, `end_turn` 1 127, `null` 1 083, `stop_sequence` 12. It
was present every single time.

| Value | Documented as | Now read as |
| --- | --- | --- |
| `end_turn` | *a natural stopping point* | the turn is over |
| `tool_use` | *the model invoked one or more tools* | a tool is running |
| `null` | *null in the `message_start` event* | the answer is being written right now |
| `pause_turn` | *we paused a long-running turn* | still going |
| `max_tokens`, `refusal` | — | the turn was cut short, which is a failure |

Codex writes `task_started` / `task_complete`, paired by `turn_id`, plus `turn_aborted`. Measured
over 104 sessions: 1 766 starts, 1 723 completions, 86 sessions closing cleanly.

That `null` is the one that earns its keep. A ten-minute thinking phase used to be indistinguishable
from a finished turn if you only had a clock; now it is *stated* as work in progress.

### The guess that had to go

Past a delay, an open turn was promoted to *waiting for you*. On disk, a permission prompt and a
command that takes four minutes are the same object — a turn that has not ended — so no delay could
ever separate them, and that promotion was wrong on every slow command.

Measured on a real rejection in this repository's own transcript: **41 seconds** between the tool
starting and the answer, with not one byte written in between. The wait is the gap between two
lines. Codex says nothing either — zero approval events across ~32 000.

The promotion is gone. Verified against the real history: **426 sessions, not one** *"a tool is most
likely waiting for your permission"* remaining. Every `needs-action` left comes from something the
transcript records.

The cost is stated plainly: a session blocked on a permission now reads as *running* and raises no
notification until you look. That is the trade — silence over a false alarm — and it is deliberate,
because an alert you learn to distrust is an alert you stop reading.

### What went with it

`--running-timeout` and *Still running after* are gone: they only fed the promotion, and a setting
that appears to do something and does nothing has no business existing. `--stale-after` remains,
with one honest job — when to stop believing an open turn at all.

Also removed: the whole hook machinery. The reporting script, the signals directory, the
`/api/settings/hooks` endpoint, `--hook-signals`, and the *Where statuses come from* panel shipped in
0.21.0 one release ago. Both providers are now supported by exactly the same means, with nothing
written into anyone else's configuration and nothing to keep in sync.

## 0.21.0

Hooks stop being a thing you install and become a thing you choose, with the price of each one
written on it.

**They were never mandatory.** The published documentation settles it: a hook is a shell command
Claude Code runs on an event, and every event is optional. Everything this application shows already
comes from the transcripts, which are on disk whether or not anything is configured. Saying so
plainly is the point of this release — the previous *Install the Claude Code hooks…* entry offered
one all-or-nothing bundle and never said what it cost.

### Three sources, and what each one buys

Settings → *Where statuses come from*.

| Source | Buys | Costs |
| --- | --- | --- |
| Read the transcripts | Everything already on disk | Nothing. Always on, cannot be switched off. |
| The CLI reports when it wants you | A pending permission, told apart from a slow command | Nothing while you work. `Notification` is documented as non-blocking. |
| The CLI reports every tool it starts | An immediate *still working* | ~295 ms per tool call. `PreToolUse` runs *before* the call and can block it. |

They are not combined into a single answer, because a session has one status rather than a
conjunction of them. Both on means both may report; whichever speaks first is heard; the transcripts
stand underneath whenever neither does.

### The middle one is new, and is the one that was missing

The `Notification` event fires only when Claude Code actually wants your attention — a permission, a
question, an idle prompt — and the documentation lists it as non-blocking. That is the ambiguous
case solved at no cost in latency, which is what the blocking bundle was being paid 295 ms a call
for. Each kind is routed by its **matcher**, which is evaluated against the notification type, so
what a hook means is decided in the settings file rather than by inspecting a payload field the
documentation does not spell out.

### Nothing is written before it is shown

Ticking a source opens a confirmation carrying the real file, the real script path and every entry
that would be added, read back from what would actually be written rather than described a second
time by hand. Hooks belonging to anything else are kept, unticking removes only ours, and doing
either twice changes nothing.

What is installed is **read back out of the settings file** every time the panel opens, never
remembered. A remembered copy would be a second truth, and that file can be edited by hand, by
another tool, or by a synchroniser — in which case the copy would be wrong and the switch would lie.

*Trust what the provider hooks report over what is inferred* is gone as a switch of its own: it was
a second control for the same decision, and one could contradict the other. It now follows the
sources — installing one starts reading what it writes, removing the last one stops.

### A correction

The 0.20.0 note above claims `PostToolUse` was removed because it "doubled the latency on every tool
call". That was wrong: the documentation lists `PostToolUse` as **non-blocking**, so it never cost
latency. It stays out for the reason that does hold — it reports what the tool starting already
reported, and what the next tool will report again — but the measurement it was justified with did
not apply to it.

### Known limitation

If `~/.claude/settings.json` is generated from somewhere else (Rulesync, a dotfiles repository), the
panel reads it correctly but its writes are overwritten by the next sync. Add the entries at that
source instead. Said in the README rather than worked around.

## 0.20.0

One fewer hook, because it was costing latency on every tool call and saying nothing new.

Measured: **295 ms per hook**, and `PreToolUse` runs *before* the tool it announces, so its cost is
paid in latency rather than in the background. `PostToolUse` doubled that on every tool call — about
a minute across a hundred of them — to report a fact `PreToolUse` had already reported at the start
of the tool, and would report again at the start of the next one. It is gone.

### What the remaining hooks are actually for

Measured on synthetic transcripts, with hook signals switched off:

| | Inference alone |
| --- | --- |
| A turn that ended | `completed`, correctly and at once |
| A tool started ten seconds ago | `running`, correctly |
| The same tool four minutes later | **`needs-action`** — *"a tool is most likely waiting for your permission"* |

So inference settles turn ends on its own; `Stop` and `UserPromptSubmit` mostly confirm what it
already knows. What it cannot do is tell a slow tool from a pending permission — on disk they are
the same thing, a transcript that stopped mid-turn — and past the running timeout it guesses
*permission*, which is the false notification that started this.

That is the whole value of the hooks: **truth for the one ambiguous case, and speed for the other**
(a permission is reported the moment it happens rather than ninety seconds later). Everything else
they report, the transcript already says.

## 0.19.1

Statuses are translated, and everything holding a date redraws when the locale changes.

Two gaps in the first pass, both found by using it. The statuses were left as their raw
identifiers — `needs-action`, `running` — in the filter chips, the notification chips, the row
tooltip and its accessible label. Providers are deliberately *not* translated: `claude` and `codex`
are names, and translating a name only makes it harder to recognise.

Changing the language or the date locale redrew the rows and nothing else, so the last-scan time in
the header and the status names in the chips kept the previous language. Changing a setting and
watching half the page follow is worse than not offering it. One function now rewrites everything
that carries a translated word or a formatted date.

## 0.19.0

English and French, with the date locale settable on its own, and Settings where an application
keeps it.

The language follows the system and falls back to English — not as a default but as a *fallback*: a
key missing from a translation resolves to English silently, so a partial translation degrades to a
readable page rather than to blanks.

**Dates follow the language, and can be taken off it.** `auto` means "whatever the language says";
`iso` keeps `2026-08-01 14:30`. That option exists because the plan chose that format deliberately,
over the ambiguous ones, and it was right to: `01/08` is the first of August or the eighth of
January depending on the reader, and a column of dates is exactly where that matters. So English
stays on ISO under `auto`, French moves to `fr-FR`, and either can be overridden.

**Settings is in the menu bar**, under File, on `Ctrl+,` — the place and the shortcut every editor
already trains you to reach for. The panel lives in the page, so the menu calls a function the page
publishes by name rather than simulating a click on a button that may move.

### Notes

The dictionary is served as a classic script before the module and publishes what it exports on
`globalThis` explicitly, rather than relying on the implicit globals of a classic script — so a typo
on either side is an error rather than a silent `undefined`, and ESLint checks it instead of being
silenced.

A regression the end-to-end tests caught: the transcript icon lost its tooltip entirely when its
hard-coded `title` was removed and no key put in its place.

## 0.18.0

A settings panel, behind a gear, with detection.

Configuring the transcript locations **at install time** was the request, and doing it there would
have been worse: a path chosen once by an installer is frozen, and these move — a relocated home, a
`CLAUDE_CONFIG_DIR`, a second account. The panel covers the same moment without the trap, and it can
be opened again a year later.

**Detection probes rather than guesses.** It tries the environment variable, the usual place and a
relocated profile, and counts transcripts under each. A directory that merely *exists* does not win:
`~/.claude` exists on a machine that only ever ran the extension. When nothing holds a transcript it
says so instead of filling the field with a plausible wrong answer.

Also in the panel: the sessions cap, the history window, both status timeouts, the question
heuristic, hook signals, orphan sub-agents, auto-watch and the handover delay — the settings that
until now only the command line could reach, which the installed application does not have.

**Start with Windows** and **show the tray icon** are there too, and they are the reason the service
gained a host adapter. Neither is a property of a service, and the service is shared with a command
that has no window at all — so the application passes them in and the command passes nothing. The
section is hidden rather than shown-and-ignored when the host cannot offer it.

Anything the providers were built with asks for a restart, and takes it: they are constructed once,
and no setter reaches back into them. Everything else applies at once.

## 0.17.0

The installer is now genuinely standalone: nothing is left to configure by hand.

Everything the application needs was already self-contained except the hooks, and those are the one
thing an installer cannot simply do — they live in Claude Code's own settings, which belong to the
user and may already hold hooks of their own. *Install the Claude Code hooks…* in the tray does it
as an offer instead: it copies the script beside the shared files, **merges** into
`~/.claude/settings.json` rather than overwriting, keeps anything that is not ours, and changes
nothing when run twice.

The script is copied out of the application rather than pointed at inside it, so an upgrade that
replaces the install directory cannot leave the settings aimed at a path that no longer exists.

Without the hooks nothing breaks — every status is inferred, as it always was. What they buy is the
case inference cannot solve: a command that runs for minutes writes nothing, and until the running
timeout expires it is indistinguishable from a turn abandoned mid-write.

### Packaging

The hook script now ships. Compiled test files and source maps no longer do — they had been going
out with every build.

The installer is **not code-signed**, so Windows shows *Windows protected your PC* on a machine that
has not seen it before. That is a certificate to buy, not a line to write, and it is written into
the README rather than left for whoever receives it to work out.

## 0.16.3

Secondary text is secondary, not switched off.

The provider badge was the same mistake as the dates, one step later: `claude` is the value of the
provider column, and it was grey only because it happens to be drawn as a badge. The shape is the
decoration; the word is data. It reads at full contrast now.

The rest — column headers, the counter, the notices, the field labels — went from about 7:1 to
about 11:1. They label the data rather than being it, so they still step back, but by a little
instead of by enough to read as disabled.

`completed` moved with them. It is the quietest status on purpose, and it had ended up quieter than
the column headers above it, which is not a hierarchy but an accident.

## 0.16.2

The data in a row is read at full contrast; only the chrome stays quiet.

Dates, workspace and minutes were grey because they were treated as secondary to the title. They
are not: they are as much the answer to *which one is this* as the title is, and greying them was a
hierarchy applied further than it earned. What stays quiet is what is genuinely around the data —
column headers, provider badges, the visible/loaded counter, the notices.

Both were already above the threshold, so the check had nothing to say about it. Passing a
contrast target is not the same as putting the emphasis in the right place.

## 0.16.1

Nothing recedes with `opacity` any more, and the check covers every background a row can have.

The contrast check passed while two things on every row sat near **2:1**. It was measuring the
palette, and the unset markers and the transcript icon were not wearing the palette — they were
wearing it at `opacity: .45` and `.35`, which is a colour no variable holds and which lands
differently on each theme. They recede by a colour of their own now, `--faint`, which can be
measured.

The check was also only ever asking about the plain background. A row can be hovered, selected, or
be a pressed chip, and text has to hold up on each. **Twenty-five pairs per theme** are checked now
instead of eleven, and settling `--faint` took the selected row — the tightest of the three — rather
than the one that happened to be looked at first.

## 0.16.0

A theme you can force, a frame you can colour, and a palette measured rather than judged.

**Contrast, checked.** `scripts/check-contrast.mjs` reads the palette out of the stylesheet that
ships and reports every pair against WCAG. It found the one real failure: **every border sat at
1.36:1**, which is why the table read as floating text. `--line` and `--edge` are now separate — a
row separator should be quiet, but the border of a control is what tells you where the control is,
and it has to clear 3:1. Everything now passes, in both themes.

**One palette, written once.** `light-dark()` picks the branch from the used colour scheme, so
forcing the scheme on the root *is* the theme toggle — no second copy of every value to drift.
The toggle cycles auto, light, dark; auto follows the system as it changes, not only at load.

**A 3 mm frame**, in a primary colour you choose or take at random. It is drawn as a fixed overlay,
so it stays put while the list scrolls under it and takes part in no layout.

The random button picks a *hue*, not a colour, so the frame always reads as deliberate. And the
accent derived from it is walked towards white or black until it clears 4.5:1 on the background in
use: the frame only has to be seen, but the accent is read as text, and a colour chosen at random is
about as likely to be illegible as not. An end-to-end test asserts that over six random picks.

Rows answer back on hover, which a table this wide needed.

## 0.15.0

A long-running tool no longer looks like an abandoned turn, and the title column stops setting the
width of the table.

**The false alarm.** A notification fired while the model was plainly still working. It was right by
its own lights: a command running for fifteen minutes writes nothing to the transcript while it
runs, so the last activity froze at the moment the tool started, the running timeout expired, and
inference concluded the session was waiting for someone. This is the exact case `signals.ts` was
written for — *the transcript alone cannot tell a turn still running from one abandoned mid-write,
nor a pending permission from a slow tool* — and the hooks simply were not reporting it.

`PreToolUse` and `PostToolUse` now report, for every tool, so the fact is refreshed at both ends of
each one. A question is excluded from both: it reaches a hook as a tool starting, and saying
*running* there would overwrite its own hook with the opposite of the truth.

**Titles are cut** at 46 characters, with the whole of it in the tooltip, which reverses the earlier
decision to scroll rather than truncate. What settled it: one session here is called
`<command-message>pr-review</command-message> <command-name>…`, and it alone pushed every column
after it off screen. The width of the table was being set by its worst row rather than by what is
worth reading. `now about` is cut the same way, or the row would still be stretched by the other
half.

## 0.14.0

The title stops moving, and what the conversation turned into gets a column of its own.

Claude rewrites its generated title as the subject drifts, so a session can carry several. The
list took the last one, which meant a session could be called one thing in the morning and another
by the afternoon — and a name that changes under you cannot be learned, which is the whole point of
a list you scan rather than read.

The **first** generated title now names the session and keeps it. The **last** goes in a *now about*
column, filled only when it disagrees with the name, so a full cell always means the conversation
moved and an empty one always means it did not. A title you typed yourself still wins over both.

Sortable like every other column, and shown by `asm status` when it has something to say.

### Fixed

A NUL byte in `src/service/delta.ts`, the same accident as the one in `app.js`: it worked, and it
made the file read as binary so `grep` skipped it. Every source file was swept; these were the only
two.

## 0.13.1

The installer no longer drops a shortcut on the desktop.

The Start Menu one stays, and it is the one that carries the AppUserModelID a toast needs. A
desktop shortcut is a matter of where its owner keeps things — and recreating one at the root on
every install undoes any tidying they did, quietly, every time.

## 0.13.0

A notification waits for the session to have really stopped, and the statuses that raise one are
chosen from the interface.

**The quiet period.** Notifying on the transition is fragile: a turn can end and resume within a
second — a stop hook re-entering, a sub-agent handing back, a tool starting again — and nothing on
disk distinguishes the two until a moment has passed. A decision to notify is now held for
`--notify-delay` seconds (5 by default) and cancelled if the session stops qualifying before the
delay is up. Being told a session finished while it is still working is worse than being told late.

The wait is not restarted by each scan: it measures quiet since the session stopped, not since it
was last looked at.

**Which statuses notify** is now a row of chips beside the switch, and remembered like the rest.
`completed` is the one worth naming: a turn ending is the most common thing that happens and the
most common reason to want to be told, and with only `needs-action` selected the application speaks
only when it believes you are blocked — so finishing looks exactly like nothing happening.

That gap was found by using it: a turn ended, no notification came, and the reason was that a turn
ending is `completed` and nothing was listening for it. The hooks this replaced played a sound on
every `Stop`, so it had been covered all along without anyone having to choose it.

## 0.12.0

A sound per status, carried by the toast itself.

The hooks this replaced played three distinct sounds — one for a finished turn, one for a needed
permission, one for a question — and they played them *always*: the extension they were written to
defer to had never been installed, so the check for it always failed and the fallback was the only
path ever taken.

Losing that left one generic platform sound for everything. The toast now names its own, so what
happened is audible before it is read. Only the platform's own sound events can be named: an
application without a packaged resource cannot point a toast at a file of its own, so the bundled
`.wav` files could not be carried over as they were.

## 0.11.0

A refresh button that actually refreshes the list.

There was a *Scan*, and it only asked the service to re-read the transcripts. Everything after that
depended on a push arriving — and a push can be missed. A stream that dropped and reconnected has a
hole in it, and nothing on screen says so; the list would simply be a little wrong, indefinitely,
with no way to make it right short of reloading the page.

*Refresh* now does both halves: it forces the scan, then takes the whole list back from the service
and draws it. It is also the one moment a pending reorder is applied without a second question,
because asking for a refresh is the asking. The search and the filters survive it — refreshing is
not resetting, and `Reset` is next to it for that.

On `r`, alongside the other keys.

## 0.10.0

Notification settings are remembered, and the hooks now feed this application alone.

The switch and the scope were in-memory only. That was survivable while another notifier existed
and this one was a second opinion; it is not survivable once this is the only one. A setting the
desktop application cannot remember is a setting it does not really have, since it has no command
line to be told again. They live in `preferences.json` beside the marks — its own file, because
`marks.json` is written by the extension too, in a shape both sides agree on.

Precedence: the command line seeds them, the interface owns them from the first change onwards.

`report-session-status.ps1` gained a `-Provider`, because the neutral hook definition generates for
Codex as well as Claude. Without it a Codex hook would write signals labelled `claude` carrying a
thread identifier, which match no session and quietly pile up.

### Fixed

A stray NUL byte in `src/web/app.js`, used as a separator when building the workspace signature. It
worked, and it made the file read as binary — `grep` skipped it and diffs were useless on it.
A newline does the same job and neither can appear in a path.

## 0.9.0

Hook signals, which the application had always been able to read and had never been given.

`~/.agent-sessions-manager/status` did not exist on the machine this was built on. `useHookSignals`
defaults to true, `signals.ts` and `signalStore.ts` were ported and tested — and no hook had ever
written a single file. Every status has been inferred from transcripts all along, which means a
pending permission was indistinguishable from a slow tool until `--running-timeout` expired: ninety
seconds of a session waiting for you while the list said it was working.

`hooks/report-session-status.ps1` closes that, and the README documents the contract so any script
can do the same.

`AskUserQuestion` was added to the events that map to a status. It arrives as a `PreToolUse`, which
maps to *running* — so a session asking you a question would have been reported as busy, which is
the opposite of the truth and worse than saying nothing.

## 0.8.0

Notifications can follow the acknowledgement marker instead of the eye.

Until now a notification required the session to be **watched**. That is narrow by design, and it
has a gap that only shows in use: a session is watched automatically when it is seen *starting* to
run, so one that was already running when the service came up never qualifies — and never notifies,
however much it then waits for you.

`--notify-scope unacknowledged`, or the select beside the switch, changes the trigger to the
acknowledgement marker: anything that stopped with something you have not seen. Acknowledging a
session becomes the way to silence it, rather than un-watching it. `watched` stays the default,
because the mean rule is the one that keeps the channel usable.

The ordering inside a scan already made this work: marks are applied before notifications are
chosen, so a session that just stopped is already marked unseen when the decision is taken.

## 0.7.0

Sortable columns, filters that can widen, and marked sessions grouped first.

**Every column sorts, both ways.** A header is a control rather than a label: clicking it sorts by
that column, clicking again reverses. The select and the headers are the same setting said twice,
so they stay in step, and both live in the URL. Provider and workspace became sortable on the way.
`status-asc` is the priority order — needs action first — because it ascends the display rank
rather than the alphabet. The names earlier versions wrote, `status` and `title`, still resolve, so
a bookmark or a shell alias keeps working.

**Filters combine with all or any.** Until now every active filter had to hold. `any` widens
instead, which is how you ask for "what is running, or anything at all on webshop". Only the filters
actually switched on take part: an inactive one is absent rather than true, or `any` would return
the whole list whatever else was asked. The search is deliberately not part of it and always
narrows — a search widened by an OR would return sessions that do not contain what you typed.

**Watched sessions come first, then starred ones.** This reverses the rule that marked sessions are
never lifted, and it reopens the case that rule was written for: `auto-watch` marks a session the
moment it starts working, so the lift can happen without anyone asking. What keeps it honest is the
guard built in M3 — the list compares the order it wants against the order on screen and offers the
move rather than taking it. The grouping applies; nothing jumps under the cursor.

Two end-to-end tests were wrong rather than the code, and both for the same reason: marks are
shared state that outlives a page, so a test that cares about ordering now says what it expects
instead of inheriting what ran before it.

## 0.6.0

M6: a desktop application, installed, with an identity of its own.

This reverses the decision recorded in issue #1 to stay in a browser, and the owner made the call
knowing the cost. What an installed application buys is not comfort but capability:

- **Its own protocol.** `agent-sessions://open?id=…` is registered, so a notification button hands
  the request straight back to the running instance. One click opens the session — no browser page,
  no second click. That detour existed only because a browser tab cannot own a scheme.
- **Its own identity.** With an AppUserModelID and a Start Menu shortcut, a toast carries this
  app's name and icon and appears under it in the Windows notification settings, instead of reading
  *Windows PowerShell*.
- **Toasts that cost nothing.** Raised through Electron rather than by spawning PowerShell, so the
  third of a second per notification goes away.
- **Two buttons**, as the plan wanted the notification to be actionable: *Open the session* and
  *Show the list*.
- A tray icon, closing to the tray rather than quitting — a service that stops watching when you
  close the window would defeat its own purpose — and an opt-in *Start with Windows*.

Nothing was rewritten. The application starts the very same service `asm serve` starts and loads
the very same page; the bootstrap both use was pulled out of the command into `service/bootstrap`,
so there is one of it rather than two that drift. `asm serve` still works on its own.

**Measured, and worse than the estimate that had rejected Electron**: the standalone service settles
around 54 MB, the application around 410–445 MB. The plan predicted 150–200 MB. The installer is
200 MB and unpacks to 696 MB.

The icon is generated by a script rather than committed, so there is no opaque binary in a
repository that may go public.

### Fixed

A handover reported success and opened nothing, whenever the service was started from a VS Code
terminal. It inherits `ELECTRON_RUN_AS_NODE=1`, which makes `Code.exe` run as a Node interpreter
instead of as the editor — it answers `bad option: --open-url` and exits quietly, while `start`
returns 0 and the failure stays invisible. `ELECTRON_*` and `VSCODE_*` are now stripped from the
environment handed to anything we launch.

Found only because the handover was tried for real. It had 15 unit tests, all green, all passing
against a fake that could not have known.

## 0.5.0

M5: it tells you when something needs you, with everything closed.

The rules are deliberately mean, because one notification too many and the channel gets muted for
good. By default only a session entering `needs-action` raises one; a turn merely finishing says
nothing unless `--notify-on` asks for it. At most one per turn, where a new turn begins when the
session runs again. Nothing for a session dismissed with the eye, and nothing for a session being
seen for the first time — on a cold start that would raise a toast for the whole history at once.

A toast button can only carry one URI, and opening a session takes two steps, so it points back at
the service: the page asks it to perform the handover properly rather than firing the second step
at whichever VS Code window happens to hold the focus. The session to open is read out of the URL
before it is rewritten, so a reload does not open it twice.

Windows, through PowerShell, measured at **331 ms** per toast rather than the 932 ms the plan
recorded — so a bundled `SnoreToast.exe` stays a trade to make when the delay is felt. The payload
reaches PowerShell through a file rather than a command line: it carries session titles, which
contain quotes, ampersands and angle brackets often enough that a command line is the wrong place
to discover it. The escaping is unit tested against a title that is literally XML.

The global switch sits in the toolbar rather than in a settings file: a channel whose state you
cannot see is a channel you end up muting at the operating system level instead.

macOS and Linux raise nothing yet, on purpose. A missing notifier never takes the service down, and
a toast that fails is never waited for — showing one costs about a third of a second, which a scan
must not be held up by.

## 0.4.0

M4: a click opens the session in VS Code.

Handing over takes two steps, and the reason is not ours: VS Code routes a URI to the **focused**
window. So the window holding the workspace is brought up first, and only then asked to reveal the
session, with `--handoff-delay` covering the time a window takes to come up.

```
vscode://file/<path>                                     the workspace, or the transcript
vscode://Anthropic.claude-code/open?session=<sessionId>   a Claude session
vscode://openai.chatgpt/local/<threadId>                  a Codex thread
```

The last two are internal, unversioned routes of other people's extensions, found by reading their
bundled code. A release of either can change them, so the raw transcript sits behind every
handover — and is also reachable directly, on every row and on `t`.

What no fallback can catch is a URI the operating system accepts and a missing extension then
ignores: nothing comes back from a `vscode://` call. The fallback therefore covers a failure to
*launch*, and the explicit transcript action covers the rest. Said plainly rather than implied.

The `Desktop` adapter is written for the three platforms and implemented for Windows; the others
are declared and untested, because the machine to test them on is not this one. It refuses any URI
it could not have built itself, so nothing assembled elsewhere reaches a shell.

`uris.ts` lost the helpers that only made sense inside the extension — a handover addressed to our
own extension id, and a VS Code command that can only be invoked from within VS Code. They were
ported unchanged in M1, and M4 is what makes them dead.

Clicking a title, a workspace or a transcript acknowledges the session at the same time: opening it
is seeing it.

## 0.3.0

M3: the browser interface, and the two markers the extension never had.

Nothing reorders itself. A row's position depends on the chosen sort and on nothing else, so a
status changing repaints that row where it is. When a sort genuinely *would* move rows, the list
refuses to jump and offers the move instead. Rows are addressed by identifier and their cells are
rewritten in place, so focus, selection and scroll survive an update.

Watched and starred survive as markers and filters without the lift to the top, drawn hollow when
unset and filled when set: colouring the difference alone made every row look marked, and left
nothing for anyone who does not see the colour.

An acknowledgement dot rides on the corner of the status icon rather than taking a column of its
own. It says "this status is new to you", which is a property of the status, so it belongs to it —
and the row keeps one marker fewer before the title, which was the density worry. It lights when a
session stops, clears when it starts working again, on a click, or through an action that settles
what is on screen and never the rows a filter is hiding.

It lives in its own file next to the marks rather than inside them. `marksStore` rebuilds its
object from the keys it knows, so a field added to `marks.json` is dropped the next time the
extension writes it: while both run side by side, a shared file may only be written in the shape
both agree on.

Minutes in the current status are shown on watched rows only. Nothing records when a status began,
and nothing needs to: the service dates a change it observes exactly, and falls back to the last
write for a session already in its status when it started.

Search stays on the service because it reads the transcripts, and says which field matched. Every
other filter is applied in the browser, instantly. Filters, sort and search live in the URL, so a
view reloads and can be kept as a bookmark.

End-to-end tests came with it, driving a real browser against a service with its own transcripts,
its own port and its own shared directory. One of them ends a turn on disk and waits for the row to
change on its own — which covers the watcher, the delta and the acknowledgement in a single pass.

## 0.2.0

M2: a local service watches the transcripts and pushes what changed.

`asm serve` binds to `127.0.0.1`, checks the `Origin` and the `Host` of every request, and mints a
token at every start written to `~/.agent-sessions-manager/service.json`. Without that token every
route answers `401`; the `Host` check is there because a hostile site can point its own domain at
the loopback address and would otherwise reach us looking same-origin.

Scanning is driven by recursive `fs.watch` on the two roots rather than by a timer. A burst of
writes collapses into one scan, but never for longer than `--max-debounce`: a session mid-turn
writes every few hundred milliseconds for minutes, so a plain debounce would starve exactly the
session worth reporting. A slow full scan runs behind the watcher, because an event the filesystem
drops would otherwise never be noticed.

What goes out over SSE is a delta keyed by session — the rows that appeared, the rows that moved,
the identifiers that left — and it is computed from what a row actually displays, so a scan that
re-read a transcript without finding anything new wakes nobody. Keyed updates are a day-one
property: retrofitting them means rewriting the rendering.

Pausing stops the watchers as well as the output, since a paused service holding its watchers open
is not paused but merely silent. Starting the service twice is not an error: the second start finds
the first by asking it for its state with the recorded token, prints its URL and exits. That check
is a conversation rather than a look at the file, because Windows has no real signals — a hard kill
leaves the file behind with nothing listening, and the service has to recover from it.

## 0.1.0

M1: the session engine of `agent-sessions-manager` runs from a terminal.

`src/core`, `src/model` and `src/providers` were taken from the extension at commit `fdd3788`
without a single edit, with their 146 tests. They never imported anything from `vscode`, which is
what the milestone set out to prove. The 13 remaining tests of the extension's 159 cover its
webview presentation, which stays behind.

Three commands on top of them: `asm list`, `asm watch` and `asm status <id>`, naming a session by
any unambiguous prefix of its identifier. The list goes to stdout and everything else to stderr, so
a pipe carries the list alone. Defaults match the extension's settings, so the same machine
produces the same list from either side while both are installed.

`asm watch` polls on an interval and logs what moved; watching the directories with `fs.watch`
belongs to the service, in M2.

The development toolchain is current rather than inherited: ESLint 10 with a flat config and
Vitest 3, which is what takes the repository to no reported advisory at all. Runtime dependencies
remain none.
