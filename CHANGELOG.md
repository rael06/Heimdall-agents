# Changelog

## 1.6.0

**`running` now answers one question only: is the agent doing anything?**

It is doing something when its turn is open — writing an answer, running a tool
— or when it has handed work to a sub-agent and is waiting on the verdict.
Nothing else counts, and in particular a process it started and walked away from
does not.

**This reverses a decision recorded at 1.5.0.** The note there said a turn ending
on a parked background task should read as running, as a reminder that something
was still up out there. That reminder was the agent being reported busy while it
was doing nothing, and it is withdrawn: a development server kept one session at
*running* for a day, correctly by the old rule and uselessly by any other measure.

Measured across 1 056 transcripts, 14 sessions change verdict, all of them from
*running* to *idle*.

### Why a shell cannot be judged, and a sub-agent can

A sub-agent exists to return a verdict. It is started by a `tool_use` block and
ended by a notification carrying the same identifier, so the two pair exactly.

A background shell has no such shape. Across 787 of them here, a development
server and a test run are the same object — a command that has not reported back
— and 103 never reported at all: roughly a third servers, the rest test runs and
watch loops. Only a list of guessed-at command names could separate them, which
is the guess this project refuses for `needs-action` and refuses here.

The per-task output file was considered and measured rather than assumed. Each
background task writes `tasks/<id>.output` under the session's temporary
directory, and the dev server's was **0 bytes with a frozen timestamp**, because
the command redirects its own output elsewhere. The file says *quiet*, not
*alive*, and a quiet build is indistinguishable from it. No process identifier is
recorded anywhere on disk.

### Codex decided it

Codex has no background shell at all, so the same situation — a server left up,
the turn over — read *running* on one provider and *idle* on the other. Waiting
on a sub-agent has an equivalent there and keeps its meaning: the call stays open
on the parent thread until the verdict lands, which already read as running.

One behaviour, whichever agent produced it, is the rule this repository holds
above any capability one of them happens to offer.

## 1.5.1

**A session sending images no longer reports itself as inconclusive while the
model looks at them.**

The tail of a transcript is read as its last 256 KB, which is a budget of bytes
and was being trusted as a budget of lines. One entry carrying two screenshots
measured **952 087 bytes** here — nearly four times the window. The read landed
entirely inside that single line, found no line break before it, and returned
**nothing at all**. Handed an empty tail, the reader could only conclude *no
usable exchange at the end of the transcript*, and the row said `unknown` for as
long as the model spent on the images, which is exactly the moment the session
was working hardest.

Replayed line by line over the transcript that showed it, the hole opens on the
image entry and closes nine entries later, once enough ordinary lines have been
written *after* it to fit an exchange back inside the window. With the fix, every
one of those reads `running`, which is what the entry says: a request sent, an
answer in progress.

This was never the stale delay, and setting it to `0` in 1.5.0 would not have
helped: the verdict was **settled**, decided by the reader, not aged by a clock.

### The window now grows when it is starved

`readTailLines` takes the number of lines the caller decides on and widens its
window, doubling, until it holds them — capped at 4 MB, twice the largest single
line measured across 1 242 transcripts. Past the cap it returns what it has,
because a pathological file must not be loaded whole to find one line in it.

The floor is what each provider's status decision actually reads: 80 entries for
Claude, which slices exactly that many, and the whole tail for Codex, which has
no narrower window. Reading further than that cannot change the answer, and
reading less than it can starve it.

Measured before shipping, across those 1 242 transcripts: the floor moves **no
verdict at all** outside the starvation window it exists for — it is a guard, not
a change of mind — and a fifth of them ask for the widening, at a read grown by
two thirds on the ones that ask.

Titles keep the wider, cheaper window they had. A rename that has scrolled out of
reach costs a title falling back to the opening prompt; a status decided on
nothing costs a session reported as dead while it works.

## 1.5.0

**The stale delay is off by default.** *Stop believing an open turn after* now
accepts `0`, meaning never, and `0` is what a fresh installation starts with. An
open turn stays running until the transcript itself says otherwise.

This reverses *Three hours becomes thirty minutes*, recorded here at 0.25.0, and
the measurement that decision rested on is still correct: across 68 782 silences
inside an open turn, 99.9 % last under ten minutes. Thirty was never wrong about
normal work, and it stays the value to type for anyone who wants it.

What changed is that the delay was answering a question the files cannot answer —
whether a process is still alive — by counting, which is the only thing it can do
and not the thing being asked. Two later additions made counting the worse of the
options available. A status can be set by hand since 1.3.0, and the correction is
released the moment the transcript disagrees, so a row known to be wrong no longer
has to be guessed right by a timer. And a turn that ends leaving a background task
behind reads as running deliberately — a reminder that something is still up out
there, which is precisely the signal the delay used to erase on a schedule.

The cost is stated rather than hidden, in the setting and in the README: at `0` a
session killed mid-turn keeps claiming to run until you say otherwise. Typing `30`
brings the old behaviour back, and the floor on the field moved from 1 to 0 so
that both ends of the choice are reachable.

**An existing installation keeps the value it has.** Only a setting that was never
written takes the new default; nothing rewrites a delay that was chosen.

### The sentinel had one way to go wrong

Read as a delay rather than as a value of its own, `0` says every age is past it —
and the setting would have done the exact opposite of what it offers: not one
session believed, ever. `pendingVerdict` tests the sentinel before it compares
anything, and a test pins that a 400-day-old open turn still reads as running.

The sanitiser used to clamp `0` up to one minute, back when the floor was 1 and a
zero could only be a mistake. It is the default now, and a sanitiser quietly
rewriting it would have turned the setting off for everyone who had it on.

## 1.4.0

**Clicking a status now toggles the acknowledgement instead of only clearing
it.** A click on a row that carries the dot clears it, as before. A click on a
row that carries none puts it back.

That is how a row goes back on the pile: you open a session, look at it, decide
it still needs you — and until now there was no way to say so. The mark could be
written by a scan and erased by you, never the other way round, so one cleared by
mistake was gone and the row lost the only thing saying it still wanted
attention.

The two markers sitting beside it — watched and starred — have always toggled.
This one was the odd one out, and it is a marker, not a receipt.

### Nothing special was needed to make it behave

A mark set by hand is cleared by the same event that clears an automatic one:
the session next starting to work. `applyStatusChanges` looks at the transition
and not at who wrote the mark, so the two kinds cannot drift apart.

The tooltip now names what the click will do in **both** directions. It used to
appear on an unseen row only, which left the other half of the toggle with
nothing at all saying it was there.

Its own route rather than a flag on the existing one: `/api/acknowledge` is also
reached by a toast button, through a URI carrying an identifier and nothing else,
and a route that means two things depending on a field is a route that will one
day mean the wrong one.

## 1.3.1

**The minutes column says `20h48m` rather than `1248m`.**

Days, hours and minutes, with the units that are zero left out: `6m`, `4h14m`,
`20h48m`, `1j`, `12j20h48m`. A bare minute count is a number you have to divide
before it means anything, in a column that is read at a glance or not at all —
and the list had rows at 1243 and 1248 sitting next to each other, which is two
divisions to notice they are five minutes apart.

Nothing is dropped past a day. `2j0h0m` would be noise, so a zero unit simply
does not appear, and `0m` is what nothing looks like.

The unit letters follow the language — `d` in English, `j` in French — so the
arithmetic lives in the tested pure module and the naming stays with the page,
which is the only side that knows which language it is in. The column keeps its
tabular digits and grows from five characters to nine, the width of the longest
thing it can now say.

### While in there

The half-minute timer that refreshes the column wrote the cell's text
unconditionally. It fires twice a minute and the value changes once, so half of
those writes replaced a text node with an identical one — the same churn that
1.2.1 removed from the redraw, in the one place that redraw does not reach. It
goes through the same `setText` now.

## 1.3.0

**A status can be set by hand.** Right-click a row, or press `s` on the selected
one, and pick one of the four. The inference is good and it is not infallible; a
row you know to be wrong should not stay wrong while you argue with a heuristic.

### Keeping the table honest

The whole promise here is that a row says what the files say, so a status
*asserted* must never be indistinguishable from one that was *observed*. Two
things enforce that.

The cell is **ringed** while a status is set by hand — a dashed outline rather
than a fifth colour, since the four colours already mean the four statuses and a
ring survives a greyscale screenshot. Its tooltip says *set by you* and what the
transcript says instead.

And the correction **does not outlive the evidence it was set against**. The
entry records what the transcript said at the moment you disagreed; the moment
the transcript says something else, it is dropped. A session you marked *idle*
that goes back to work says *running* again on its own. Anything else would let
a row lie indefinitely, which is the one thing this list must not do.

### What it does not touch

Transitions and notifications go on seeing the inferred statuses. Correcting a
row changes what it shows, never what the service believes happened — otherwise
a correction would either raise a notification or swallow the next real one.
Setting one counts as having read the row, so it is acknowledged at the same
time.

The overrides live in their own file beside the marks and the acknowledgements,
for the same reason those are separate: the marks file is rebuilt from the keys
the extension knows, so anything added to it is dropped the next time the other
side writes.

## 1.2.1

**A click on a row no longer goes missing**, and the underline under the pointer
stops flickering.

Both had the same cause, and it was one word. Applying the ordering did this:

```js
for (const id of target) rowsBody.append(tr);
```

`append` on a node already in the document does not leave it alone — it detaches
it and puts it back. So every row was torn out and reinserted on every pass,
whether or not the order had changed. With the list keeping itself sorted, that
is every scan.

Two things follow, and both were reported before this was found. **A row
detached between a mousedown and a mouseup takes the click with it**: the browser
fires no click at all when the press and the release do not meet on one element,
so the click simply does nothing. And a link under the pointer loses its hover
and regains it, which is the flash on the underline.

Rows are now moved only when they are actually out of place — a row where it
belongs costs one comparison and no mutation.

### And the cells

`updateRow` assigned `textContent` on seven cells every pass. That throws the
text node away and makes a new one even when the string is identical, which most
of them are most of the time. They go through the `setText` helper that already
existed for the live regions.

### Measured

On the three-row fixture, two refreshes that changed nothing used to produce
**6 rows detached and reinserted** and **32 text nodes replaced**. Both are now
**0**, and a test counts them with a `MutationObserver` so they stay there. On a
real list of ten rows scanning every few seconds, that was the whole table being
rebuilt continuously.

## 1.2.0

**A session waiting for a permission now says so**, instead of reading as a tool
that is running.

Two sessions sat at *running* for over an hour while both were stopped on a
permission prompt. That was not a bug in the reading: on disk the transcript ends
on a tool call with no result, and so does a tool that is simply taking four
minutes. The two are the same object, which is why calling the second one
"waiting for you" past a delay was tried, was wrong on every slow command, and
was removed.

### The agents can be asked to say it out loud

Claude Code and Codex both fire a `PermissionRequest` hook. A hook that writes
one small file per session — `<shared-dir>/status/<provider>-<sessionId>.json` —
turns the unsayable into a fact on disk, and the format is documented in the
README so it can be installed by anyone.

A session whose turn is open and whose report is not older than the last thing
written to its transcript reads as **idle**, *"stopped to ask you for a
permission"*, and notifies like any other session that stopped. Nothing has to
clean up after it: answering runs the tool, which writes a result younger than
the request, and the report falls behind on its own.

It stays *idle* however long the wait. A permission does not stop waiting for you
by waiting longer, and that is exactly where the old status was worst — the
longer it mattered, the further the row drifted from what it meant.

### Why this is allowed and `~/.claude/sessions/<pid>.json` was not

That file was dropped because only Claude had it, so the same situation would
have been reported differently depending on who produced it. Here both agents
write the same shape into the same directory through the same hook, and the
verdict is reached in one place that neither provider owns. Nothing is required:
with no hook installed there are no files, and the status is decided exactly as
before.

## 1.1.34

**A gap under the left-out banner**, which had none.

Moving it inside the fold in 1.1.33 made it the last thing there, and nothing
below it separated it from the line that never folds — so it sat flush against
the marker chips. It now has the same 6.39px above and below that every other row
in the header has. The notices outside the fold keep none: they are the last
thing in the header, and a margin there would only push the table down.

Measured on both sides rather than eyeballed, and the check runs on every build:
the banner cannot appear in the interface tests, since their fixture is three
sessions and nothing is ever left out, so the test puts one there itself. What is
under test is the layout rule, not the service that would fill it.

## 1.1.33

**The dates row gets its gap back, and the banner about left-out sessions folds
away with the settings that cause it.**

The date fields sat flush against the marker chips below them. The rule that
flattens the bottom margin of the header's last bar was written when that bar was
the last thing in the header; the dates row had become the last thing inside the
fold, so it caught the same rule and lost the gap every other row has.

### Only the banner folds, not the notices

*"180 session(s) left out by the history window or the session cap"* is those two
settings doing their job, and both of them live behind the fold, so its
consequence goes with them. **This reverses what was said one release ago** —
that folding a warning away is worse than showing it. It holds for a warning; it
does not hold for a sentence that repeats a setting back at you on every screen.

The notices that mean something is actually wrong stay out: a scan that failed, a
root nobody is watching, a paused service. An error behind a fold is an error
nobody reads, and those are the ones the argument was really about.

## 1.1.32

**The settings, the search and the filters fold away**, behind a gear at the
right of the title line that is lit while they are open.

They are set up occasionally and read past every time, and they were taking four
of the six lines standing between the title and the table. Closed, the header is
two lines.

### What stays out of the fold, and why

The two marker filters — *Watched* and *Starred* — move down to the line that
stays, because narrowing to a marker is done far more often than anything behind
the fold. They sit on the left of it, with the counter, and *Acknowledge all* and
*Refresh* on the right.

The counter is not there for symmetry. With the filters folded away, *"10 visible
/ 327 loaded"* is the only thing left saying that one of them is narrowing the
list. And the offer to reorder lives inside that counter's live region: folded
away it would be hidden, so nothing there would be announced and the one action
it offers could not be taken at the moment it appears. *Keep sorted* went the
other way, to sit beside the sort it governs.

### Not a `details`

The switch is on the title line and the content is below it, and a `summary` has
to sit with what it opens. What the platform offers for a control that reveals
something elsewhere is `aria-expanded` on the button and `aria-controls` naming
the panel — with `hidden="until-found"` rather than a class, so find-in-page
still reaches what is folded and opens it to show the match. That last case is
handled: the panel listens for `beforematch` and lights its switch, or the panel
would be on screen with the gear still dark.

### Worth knowing

In a browser there are now two gears: this one, and the ⚙ that opens the settings
dialog. The desktop window hides the second, because its menu already carries
*Settings*, so the ambiguity does not arise there.

## 1.1.31

***Acknowledge visible* is now *Acknowledge all*, and settles everything.**

It cleared the acknowledgement marker on the rows a filter was letting through,
and deliberately nothing else — the reasoning being that a hundred sessions
acknowledged by accident feels irreversible. **That decision is reversed here.**

The guard was the problem. The marker says "this status is new to you", and the
moment you are looking at a filtered view — watched only, one workspace, a
search — the button settled what you could see and quietly left the rest marked,
so the dots and the tray counter stayed up for sessions you had already decided
about. A button that says *all* and settles some is worse than either of the two
things it could have been.

It now clears every marker still standing, watched or not, filter or no filter —
including a session that has aged out of the history window and would otherwise
keep its marker for good, since it sends the list of what is unacknowledged
rather than the list of what is loaded.

### The two languages disagreed about it

English said *Acknowledge visible* and French said *Tout marquer comme vu* —
"mark everything as seen". One of them had been describing a button that did not
exist. The behaviour is what French claimed, and the English label now says so
too.

## 1.1.30

**The chips sit straight, and the row under the pointer answers back.**

### One shape for two columns

The workspace chip is a button and the provider chip a span, so one laid out as
`inline-block` and the other as `inline` — and the two columns the stylesheet
says are "drawn the same way" measured **20.84px and 19px** tall. They are one
shape now, and the padding lives in one place so they cannot drift apart again.

### Centred on the band the letters occupy

Padding on a font box is not what makes a word look centred. With the row's line
height the box is the full ascent and descent, so a word with no ascender sits
low in it and a word with no descender sits high — measured on the same pill,
`app` against `claude`, which is why this looked wrong on some rows and fine on
others.

What the eye reads as centred is the band from the cap height to the baseline,
and that band is the same for every word. Measured, it sat 6.88px below the top
of the chip and 4.88px above the bottom. The padding is deliberately not
symmetric now: that 2px, split, puts the band in the middle — 5.91 against 5.83
— and leaves the descenders room to hang without touching the edge. The chip is
the same height it was, so no row grew.

### A hover worth having

The hovered row was four points off white and six off the dark background. On a
screenshot of three rows it could not be found at all, which is a repaint that
answers nothing. It stays a neutral grey rather than moving towards the accent,
because the selected row is the blue one and the two must not be confused: one
says *the pointer is here*, the other *this is the row you chose*.

The test for it first passed against the very value it was written to reject: a
row that is not hovered paints nothing and computes as transparent, which reads
as black and makes any hover look like a large difference. It compares against
the page now.

## 1.1.29

**The sort and the filters survive a restart.**

They lived in the URL, which made a view reloadable and bookmarkable but did
nothing for the case that happens every day: the window opens the bare address
at every start, so it always came up on the default view. Whatever you had set
up was gone with the previous run.

They are now kept beside the URL, where the theme, the chosen colours and the
column widths already live — which sessions you look at is a way of working, not
a one-off. The search text goes with them, since it is part of the same view and
splitting it would make *Reset* and a shared link mean two different things.

**The address still decides.** One that carries a view — typed, bookmarked, sent
to you — replaces the kept one rather than merging with it: a link is a whole
view, and half of someone else's filters mixed into yours would be neither of
the two. *Reset* clears what was kept as well, so the next start opens on the
default.

The token is deliberately left out of what is kept: a new one is minted every
time the service starts, and a stored one would restore a view that cannot talk
to it.

## 1.1.28

**A session running a background task no longer says it is idle.**

Claude Code can run a task outside the turn that started it — a background
command, an agent, a workflow — and wake the session when it finishes. The
transcript records `end_turn`, so the session read as *idle*, with the reason
*"the turn ended, nothing more happens without you"*. That is the one case where
that sentence is false: something does happen, and the session picks the work up
on its own.

It now reads as *running* while a task is in flight, and the tooltip names the
task.

### Why it was invisible

A task is started by a tool call carrying an identifier and ended by a
notification carrying the same one, so the two pair exactly. But the
notification is written as a `queue-operation` — precisely the entry type the
conversation walk skips as bookkeeping. The evidence was in the file the whole
time, in the one place nothing was looking.

Two windows are read rather than one. The turn state only needs the end of the
transcript, but a task can be launched long before the turn that outlives it
ends: measured across the transcripts on one machine, an unpaired launch sits a
median of 173 entries from the end and up to 558, so the 80 entries the status
reads would have missed about seven in ten.

### Going cold means something here

An open turn that stops being written to becomes *inconclusive*, because nothing
can still be trusted. A background task is different: it belongs to the process
that launched it, so a transcript that has not moved says that process is gone
and the turn really did end — which is *idle*, a conclusion rather than the
absence of one.

That distinction is the difference between a fix and a regression. Of the 42
sessions on this machine that the change touches, **2** are recent enough to
read as running; the other 40 are finished work that stays idle. Without the
rule they would all have turned inconclusive.

### Codex

Codex reaches the same behaviour by its own means: a `wait_agent` call with no
output is a pending tool call, which already read as running.

It is worth recording what was checked and rejected. Codex spawns sub-agents and
writes a `sub_agent_activity` entry for each — but its kinds are only `started`,
`interacted` and `interrupted`. There is **no event for a sub-agent finishing
normally**, so a status built on those would light up and never go out. That is
why this ships as a correction to an existing status rather than as a fifth one:
a category only one provider can fill correctly is a category that reports the
same situation differently depending on who produced it.

## 1.1.27

**The two marker filters carry their colour**, and the dates get a line of their
own.

*Watched* and *Starred* sit at the end of a row that begins with four status
chips, each carrying the colour of the status it filters on. Those two carried a
grey eye and a grey star — the same drawings the rows use, in none of the colour
the rows give them — which among coloured neighbours reads as *unavailable*
rather than as a marker. They now wear the accent a set marker wears on a row,
in both chip states: the colour says which marker the chip is about, and the
pressed border and fill already say whether the filter is on.

*from* and *to* moved to a line of their own underneath. Two date fields wide
enough to hold a format hint sat mid-row between the chips that narrow by kind
and the chips that narrow by marker, splitting one row into three things to
read.

## 1.1.26

**The controls move under the title**, and *opening…* is said while it is true.

Two things about the top of the window, both noticed by looking at it.

### Eleven controls were sharing a line with the title

The settings gear, the theme, the colour and its *Random*, the notification
switch and its four statuses, the scope and *Pause* all sat on the header's
first line, pushed against its right edge, with the application name and the
state of the service on the left of the same line. One row, text on one side and
controls on the other, and the state — the only thing up there that changes on
its own — got whatever room the rest had not taken.

They now have a line of their own, directly under the title, like every other
group of controls in the window.

### The progress note arrived after the progress

Clicking a session showed *opening…* for a moment and then flicked back to
*watching N root(s) — last scan …*. The message was written when the call
**returned** — and the service performs the entire handover before it replies,
the pause a window is given to come up included. So it announced something that
had already finished, said nothing at all during the seconds that needed
answering, and then sat there until some later scan happened to overwrite it: a
lifetime decided by nothing.

It is now said before the call and cleared when the session arrives, so it
covers exactly the wait. The failure message is unchanged.

The test for it stubs the handover — a real one would launch VS Code on the
machine running the tests. Worth recording: the first version of that stub
matched `**/api/open`, which matches nothing, because every call carries
`?token=…`. It ran a real handover instead and said nothing about it.

## 1.1.25

**The list can keep itself in order**, if you tell it to. A switch beside the
counter — *Keep sorted* — decides whether the ordering re-applies as the list
changes, or is offered first.

Off, which is what it was until now and still the default, nothing moves under
you: a status arriving or a marker taken repaints the row where it is, and the
list says *"3 row(s) would move — reorder"* and waits. On, that move simply
happens, and the offer never appears. The setting is remembered like the theme,
and the icon shows the state rather than the next click: a sorted list when it
is holding the order, two arrows when it is holding rows back.

### What the offer was actually about

Writing this turned up something the interface had never made clear: *choosing a
sort already applied it*, and always has. `applyFilters` draws the view in full,
order included, because asking for a view is the asking. So the offer never came
from touching the sort — it came from the list moving on its own, which is the
only case the switch changes. The README said "nothing reorders itself" without
that distinction, and now makes it.

The first test written for this assumed the opposite and failed for the right
reason; it now marks a row, which is a real trigger.

## 1.1.24

**The minutes column has a heading you can see and click**: `m.`

The sort shipped in 1.1.22 and could not be reached. The header carried a
button whose entire label was `sr-only`, copying the three marker columns beside
it — but those carry an icon and hide only their *word*, and this one carried
nothing at all. It drew an empty heading about six pixels wide, so the column
looked untitled and unsortable while every assertion about it passed: the
interface test clicked the button by selector, which no reader can do.

The full name stays as the accessible label and the tooltip; `m.` is what is
drawn, short enough not to set the width of a column of three-digit numbers.

The test now requires the header to have visible text and to be wide enough to
hit, and was run against the old markup to check that it fails on it.

## 1.1.23

**The application speaks French too** — menus, dialogs, the tray and the toast
buttons, not only the page.

Until now the page was bilingual and everything the desktop process writes was
English: *File*, *Check for updates…*, *Uninstall…*, and the notification
buttons. One French string among them would have been worse than none, so they
all move together.

### The language had to be somewhere both could read

It lived in the page's `localStorage`, which the desktop process cannot see. It
is now also a stored preference, written by the same control. The page keeps its
copy: it asks for the language on every string it draws and cannot await a
request per call. One control, two readers, each holding the answer where it can
reach it — and a language chosen before this release is sent to the service at
the next start, so nobody's choice is lost.

The menu is built in one pass at startup, so writing the preference reaches
nothing already on screen. The host is told rather than left to find out, and
rebuilds its menu and tray — which is the difference between a language that
applies and one that applies at the next launch.

### Its own table, deliberately

Not the page's. The two have no string in common — one names columns and
filters, the other names *Uninstall…* and *Nothing was installed* — so a shared
table would ship each side the other's vocabulary for nothing. `i18n.js` is also
a classic script served into the page, and this project compiles with `allowJs`
off, so it was not importable in any case. What is duplicated is twenty lines of
mechanism.

Two tests hold it together: every key must exist in every language, and every
string must ask for the same placeholders as its English original. A key added
on one side and forgotten on the other shows as an English sentence in a French
menu, and only to the people reading French.

`updateButtons` returned English labels from a module that had no business
owning them, and now returns the answers themselves — `skip`, `later`,
`install`. What they are called is the window's business, in two languages.

## 1.1.22

**Never published under this number.** Everything below shipped in 1.1.23, and
there is no `v1.1.22` release to look for. GitHub Actions was in a major outage
while this waited for its checks — six hours between the branch being pushed and
a run finally being created — and by the time they ran, the localisation was
finished behind it. The two were tagged once rather than twice.

The entry stays rather than being folded into 1.1.23, so the gap in the version
numbers has something to point at.

**The minutes column sorts**, and **a notification can be turned down without
opening anything**.

### Minutes

Clicking the header sorts by how long a session has been in its current status,
longest first — which is the useful question about that column. Every row takes
part, including the ones that show nothing: the column is filled on watched rows
only, since the point of it is the handful you follow, but the age behind it is
a fact about all of them and leaving the rest unordered would be a sort that
scattered them.

The direction is settled in a pure function rather than beside the other
comparators, and that is not tidiness. The minutes count how long *ago* the
status changed, so ascending minutes is the timestamp descending — written the
natural way round it sorts perfectly and backwards. Nothing on screen would say
so either: `statusChangedAt` is measured from when the service first saw a
session rather than from anything in the transcript, so every session in the
test fixture shares one age, and an interface test of the order would have
passed on any order at all. It is asked directly in the unit tests instead, and
the interface test says in as many words what it does not check.

### Mark as seen

The toast raised when a session stops now carries **Mark as seen** on the left
and **Open the session** on the right. It marks the session seen and **opens no
window**, which is the whole point: the answer "not now" is worth as much as
"show me", but only while it costs nothing, and it stops costing nothing the
moment it opens something to be closed again. The tray count drops as the mark
clears, which is the confirmation.

Dismissing on the left and acting on the right, because that is the order the
answers come in: the question a toast asks is whether this is worth interrupting
for, and "no" is answered first.

*Show the list* is gone, which keeps the toast at the two buttons its payload
note says it can carry and still read. It was the least useful of the three once
clicking the toast itself opens the session.

The `show` route is still parsed, and deliberately. A notification raised before
this update is still sitting in the Action Center with that button on it, and a
URI refused would be a button that does nothing when pressed.

`asm serve` keeps its own two, *Open the session* and *Show the list*, and does
not gain this one: it notifies through URLs a browser opens, and a URL that
marks a session seen would still open a tab to do it — which is the one thing
the button exists to avoid.

## 1.1.21

**The tray icon is the count**, large, with the application's triangle in the
bottom-right corner rather than the other way round.

The badge version shipped in 1.1.20 gave the digit about five pixels of height,
which is where 1, 3, 9 and `+` stop being different shapes. Given the middle of
the icon instead it gets ten, which is legible — and **two digits now fit side by
side**, so the count is exact up to 99 where it used to stop at 9. A hundred and
upwards is a `+`, and the exact figure is in the tooltip either way.

Zero is drawn rather than hidden: an icon that only appears when something is
wrong is one nobody can find when nothing is. It is drawn in grey, where a count
that is waiting for you is drawn in the light tint of the idle colour — the
number says which, and the colour agrees with it.

There is a tile behind the digits now, because a taskbar is light on one machine
and dark on the next, and the orange this application is drawn in measures 6.6:1
on a dark one and 2.2:1 on a light one. Borrowing the background was not an
option, so it brings its own.

## 1.1.20

**The tray icon carries a count of what you have not seen**, summed from the
same dots the rows carry.

The dot beside a status says "this status is new to you" one row at a time,
which is only legible when the list is on screen — and the list is hidden most
of the time, which is what the tray is for. The count is the same fact, and it
is read from the same set the dots are drawn from, so the two cannot disagree.

It follows the marks rather than a timer: the service already announces every
change to them, including an acknowledgement, so the badge is exact rather than
current-as-of-a-poll.

### What sixteen pixels can hold, rendered rather than assumed

Drawn at 32px and left for Windows to shrink, the digits were mush — 1, 3, 9 and
`+` all came out as the same vertical smudge, because a glyph five pixels tall
halved is two and a half pixels of anything. No unit test would have caught
that; it took rendering the set and looking at it.

So the mark is drawn at the size it is shown at, where a glyph pixel is a screen
pixel, and the digits survive. Even then one digit is the limit: **ten or more is
a `+`**, and the exact figure lives in the tooltip, where it is a number rather
than a drawing of one.

The tray mark is its own drawing rather than the application icon scaled down.
The icon is 256px and wears a rounded square so it does not read as a screenshot
pasted into a corner; a tray mark sits at 16px beside a dozen others, where a
square background is a smudge and every pixel spent on it is one not spent on
the shape. So: the triangle alone, on nothing.

## 1.1.19

**The wait before a notification is a setting**, under *Behaviour*, in seconds.

It is how long a session must stay stopped before it is worth telling you about
— a turn that ends and starts again inside that window is never reported, which
is the whole reason the wait exists. It was a command-line flag and nothing
else, which meant the desktop application, having no command line, did not
really have the setting at all.

Zero is allowed and is a real choice rather than an accident to be protected
from: it means telling you the moment the transcript says so, false stops
included. The ceiling is ten minutes, and it is there for the file rather than
for the form — a number typed into the interface is bounded by the input, and a
number read back off disk has been through a text editor and a synchronised
profile since it was written.

**It takes effect when saved, not at the next start.** The queue was built once
with the delay and could not be told otherwise, which is exactly why this was a
flag; it accepts one now. A wait already running keeps the delay it started
with, on the same grounds the queue already scheduled by: what is being measured
is a quiet period since the session stopped, and rewriting a running timer would
restart that period from a moment that has nothing to do with the session.

That is also why it travels by the notifications route rather than with the rest
of the dialog, which offers a restart. The interface test reads the value back
out of the service rather than out of the field that was typed into, because the
failure worth catching is the one where it never leaves the page.

## 1.1.18

**Arriving in a hex field takes the whole value**, hash included, so typing over
it replaces rather than appends. A second click puts a caret where it was aimed,
or the field could never be edited at all.

It selects on focus, which covers arriving by Tab and arriving from the other
field. That alone was not enough, and the test is what said so: `showModal`
gives the focus to the first control in the form, so by the time the reader
clicks that field it already has the focus, no focus event fires, and the click
placed a caret at character four.

There is no arranging that away — measured, `autofocus` on the dialog and
`tabindex="-1"` on the dialog both leave the focus exactly where it was — so the
click is handled on its own terms as well: the first one after the dialog opens
is stopped before it can place a caret. Typing counts as having arrived too,
since somebody who used the focus they were handed and then reaches for the
mouse is editing rather than starting again.

## 1.1.17

**The hex comes first in the colour picker**, as a field of its own.

The native panel behind the swatch opens on whichever of hex, rgb and hsl the
browser last remembered, and it remembers rgb once rgb has been used. That
selector is the browser's own chrome: an `input type="color"` exposes nothing
about it — checked, and `showPicker` is the only thing on it that concerns the
panel at all. The page cannot put hex first there.

So hex is first here instead, in a text field before the swatch, and typing in
it needs the panel not at all. Both halves have one — the chip and the text on
it — and the swatch follows what is typed, so the two are one control rather
than two.

A value is applied only once it is a whole colour. `#ff` on the way to `#ff8800`
answers nothing rather than painting red for a keystroke, and three-digit hex is
refused for the same reason even though CSS accepts it: `#fff` typed on the way
to `#fff000` would flash white. What is left half-typed goes back to what the
chip actually wears as soon as the field is committed, so it never sits there
claiming a colour nothing is painted in.

## 1.1.16

**The application looks for a new release when it starts**, and the chip text
carries its own colour again.

### The ink was corrected twice, and the numbers say by how much

It carried its chip's hue at full strength — `.34 .13` and `.88 .12` — which
measured 6.47:1 and 5.84:1 and read as one colour with the field behind it. The
correction went far past the problem: `.22 .06` and `.97 .04` left, measured
against a grey of the same lightness, **21 and 17** points of colour in the word
where the original had **50 and 57**. That is plain black and white, and it was
reported as such.

These are the middle, and taken from the measurement rather than from another
look: `.30 .12` and `.91 .11` keep **43 and 49** points — seven eighths of the
original — with contrast still up at 7.65:1 and 6.37:1. The interface test's bar
moves from 7 back to 6 with it, because what it has to catch is a slide towards
the 5.84:1 that was reported, not the colour in the word.

*Contrast it* was measured on the way past and is not implicated: on an assigned
chip it returns `47,12,27` where the chip was already wearing `48,12,25`.

### A check at launch

Ten seconds after the window opens, in the background, and it says nothing
unless there is something to act on. Up to date, offline, behind a captive
portal, a release with no installer or no checksum manifest: all silent. The
menu item still answers every one of those, because there somebody asked.

What it offers can be turned down for good — the dialog raised this way carries
*Skip this version*, and that version is then never raised again on its own. It
is a button rather than an inference from *Not now*, which would be the
application deciding what an answer meant.

This reverses a decision recorded in the code: *"only ever from the menu: an
application that reaches out on its own, and speaks about it, is one more thing
interrupting you"*. A release nobody hears about is a release nobody installs,
so it is reversed — and the reason behind it is kept in the silence and in the
skip rather than discarded with the rule.

`writeApp` was replacing the whole block where it now merges. That was harmless
with one field in it and would have dropped the tray setting the moment a second
arrived, which is exactly what arrived.

## 1.1.15

**Contrast it gives the same answer the chip started with**, rather than a
flatter one.

It returned pure black or pure white. A chip that had never been touched was
already wearing something better: a near-white or near-black carrying a trace of
its own hue, which is what the stylesheet gives every assigned chip. Pressing the
button therefore made a chip look *less* like the rest of the table, which is
the opposite of what a button called *Contrast it* should do.

`oklch(from <the chosen colour> …)` takes the hue off the colour in force, so the
stylesheet's own lightness and chroma can be applied to it without converting
anything by hand. It is the same declaration, pointed at a different origin.

The tint is a starting point rather than the answer, and the difference is
measured. On `#fa1f19` the tinted white reaches 4.42:1 and on `#808080` 4.46:1
— both under the bar, where the flat answer clears it. So the tint is walked
towards whichever of black or white wins on that background until it clears
4.5:1, which for most colours means it never moves at all.

Two things were found by sweeping rather than by reasoning. The walk approaches
its target without arriving — forty steps of eight per cent leave three and a
half per cent — and on the worst backgrounds that remainder is the difference
between 4.48:1 and the 4.58:1 the flat answer guarantees, so a walk that runs
out now falls back rather than shipping a near miss. And the walk cannot borrow
`readable`, which picks its target by asking whether the background is above
half luminance: the answer turns over at 0.179, so a background at 0.3 is below
half and still takes black.

## 1.1.14

**An assigned chip is no longer written in its own colour**, and the text is
picked as freely as the background.

### It measured fine and still read as one colour

The text on an assigned chip carried that chip's hue at full strength —
`oklch(.34 .13)` on `oklch(.84 .12)`. That is 6.47:1 in the light theme and
5.84:1 in the dark one, so no check ever objected, and `npm run contrast` had
nothing to say because these are not palette variables. It was a perceptual
failure rather than a contrast one: a word in the same hue as the field behind
it reads as one colour whatever the ratio says, and it showed worst in the dark
theme, where the ratio was lowest.

The ink keeps a trace of the hue and loses the rest — `oklch(.22 .06)` and
`oklch(.97 .04)`. Measured across all 360 hues: **9.71:1** and **7.45:1**. The
interface test holds them to 7, well above the 4.5 that was never the problem.

### Two pickers, and a button that works out the answer

The black-or-white radio pair is gone. The text has a colour picker of its own,
offering what the background's offers, and *Contrast it* sets it to what can be
read on the background in force — which is also what a chip starts with, so the
button is how a colour that turned out badly is taken back.

One thing had to be got right for that to behave. Choosing a background on an
assigned chip used to carry the chip's existing text colour across as though it
had been chosen deliberately, which put a near-black green word on a red field
at **1.23:1**. The text is only ever pinned once the reader has actually picked
one; until then the background's own contrast answer applies.

## 1.1.13

**The text on a chosen colour can be set to black or white**, and dragging the
picker no longer stutters.

### It was not the contrast arithmetic

The stutter was reported with a guess attached — that the contrast calculation
was to blame — so it was measured rather than accepted. One move of the picker,
with 327 rows on screen:

| | |
|---|---|
| the contrast arithmetic | **1.5 ms** |
| `new Intl.DateTimeFormat`, rebuilt per cell | **30.6 ms** |
| the same formatter reused | 0.5 ms |
| every `localStorage` read | 0.3 ms |

One frame is 16.7 ms. The date formatter alone was costing nearly two, because
`at()` built a fresh one for every date in every row — and the picker rewrote
every row on every pointer move. The contrast arithmetic, the thing suspected,
was two per cent of it.

Three things changed. The formatter is kept between calls, keyed on the locale,
which every scan benefits from and not only the picker. A colour change now
repaints the chips carrying that one name instead of every row. And the choice
is written to storage when the picker is released rather than on each of the
several hundred colours a drag passes through.

Measured after, at the same 327 rows: **1.57 ms** a move.

### Black or white, by hand

A chosen colour gets a radio pair, preselected on the measured answer and free
to be overruled — once both are legible the choice is a matter of taste, and
usually only one of them is. The measurement stays as the default because
without it a dark colour would arrive with black text on it.

The pair is offered only where there is a chosen colour to write on: an assigned
chip takes its text from the stylesheet along with its background, so there is
no black-or-white answer to preselect.

## 1.1.12

**The colour picker opens on the colour the chip is already wearing.** It opened
on a dark green whatever the chip was, which is the same trap that cost this
project a measurement once already and had not been closed where it mattered.

`getComputedStyle` does not convert a colour function any more. A chip comes
back as `oklch(0.84 0.12 285)`, and reading the numbers out of that string takes
the lightness for red and the chroma for green: 0, 84, 0 — `#005400`. Every chip
prefilled the same dark green because every chip is an `oklch`, and the number
that varies, the hue, is the one that was thrown away.

The interface test caught the same thing in the test suite three releases ago
and the fix went in there and nowhere else. The picker now fills a pixel and
reads it back — the engine answering in the space the screen works in — and the
new test compares the two as painted colours rather than as strings, because
comparing an `oklch(...)` to a `#rrggbb` compares two spellings. It was run
against the old code first: it fails with `0,84,0` against a chip painted
`255,169,199`.

## 1.1.11

**The colour picker offers every colour**, the way the frame colour already did,
and the provider chip is drawn at the size of the workspace chip.

### A free choice, and what had to change under it

The picker was a grid of the sixteen. It is the same `<input type="color">` the
frame colour uses now, so the choice is the whole range.

That is not the same mechanism as an assigned colour, and it cannot be. An
assigned colour is a **hue**, and the stylesheet turns it into a light chip in
the light theme and a dark one in the dark theme. A chosen colour is a colour:
it is what was asked for, in both themes, so it is written straight onto the
chip. The two now live side by side, which is why a chip can be repainted
without the palette losing its theme awareness.

What is written on a chosen colour is black or white, whichever can be read on
it. That is not a simplification but the only rule that holds for a colour
nobody constrained: the worst possible background sits at relative luminance
0.179, where black and white come out equal — and equal is 4.58:1, above the 4.5
asked of text. Swept over the range rather than reasoned about.

It also removes a rule that no longer had anything to be about. A chosen colour
used to hold a slot in the sixteen so nothing could take it; there is no slot to
hold now, so it takes none — and stops costing a project a colour it still
needed.

### The provider chip was smaller than the workspace chip

`.badge` was drawn at `.85em`, from when the provider was chrome around a word
rather than a value like any other. Two chips at two sizes in neighbouring
columns read as a difference in importance between a provider and a workspace,
and there is not one.

## 1.1.10

**The provider is coloured too, and both colours can be reassigned by hand** —
with a fix for a workspace column that came back at its floor after updating.

### The column that arrived narrow

Updating to 1.1.9 left the workspace column at its minimum, and it is worth
saying why rather than only that it is fixed. Until 1.1.9 a column could be
dragged narrow, the width was stored, and the table drew something else — so
those stored files describe a layout that was never on screen. Restoring one
after the fix applied it for the first time, and a column that had looked
untouched came back at 24px.

Stored widths now carry a format stamp, and everything written before this is
thrown away once: the table goes back to sizing itself, which is the only state
that is certainly right. The workspace column also has a stated default of 80px
rather than a measured one — measuring what it "needs" measures whichever
project happens to have the longest name today.

### The provider wears the same chip

`claude` and `codex` are drawn like the workspaces, from the same sixteen
colours but starting half the list along. Both columns opening on the first
colour had `claude` and the first workspace wearing the same pink, which is a
relationship anyone can see and which does not exist. Reversing the list was
tried first and was not enough — it is a loop, and its last colour sits 32° from
its first.

### The brush

Every workspace and provider value carries a small brush that opens a picker of
the sixteen, each swatch drawn on the name it would be given to, since a swatch
labelled "colour 7" says nothing anyone can act on. A colour chosen by hand is
then never moved to make room for a project that turns up later — including when
that leaves two things sharing one, which is a choice the reader is allowed to
make and not one to be quietly overruled. *Choose for me* hands it back.

The automatic assignment is unchanged and is still what runs first: it is the
part that guarantees no two projects on screen share a colour while any are
left, and the brush is for the cases it cannot know about.

## 1.1.9

Both of these were reported from a real list of 327 sessions after 1.1.8, and
neither showed up on a fixture with two workspaces called `app` and `site`.

### A column holding something long had a floor under it

The workspace column could be widened and not narrowed. The width was being
stored and written correctly — 40px asked for, 40px on the `col` element — and
118.9px was drawn.

A table with `table-layout: fixed` still takes **its own** width from
`width: max-content`, and max-content is measured from the contents rather than
from the widths asked for. Everything the table has beyond the sum of its
columns is then handed back to the columns. So the columns holding long values
were the ones that could not be made small, which is exactly why it looked like
a rule about the workspace column. The table is now told what its columns add
up to, and a column goes to the floor and stops there.

The floor moved from 40px to 24px in the same pass. The first drag records every
column at the width it already has, and the three marker columns sit at 32 —
a floor above them widened three columns as the price of touching a fourth.

### Two projects wore the same colour

`tva` and `Heimdall-agents` came out identical, and that was not bad luck. Six
workspaces drawn from ten colours by a hash collide **85% of the time**. It is
the birthday problem, not a weak hash, and it does not go away by adding
colours: six from sixteen still collide two times in three, and there are
nowhere near enough distinguishable colours to make it rare.

So the colours are handed out rather than computed, lowest free one first, and
remembered — which buys the property the feature exists for: no two projects on
screen share a colour while any are left. The cost, stated plainly: the colour
is no longer a function of the name alone, so the same project can come out
differently on another machine. For a view aid stored beside the theme that is
a fair price, and the assignment is taken from every session loaded rather than
from the rows on screen, so a filter never recolours anything.

There are sixteen now, not ten, and they are not evenly spaced. These are what a
search returned when asked, at each step, for the hue furthest from every hue
already taken, judged on the worse of the two themes in CIE76 on the colours
Chromium actually paints. Sixteen evenly spaced hues leave a worst pair at ΔE
9.9 in the dark theme; these sixteen hold 12.7 in both, and eighteen would drop
to 10.6.

The bar is 12 here rather than the 15 the statuses are held to, deliberately: a
status is a 13px glyph whose colour is one of only two things saying what it is,
while a workspace chip is a wide patch of colour with the name written inside
it.

### The test that let the first one through

It asserted that a dragged column ended up narrower than it started. It did —
just never as narrow as it was told to be. It now drags to the floor and
requires the floor, on a column deliberately filled with a long value.

## 1.1.8

**The columns can be resized**, and the workspace column carries a colour per
project instead of setting its own width.

### The widths are the reader's

Drag the edge of any header, or focus it and use the arrow keys — eight pixels a
press, thirty-two with Shift. `Home`, or a double-click, gives a column back to
its contents. The handle is a `separator` rather than a button: what it carries
is a value inside a range, which is what a width is, and a resize that answers
only to a pointer is one that a keyboard cannot reach at all.

Two things about it are worth writing down, because both are consequences rather
than choices.

The table sizes itself until the first drag and holds still afterwards. That
switch is needed: under an automatic layout a column cannot be dragged narrower
than its widest cell — the content sets a floor no pointer crosses — so a handle
without it would widen a column and silently refuse to narrow one, which is the
direction people reach for. Making the switch permanent instead would cost what
the automatic layout is good at, a column that widens on its own when a longer
name arrives.

And the first drag records **every** column, not the one being dragged. A fixed
layout hands a column with no width of its own an equal share of the leftover
space rather than fitting it to its contents, so writing one width and leaving
the other nine empty would rearrange the whole table on the first pixel. The
same reasoning is why a stored set that has lost a key — a column renamed, or
added by an upgrade — is dropped whole rather than restored in part.

`min-width: 100%` had to go with it, in that mode only. A fixed table gives any
width beyond the sum of its columns back to the columns, so a column dragged
narrower would have handed its pixels straight to its neighbours and the drag
would have appeared to do nothing.

### A colour per workspace, and a column that no longer sets its own width

The folder column was as wide as the longest folder name anyone happened to have
open. It is cut at 14ch now, the way the title column already was, with the whole
path still in the tooltip. The name also picks a colour, so a long list separates
into projects before any of it is read.

**Ten colours, not a hue per name.** Spreading names over all 360 hues put the
two workspaces in the fixtures at 252° and 246°: one blue, shown twice. A near
miss reads as a mistake where an exact repeat reads as a coincidence, and the
name is written inside the chip either way. Ten rather than twelve because the
chips are pale enough that the sRGB gamut caps their chroma — at twelve, adjacent
colours fall to CIE76 14.1 in the dark theme, under the 15 this project already
holds the statuses to. The first fill was paler still, at `oklch` lightness .93,
where no hue can hold more than .028 of chroma and the ten came out as ten
variations on off-white.

The check for it lives in the interface tests rather than in `npm run contrast`,
and not for convenience: the fills are written past the sRGB gamut on purpose so
the browser maps each hue back to the most colourful thing it can show, and
computing from the stylesheet would measure a colour that never reaches a screen.
It asks Chromium what it painted, over all 360 hues in both themes, and holds the
text to 4.5:1, the chip's edge to 3:1 against both the plain and the selected row
— the fill itself lands within 1.00:1 of the selected row around hue 232 and
dissolves — and the ten colours to CIE76 15 against each other, which contrast
cannot ask: ten chips can each be perfectly legible and still be the same colour.

That test read 1.17:1 against a stylesheet that was already correct, twice over.
`getComputedStyle` no longer serialises a colour function as `rgb()`, so reading
the numbers out of `oklch(0.93 0.08 30)` takes the lightness and the chroma for
red and green; it fills a canvas pixel and reads that back now. And the rules sat
above `.link`, which carries the same weight, so `.link { background: none }` won
on source order and the chip had no background at all.

## 1.1.7

**The statuses are drawn**, the marker columns are headed by their own marks and
sort by them, and reset turns back while refresh turns forward.

### The status shapes were four glyphs from four type families

They had been `●✕▲◇`, kept as characters twice over an argument that solid
geometric primitives beat drawings at the size of a line of 13px text. The
argument was asserted and never shown. Rendering the three candidates side by
side at three times size settles it: the dot is small, the cross is thin, the
diamond is a hairline outline — because they came from four different type
families, which is exactly what they were. Drawn from one set they carry one
weight.

The prettiest candidate lost for being pretty. Play, x, pause and question in
circles read beautifully at three times size and share a **circular
silhouette**, and a silhouette is what survives when the centre does not. Circle,
diamond, square and triangle keep the property the whole scheme exists for:
colour is never the only thing saying what a row is.

### The order changed, and it means two things

`STATUS_ORDER` is now running, unknown, failed, idle. That list is the order the
filter chips are drawn in *and* what "status, most urgent first" sorts by — so an
unknown session now outranks a failed one, and idle comes last.

### The marker columns sort

The watched and starred columns are headed by their own marks, in tight columns,
and clicking either sorts by it. Sorting by a marker **replaces** the automatic
grouping rather than losing to it: the grouping lifts what you follow without
being asked, so a sort that lost to it could never do anything — least of all put
watched rows last, which is the one ordering the grouping can never produce.

Reset wears a counter-clockwise arrow, refresh a clockwise one.

### The file lock, a fourth time

In the layer beneath the third. Windows reports a lock file pending deletion as
`EPERM`, and 1.1.6 told contention from a permission problem by asking whether
the lock still existed. **That question is itself a race.** When the holder's
delete completes in between, the answer is "no file", the conclusion is
"unwritable directory", and the change runs with no lock at all — `expected 2 to
be 16`.

Nothing is asked now. A transient code is retried like any other contention, and
only a run of them — about a second — is taken to mean the directory genuinely
will not have us, which is the case the fallback was written for. Sixteen
consecutive full runs clean, against roughly one failure in eight.

| release | what was losing the write |
|---|---|
| 1.1.4 | a 500 ms deadline that broke a live holder's lock |
| 1.1.5 | a vanished lock treated as one to remove |
| 1.1.6 | `EPERM` read as fatal, so the change ran unlocked |
| 1.1.7 | asking *whether the lock exists* to classify that `EPERM` |

Every one of the four was found by a change to the interface rather than by
reading the file, and every one was measured before it was fixed.

## 1.1.6

**The markers say what they mean, and the status column is as wide as its
shapes.**

### An eye, not a radio button

`○` and `◉` were a ring and a dot — which is a radio button, and that is what
they looked like rather than what they meant. The watched marker is an eye now,
in the same two weights the star already used, and the filters that narrow to
those markers wear the same drawings: a filter for a mark should look like the
mark it filters on. The notification switch shows a bell with a stroke through
it when off, because a bell that is not ringing looks exactly like one that is.

### The status column stops being named

Measured before touching it: 93px of column for a 21px shape, against about 50px
for the icon-only columns beside it. The word moves to `sr-only` — the column is
still named for anything reading the page aloud, and still sortable — and an
icon takes its place so the sort control stays visible rather than becoming an
invisible target. **93px to 32px.**

The four status shapes stay characters. At the size of a line of 13px text a
solid geometric primitive is more distinguishable by shape than a drawing scaled
down to meet it, and shape is what carries the meaning when colour cannot.

### The lock stops letting go, for the third and last reason

Windows does not answer `EEXIST` when a lock file is being deleted. The last
handle has closed with a delete pending, and the attempt to create it comes back
**`EPERM`**. `acquire` treated anything but `EEXIST` as fatal and rethrew — and
`withFileLock` answers a throw by running the change **with no lock at all**.

Measured, after two wrong guesses. An isolated probe of 640 concurrent writes
reproduced nothing at all; instrumenting the fallback under a loaded test run
printed `EPERM` on exactly the runs that lost writes. It cost between one and
twelve of sixteen concurrent writers, at roughly one run in six.

What decides is not the error code but whether a lock is there. If the path
exists, somebody holds it and waiting is right, whatever the platform called the
failure. If it does not and the file still cannot be created, the directory is
unwritable — which is the case the fallback was written for.

That closes the third of three ways this file could lose a write, all found in
the last three releases, all measured:

| release | what was losing the write |
|---|---|
| 1.1.4 | a 500 ms deadline that broke a live holder's lock |
| 1.1.5 | a vanished lock treated as one to remove |
| 1.1.6 | `EPERM` read as fatal, so the change ran unlocked |

It holds your marks, and it is shared with the VS Code extension.

## 1.1.5

**The starred marker is drawn rather than typed**, and the settings button steps
aside where a menu already opens that room.

### A star with two weights

`☆` and `★` came from a Unicode block nothing else in the interface uses, and
they were the pair that looked foreign beside the geometric shapes. Phosphor's
`star` and `star-fill` are the same drawing at two weights, which is exactly what
this marker means — and they arrive as `fill="currentColor"`, so the marker
states colour them the way they colour the characters beside them.

Nothing is downloaded at runtime and nothing was added to `dependencies`, which
is still empty. The package is a development dependency; a sprite is generated
from the two icons actually referenced — 1230 bytes, against the nine thousand it
ships — and inlined into the page like the stylesheet, for the same reason a
browser does not carry the token across to a relative asset.

The four status shapes stay as characters. At the size of a line of 13px text,
solid geometric primitives are more distinguishable by shape than any drawing
scaled down to meet them, and shape is what carries the meaning here.

### The settings button, only where it is the second door

The desktop application keeps Settings under File on `Ctrl+,`, so the button in
the bar was a second way into one room. It is hidden there now.

It is *not* hidden in a browser. `asm serve` has no menu and had no shortcut, so
removing the button outright would have made the panel unreachable — it was the
only door. The page asks the host which it is talking to, and **`Ctrl+,` now
works in the page as well**, so both hosts answer the same key.

### The file lock loses no more writes

Removing the lock's 500 ms deadline in 1.1.4 uncovered a second race beneath it.
`isStale` answered *yes* when the lock had simply **gone**, and the caller then
removed whatever lock was present — which by that point could be a fresh one
another writer had just taken. Two writers inside at once, and one write lost.

Measured as `expected 15 to be 16`, and as seven stars kept out of eight when
several windows write together. A lock that has vanished is not a lock to remove:
the answer now separates *gone* from *old*, and only *old* is deleted. Ten
consecutive full runs clean, where the previous shape failed roughly one in
three.

That file holds your marks, and it is shared with the VS Code extension. It has
now gained its first two real tests for concurrent writers.

## 1.1.4

**The status filters show the shape they filter on.** The rows have carried a
shape per status since the beginning — precisely so colour is never the only
thing saying what a row is — while the filter chips and the notification chips
carried the word alone. The same four statuses were a shape and a colour in one
place and plain text in two others, and the mapping had to be learned twice.

### One glyph changed, and three did not

Circle, cross, triangle and diamond are four things nobody has to compare with
each other to tell apart, which is the point of having them at all.

`failed` was a filled square and is now a **cross**. A square says nothing on its
own — it was only ever *the red one* — while a cross reads as a failure with the
colour taken away, which is exactly the condition this set exists for.

`idle` keeps its triangle deliberately. That triangle is the application's own
icon, drawn by `scripts/make-icon.mjs` as "the one shape in the interface that
means this one has stopped and is waiting for you". A prettier glyph here would
quietly desynchronise the taskbar from the list.

### The colours were measured against each other for the first time

`npm run contrast` asked whether each status clears the background. It never
asked whether `running` can be told from `failed` — the question a green and a
red raise for roughly one man in twelve.

Checked pairwise under normal, deuteranopic and protanopic vision:

| theme | worst pair | before | after |
|---|---|---|---|
| dark | `running`/`failed`, protanopia | ΔE 10.0 | **20.6** |
| light | `failed`/`idle`, deuteranopia | ΔE 4.1 | unchanged |

The dark theme was free: that green becomes teal, still reads as *go*, and the
worst pair nearly doubles.

**The light theme is knowingly left as it was**, and the reason is written into
the stylesheet rather than left to be rediscovered. On white, `failed` and `idle`
must both be dark to clear 3:1, and two dark warm colours converge under that
vision whatever their hue — a search that maximised separation returned a
near-black brown for `failed`, which stops reading as an error at all. Moving
`idle` off orange instead desynchronises the application icon, which *is* that
colour.

So the trade is declined. `npm run contrast` now **reports** that pair rather
than failing on it, so it stays visible instead of looking like an oversight —
and colour was never the carrier here. The shape is, and it is now in all three
places.

### The file lock no longer breaks itself under contention

Not part of the work above, and found by it: preparing this release, the
concurrency test failed with **`expected 4 to be 12`** — eight increments lost to
the very race `fileLock.ts` exists to prevent.

`acquire` waited 25 ms between attempts and gave up after a flat 500 ms, at which
point it deleted the lock and wrote anyway. Twelve writers queue for roughly
300 ms before the last is served, so a busy machine crossed that deadline and
every remaining writer overwrote a **live** holder. Marks are written by this
application and by the VS Code extension, so the contention is not hypothetical.

The deadline was also redundant. A holder that died is already reclaimed by the
staleness check five seconds on, and a holder never refreshes its lock — so
nothing could block a waiter for longer than that with or without a deadline. A
waiter now yields only to a lock old enough to belong to a process that is gone.

Waiting up to five seconds for a live holder is slower than overwriting it. It is
also the difference between a change that arrives late and a change that is
silently gone.

## 1.1.3

**Nothing a user can see has changed.** The source that runs is the source that
ran in 1.1.2; this rebuilds it on a current toolchain. It is published rather
than held back because a release that changes nothing is the cheapest way to
exercise the update path, and that path has had three defects in as many
versions.

### Vitest 4, and floors that measure the same thing again

The upgrade passed every one of the 421 tests and failed on the coverage
thresholds, which is a different sentence and had to be treated as one. Measured
on the same commit, one version apart:

|            | Vitest 3           | Vitest 4               |
|------------|--------------------|------------------------|
| statements | 64.27% (2933/4563) | **65.60%** (1438/2192) |
| lines      | 64.27% (2933/4563) | **65.60%** (1366/2082) |
| branches   | 88.68% (995/1122)  | 70.77% (879/**1242**)  |
| functions  | 81.27% (230/283)   | 62.12% (333/**536**)   |

The denominators carry it. Functions go from 283 to 536 — Vitest 4 counts the
callbacks and arrow functions that 3 walked past — and branches gain 120.
Statements and lines *rise*, because the old total was padded with lines that
never execute. Coverage did not fall; 87% of a branch count missing a tenth of
the branches was never the stricter bar it looked like. The comparison sits in
`vitest.config.ts` beside the numbers, so the next reader of "62% functions"
does not mistake it for a collapse.

### `@types/node` follows the floor, not the ceiling

It described Node 22 while `engines` promised `>=20.11.0`, and Dependabot
proposed 26. Types ahead of the supported runtime let `tsc` accept a call that
does not exist where the code has to run, so the compiler stops guarding the
promise and starts contradicting it. Measured before choosing: with
`@types/node@20.19.43`, `tsc --noEmit` exits 0 — nothing in `src/` reaches past
Node 20. The major is ignored in `dependabot.yml` with the reason written there,
and moves when `engines` moves.

None of this ships. `dependencies` is empty, `files` is `["dist"]`, and what
runs on a machine is the Node bundled inside Electron.

### Dependabot stops proposing the impossible

Its first run opened seven pull requests, four of which could never have passed.
`vitest` and `@vitest/coverage-v8` are peers of one another, so each arrived
alone and died at `npm ci`; the same for `typescript` against `typescript-eslint`,
which accepts `>=4.8.4 <6.1.0` and will not take TypeScript 7 until it does.
Packages that cannot move without each other are now grouped, majors included.
The configuration was corrected by the thing it configures, on its first run.

## 1.1.2

**Refresh sits next to Acknowledge visible**, on the bar that carries the
counter, instead of among the notification controls three toolbars up. The two
do the same kind of thing — one re-reads the list, the other settles what is on
screen — and both are reached for after looking at the rows rather than before.
Where it used to sit is a row of settings, and it was the only button there
doing something to the list rather than to how the list behaves.

Markup only: the handler is wired by identifier, and `r` is unchanged.

### A test that was failing for the wrong reason

The watcher test written for 1.1.0 timed out on node 20 in CI — 12.9 s against a
five-second budget — on a branch that changed one line of markup. Nothing about
the watcher was wrong. It spawned PowerShell to ask Windows for an 8.3 short
name, and starting PowerShell on a cold runner costs more than the whole budget
before doing anything.

Moving it to `cmd` made it fast and wrong instead: `cmd /c` re-quotes a command
that already contains quotes, and the answer came back as `C:\"C:\Users\...\"`.

It asks nothing of a subprocess now. A junction is a second name for the same
directory, `fs.symlinkSync(dir, link, 'junction')` needs no privilege, and it
exercises exactly what the fix is for: a path reaching libuv spelled differently
from how the operating system reports it. Deterministic, and 0.6 s across three
consecutive runs.

The test was introduced in the very commit that credited CI with finding a real
bug, and it was unreliable from birth — it passed on one machine, which is the
failure mode that commit had just described.

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
