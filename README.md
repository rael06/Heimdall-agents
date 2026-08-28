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

It asks for 27600 and takes another if it cannot have it — held by something else, or refused
outright, which on Windows is neither rare nor a permission problem: Hyper-V and WSL reserve blocks
of the dynamic range and redraw them on every boot, so a port that worked yesterday can come back
`EACCES` with nothing listening on it.

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

**Unless the agent is asked to say it.** Both Claude Code and Codex fire a `PermissionRequest` hook,
and a hook that writes one small file per session turns the unsayable into a fact on disk. Install
one that writes, on every `PermissionRequest`, to
`<shared-dir>/status/<provider>-<sessionId>.json`:

```json
{ "version": 1, "provider": "claude", "sessionId": "<id>", "event": "PermissionRequest",
  "at": "2026-08-14T12:00:21.971Z" }
```

A session whose turn is open and whose report is **not older than the last thing written to its
transcript** then reads as *idle* — "stopped to ask you for a permission" — and notifies like any
other session that stopped. The date comparison is what clears it: answering runs the tool, which
writes a result younger than the request. It stays *idle* however long the wait, because a permission
does not stop waiting for you by waiting longer.

Nothing here is required. With no hook installed there are no files, every lookup comes back empty,
and the status is decided exactly as it was. And the two agents write the same shape into the same
directory, so this reads one format and neither of them gets a mechanism the other lacks — the
difference from `~/.claude/sessions/<pid>.json`, dropped precisely because only one side had it.

**A turn can end while work it handed out keeps going.** Claude Code runs a sub-agent and wakes the
session when it reports back, so the transcript reads `end_turn` while the session is still waiting
on a verdict — and it read as *idle*, "nothing more happens without you", which is the one case
where that sentence is false. A sub-agent is now paired with the notification that ends it, by
identifier, so a session with one still in flight reads as *running* and its tooltip names it. The
notification is written as a `queue-operation`, an entry type the conversation walk skips as
bookkeeping, which is why this went unseen for so long. When such a session goes cold it falls back
to *idle* rather than *inconclusive*: a sub-agent belongs to the process that launched it, so a
transcript that has not moved says that process is gone and the turn did end after all. Codex
reaches the same behaviour by its own means — a `wait_agent` call with no output is a pending tool
call, which already reads as running.

**A shell the session parked does not count**, and that is deliberate. The status answers whether
the *agent* is doing anything, and a development server left running is not the agent working — one
kept a session at *running* for a day with nothing being produced. The two cannot be told apart on
disk either: across 787 background shells here, a server and a test run are the same object, a
command that has not reported back, and only a list of guessed-at command names could separate them.
Codex settles it, as it settles most of these: it has no background shell at all, so counting one
made the same situation read *running* on one provider and *idle* on the other.

A 100 MB installer, 348 MB unpacked. That is what an Electron application costs.

It used to say 200 MB and ~700 MB, and that was measured rather than guessed — 1.0.1 really did
install 696 MB. It was not what Electron costs, though. `dist/` was both the TypeScript output and
where electron-builder left the installer, and the packaging rule was `dist/**/*`, so **every build
packed the previous installer inside the next application**. Measured after separating the two
directories: `app.asar` went from 364,535,336 bytes to 376,456 — a factor of 968 — and the
installer from 209 MB to 100 MB. The application was carrying its own history.

`npm run app` runs it without installing, from the build in `dist`.

It costs what an Electron application costs — around **410–445 MB** of memory against **54 MB** for
the service on its own, on the same 319 sessions, with a 100 MB installer. That trade was made
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

- **Nothing reorders itself, unless you ask it to.** A row's position depends on the sort you chose
  and on nothing else. A status changing repaints that row where it is. If the list *would* move
  rows, it says so and waits: *"3 row(s) would move — reorder"*. **Keep sorted**, beside that
  message, takes the offer for you from then on: the ordering re-applies as the list changes rather
  than being proposed. It is remembered, and the icon says which of the two it is doing.
  Choosing a sort has always applied at once, whichever way the switch is set — asking for a view
  is the asking.
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
- **Updates are keyed, and idempotent.** Rows are addressed by identifier and their cells are
  rewritten in place, so focus, selection and scroll survive an update. Never a re-render — and a
  pass that changes nothing changes nothing: a row is moved only when it is out of place, and a cell
  is written only when its text differs. That is not tidiness. Re-appending a row moves it, and a row
  detached between a mousedown and a mouseup takes the click with it — the browser fires no click
  when the press and the release do not meet. Measured on three rows: two refreshes that changed
  nothing used to detach and reinsert six rows and replace thirty-two text nodes.
- **Watched and starred are markers and filters.** Hollow when unset, filled when set — the shape
  carries it, not only the colour. The two filter chips wear the same accent a set marker wears, so
  they read as markers rather than as disabled buttons among the coloured status chips.
- **An acknowledgement dot** on the corner of the status icon means "this status is new to you". It
  lights when a session stops, and **the icon toggles it** — a click clears it, and a click on a row
  that carries none puts it back, which is how a row goes back on the pile after you opened it, looked,
  and decided it still needs you. The two markers beside it have always toggled; this one was one-way,
  so a dot cleared by mistake could not be recovered. It also clears when the session starts working again, or
  with *Acknowledge all* — which settles everything still carrying one, watched or not, including the
  rows a filter is hiding and sessions that have aged out of the window. It used to settle only what
  was on screen, which meant a filtered view left the rest marked and the tray counter up.
- **How long in the current status**, on watched rows only, right-aligned with tabular digits — and
  sortable, longest wait first. Every row takes part in that ordering, not only the ones showing a
  number: the age behind it is a fact about all of them. Written as days, hours and minutes, with the
  units that are zero left out — `6m`, `4h14m`, `20h48m`, `12j20h48m`. It used to be a bare minute
  count, and `1248m` is a number you have to divide before it means anything, in a column that is
  read at a glance or not at all. The unit letters follow the language, `d` and `j`.
- **Absolute dates**, a shape per status, a tooltip saying why the status was inferred, and the full
  workspace path in a tooltip. The table scrolls sideways rather than squeezing its columns, and a
  long title or folder name is cut with the whole of it in the tooltip — otherwise the widest row
  anyone happens to have open sets the width of every column after it.
- **The columns are yours to size.** Drag the edge of any header, or focus it and use the arrow keys
  — the handle is a separator that says which column it belongs to and how wide it currently is, so
  the widths are reachable without a pointer. `Home`, or a double-click, gives a column back to its
  contents. The table keeps sizing itself until the first drag and only then holds still, which is
  also why the first drag records every column at once: a fixed layout shares leftover space between
  the columns that have no width instead of fitting them to what they hold. Widths are kept per
  machine, beside the theme, rather than in the address bar that carries the view.

  Kept in the **preferences file**, not in the browser. All of it — theme, accent, colours, widths,
  sort, filters, fold — used to sit in `localStorage`, which is keyed by origin, and the origin
  carries the port. The port is asked for, not owned: the day Windows refused the usual one the
  service took another and the page opened on an empty store, having lost nothing and reaching
  none of it. The service writes the stored view into the document it already assembles, so the
  first paint still knows the theme without waiting for a request; changes go back as a patch on
  `POST /api/view`. A store left under an old address is adopted once, on first open.
- **Groups you name, and drag into the order you want.** A sort answers *which of these needs me
  first*; it cannot answer *these six belong together*, because nothing in a transcript says so.
  *New group* makes a band; a row joins it from the row's own menu or by being dragged onto the
  band, and the sort works inside it. Members are indented against a rule that the last of them
  closes, so a group ends where it ends rather than running into the pool below.
  Bands fold, are dragged above or below one another on an insertion point rather than a swap, and
  are deleted from their right-click menu — which returns their rows to the sorted pool and asks
  nothing back, because nothing is lost by it. A group outranks the watched and starred pinning: a
  row that jumped out of its band the moment it was watched would make the band a lie about what it
  holds. Each band carries the same eye and star the bar at the top does, and pressing one narrows
  that group to what is watched or starred *there*, whatever the bar is set to — it overrides the
  one narrowing it is about and no other, and a third press gives the band back to the bar. A band
  showing fewer rows than it holds says `0 of 6 shown` rather than a bare zero: a group that lost
  its rows and a group that is hiding them are not the same thing.
- **One menu for the row**, on right-click or `m`, in four sections that open to the side:
  **Open**, **Status**, **Colour**, **Group**, above the one item that is not a section —
  acknowledging. A popover rather than a modal, opened where the pointer asked and anchored to the
  selected row when a key asked instead —
  a menu about one row is not a decision the rest of the window has to wait for. The two markers
  stay on the row, because a click on the eye is faster than any menu; the transcript's own column
  and the two brushes are gone, since carrying them twice cost a column and the width the names are
  read in.
- **A colour per workspace and per provider**, so a long list separates into projects before a
  single name is read. The colours are handed out rather than computed from the name, and
  remembered: six projects drawn from a palette of ten by a hash collide 85% of the time, which is
  the birthday problem and not a weak hash — adding colours does not fix it, and there are nowhere
  near enough distinguishable ones to make it rare. Giving them out means no two projects on screen
  share a colour while any are left. There are sixteen, spaced by measurement rather than evenly,
  and the two columns start half the list apart so they do not mirror each other.
- **The brush beside each value opens a hex field and a colour picker**, for the chip and for the
  text on it. The hex is first because the native panel opens on whichever of hex, rgb and hsl the
  browser last remembered, and that selector is its own chrome — typing the hex needs the panel not
  at all. Neither is a list to choose from — the picker is the one the frame colour uses, and what
  you pick is used exactly as picked, in both themes. A hex applies once it is a whole colour, so a
  value halfway through being typed paints nothing rather than flashing a colour nobody asked for.
  *Contrast it* works out what can be read on the chip in force,
  and gives the same kind of answer an assigned chip gets: a near-white or near-black carrying a
  trace of the chip's own hue, walked towards the flat extreme only where that trace costs too much
  to keep. It is also what a chip starts with, so the button is how a colour that turned out badly
  is taken back. A chosen colour takes no place in the palette, so it never costs another project
  one, and *Choose for me* hands the chip back to the automatic assignment.
- **The settings, the search and the filters fold away**, behind the gear at the right of the title
  line, which is lit while they are open. They are set up occasionally and read past every time, and
  they were taking four of the six lines between the title and the table. What stays on screen is
  what is looked at rather than set: the two marker filters, the counter, the offer to reorder, and
  the two buttons that act on the list. The counter is deliberately among them — with the filters
  folded away, *"10 visible / 327 loaded"* is the only thing left saying one is narrowing. The fold
  is remembered, and closed the first time.
- **What the history window and the session cap left out folds with them**, since it is those two
  settings doing their job rather than something going wrong. A failed scan, a root nobody is
  watching and a paused service stay on screen: an error behind a fold is an error nobody reads.
- **Filters, sort and search live in the URL**, so a view reloads and can be bookmarked — and are
  kept beside it, so the next start opens on the view you left rather than on the default one. The
  address still decides: one that carries a view replaces the kept one instead of merging with it,
  because a link is a whole view and half of someone else's filters mixed into yours is neither.
  *Reset* clears both.
- **A click opens the session** in VS Code — the title opens the conversation, the workspace opens
  its window, and the icon on the left opens the raw transcript. Opening a session acknowledges it.
- **Refresh** forces a scan *and* takes the whole list back from the service, so a push missed by a
  stream that dropped cannot leave the page quietly out of date. It applies a pending reorder
  without asking again — asking for a refresh is the asking — and keeps your search and filters.
- **Keyboard**: `/` to search, `j` and `k` to move, `Enter` to open, `t` for the transcript, `w` for
  the workspace, `e` to acknowledge, `s` to set the status by hand, `m` for the row's whole menu,
  `r` to refresh, `Escape` to leave a field. `m` reaches the same menu as a right-click, because a
  control that exists only under a pointer is one a keyboard never finds.
- **Light and dark**, following the system or forced either way, and a **3 mm frame** in a primary
  colour you pick or take at random. A random pick chooses a hue rather than a colour, and the
  accent derived from it is adjusted until it clears 4.5:1 on the background in use — the frame only
  has to be seen, the accent is read.
- **The tray icon is a count of what you have not seen**, large, with the triangle in the corner —
  summed from the same dots the rows carry, so the two cannot disagree. It follows the marks rather
  than a timer, so an acknowledgement clears it at once. Zero is drawn rather than hidden, in grey
  where a count that is waiting for you is drawn in the idle colour. Two digits fit at sixteen
  pixels; a hundred and upwards is a `+`, and the exact figure is in the tooltip.
- **The wait before a notification is a setting**, under *Behaviour*, in seconds. It is how long a
  session has to stay stopped before it is worth telling you about, so a turn that ends and starts
  again inside that window is never reported. Zero is a choice, not an accident: it tells you the
  moment the transcript says so, false stops included. It takes effect when saved rather than at the
  next start, and a wait already running keeps the delay it began with.
- **It looks for a new release when it starts**, ten seconds after the window opens and in the
  background. It says nothing unless there is something to act on — up to date, offline, or a
  release it could not verify are all silent, and the *Check for updates…* menu item still answers
  every one of those. An update raised this way can be turned down for good with *Skip this
  version*, so the same release is never raised on its own twice.
- **The palette is measured, not judged.** `node scripts/check-contrast.mjs` reads it out of the
  stylesheet and holds every pair to WCAG: 4.5:1 for text, 3:1 for a shape that carries meaning.
  The workspace colours are held to the same bars by the interface tests instead, because they are
  the one part of the palette that cannot be computed from the stylesheet: they are written past the
  sRGB gamut on purpose, and what reaches the screen is what the browser maps them back to.

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
covers the time a window takes to come up; raise it if a session opens in the wrong one. Those
seconds are visible: the bar beside the title says *opening…* for as long as the handover is
running, and goes back to the scan state once it has arrived.

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
- **Two action buttons**, not just a click: **Mark as seen** on the left, which marks it and opens
  nothing at all, and **Open the session** on the right. Turning a notification down is worth as
  much as acting on it, but only while it costs nothing — and it stops costing nothing the moment it
  opens a window to be closed again. The tray count drops as the mark clears. `asm serve` notifies
  through URLs a browser opens, so it keeps *Show the list* instead: a URL that marked a session seen
  would open a tab to do it.
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

Every answer also carries `Referrer-Policy: no-referrer` — the token rides in the address, so the
address is a credential and the browser must not hand it on — and `X-Content-Type-Options:
nosniff`. The page itself is served under a content security policy that allows the inlined
stylesheet and scripts and nothing else: no loading, no form submission, no framing.

The handover asks Windows to open a URI through `rundll32 url.dll,FileProtocolHandler` rather than
through `cmd`, so nothing between here and `ShellExecute` reparses the URI. That is not
hypothetical tidiness: `cmd` reads `&` as a command separator, and a workspace named `R&D` used to
be delivered truncated with the rest run as a command.

Reporting a problem privately: see [SECURITY.md](SECURITY.md).

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

**And you can disagree.** Right-click a row — or press `s` on the selected one — and set the status
by hand. The inference is good, not infallible, and a row you know to be wrong should not stay wrong
while you argue with a heuristic.

Two things keep that from turning the table into a mixture of measured and asserted facts. The cell
is **ringed** while a status is set by hand, and its tooltip says *set by you* and what the transcript
says instead — a status asserted must never look like one that was observed. And the correction
**does not outlive the evidence it was set against**: it records what the transcript said at the
moment you disagreed, and the moment the transcript says something else it is dropped. A session you
marked *idle* that goes back to work says *running* again, on its own. Setting one counts as having
read the row, so it is acknowledged and raises no notification.

`idle` means *not working* — not *succeeded*. A finished answer and a question left unanswered are
the same thing here, and that is the point: the model has stopped and the next move is yours. Claude
Code uses `idle_prompt` for the same notion in its own notification events.

The clock does one job: `--stale-after` is when an open turn stops being believed at all. It never
changes *what* a session is, only *whether the file is still worth reading*. It answers a real
problem — no provider writes "I died", so a session killed mid-turn claims to run forever: 46 of 426
real sessions here, sorted to the top of the list.

**It is off by default** (`0`, meaning never), and that is a reversal. It ran at thirty minutes,
on a measurement that still holds: across 68 782 silences inside an open turn, 99.9 % last under ten
minutes and only 22 exceed an hour. The delay was never wrong about normal work. It was answering a
question the files cannot — whether a process is alive — by counting, which is the one thing it can
do and not the thing being asked.

What made counting the worse of the available answers is that a status can now be set by hand, as
above, and the correction is released the moment the transcript disagrees — so a row you know to be
wrong no longer has to be guessed right by a timer.

A second reason was given here and has since been withdrawn: that a turn ending on a parked
background task should read as running, as a reminder that something was still up. It does not any
more. That reminder was the agent being reported busy while it was doing nothing, and the reminder
was not worth the wrong answer.

Set it back to `30` to have it decided for you. The trade is stated plainly in both directions: at
`0` a session killed mid-turn keeps claiming to run until you say otherwise; at `30` a long quiet
tool is called inconclusive while it is still working.

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

**File → Settings** on `Ctrl+,` opens them — as does the ⚙ button, which the desktop window hides
because the menu already carries it and a browser keeps because it is the only door: where the
transcripts are, what is scanned, how a status ages, whether to start with Windows, whether to show
the tray icon.

Not to be confused with the **gear at the right of the title line**, which folds the settings, the
search and the filters away rather than opening a dialog. It is lit while they are on screen.

**Detect** probes for the transcript directories rather than guessing — the environment variable,
the usual place, a relocated profile — and counts what it finds under each. A directory that exists
but holds no transcript never wins, and when none does it says so rather than filling the field with
a plausible wrong answer.

Anything the providers are built with — the paths, the caps, the timeouts — asks for a restart, and
takes one. Everything else applies as you change it.

**Language and dates.** English and French — the page *and* what the application itself writes:
menus, dialogs, the tray and the notification buttons. The choice is stored twice on purpose, once
where the page can read it on every string it draws and once where the desktop process can read it
at all, from the one control. The desktop chrome keeps a table of its own, because the two share no
string: one names columns and filters, the other names *Uninstall…*. Following the system and
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
npm ci
npx tsc --noEmit
npx eslint src
npm run test:coverage
npm run build && npx playwright test
npm run contrast
```

CI runs exactly those, on Windows, on node 20 and node 24 — Windows because the end-to-end suite
drives the compiled service, the notification path is PowerShell, and the handover asks Windows to
open a URI, so a green run elsewhere is a green run of something else. Coverage carries a floor
rather than a target: the uncovered half is `main.ts`, `serve.ts` and the command entry points,
which are wiring and are covered end to end instead.

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
