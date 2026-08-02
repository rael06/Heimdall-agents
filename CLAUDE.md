# How work is done here

Read this before starting on a request, not after. It is not a style guide; it
is the standard the owner holds this project to, and it was written down because
it had to be said out loud once.

## Standards and the state of the art, every time

**No bodges.** Not as a first draft, not "just to get it working", not because a
request looked small. If the proper way costs an extra step, take the extra
step. If it costs an extra hour, say so and take it anyway.

Concretely, what that has meant here:

- **Edit source files with an editor**, never with a shell one-liner that
  rewrites them by string substitution. Two NUL bytes reached `src/` that way —
  they worked perfectly, made the files read as binary so `grep` skipped them,
  and were invisible on review. A bodge that works is the expensive kind.
- **Use the platform's own mechanism** rather than an approximation of it.
  `light-dark()` instead of a duplicated dark palette. `Intl` instead of hand-rolled
  date strings. A `<dialog>` instead of a floating div.
- **When a capability does not exist, say so** and stop. Pinning to the Windows
  taskbar is blocked by the OS; the answer was one manual right-click, not a
  registry hack that breaks the taskbar layout.
- **No test-only branches in production paths**, and no settings that appear to
  save and quietly change nothing.

## One behaviour, whatever the provider

The window lists Claude and Codex sessions side by side, in one table, under one
set of statuses. So for the same situation the reader must see the same thing,
whichever provider produced it. That is a product rule, and it outranks any
capability one provider happens to offer.

The test is not "is it the same code on both sides" — it is "for the same
situation, does the user see the same thing". Different evidence reaching the
same behaviour is fine and expected:

- Claude reports a pending question through an unanswered `AskUserQuestion` tool
  in the transcript. Codex has no such tool, and asks by ending its turn on a
  question, which the final-answer reading catches. Two mechanisms, one
  behaviour: a session waiting on you is flagged. This is allowed.
- `~/.claude/sessions/<pid>.json` maps a live process to a session, and Codex
  has nothing like it — measured: `thread-writer-locks` holds one empty
  coordination lock and no per-thread entry. Using it would have marked a dead
  Claude session inconclusive at once while an identically dead Codex session
  waited three hours. Same fact, two speeds. **Dropped for that reason**, not
  for a technical one.

When a provider offers something the other cannot match, the question to ask
first is whether it changes what the user sees. If it does, it does not ship.

## Verify, do not assume

Every claim in this repository was measured, read from source, or watched
happening. That standard is the reason several conclusions here were wrong on
the first attempt and caught before shipping:

- `asm watch` had every unit test green and exited a tenth of a second after
  starting. Only timing the process found it.
- The handover reported success and opened nothing, because the process
  inherited `ELECTRON_RUN_AS_NODE=1` from a VS Code terminal.
- The contrast checker reported a clean palette while two things on every row
  sat near 2:1, because they receded with `opacity` and it only measured
  variables.

A green test suite is evidence about the tests. Run the thing.

## Say what is not done

If part of a request is skipped, blocked, or done differently, it goes in the
reply — not left to be discovered. If a decision recorded in the changelog is
being reversed, say so, and record the reversal there too.

## Always restart the application after a change

The repository and the running application are expected to match. A merged
change that is not installed is not a change the owner can see or judge, so
rebuilding, reinstalling and relaunching is part of the change — not a follow-up
to be asked for.

**Stop it before installing over it.** The window loads its page once, at
startup, and a running instance holds the single-instance lock: installing over
a live one and then launching can leave the previous page on screen while the
new version sits on disk. That cost a round-trip once — a fix was reported as
not working and the code was already correct, which is the most expensive kind
of wrong answer to give.

```sh
taskkill /F /IM "Heimdall agents.exe"     # first, always
npm run dist
"dist/Heimdall agents Setup <version>.exe" /S
# then launch it detached, from the desktop `tools` shortcut
```

Launch it with `ELECTRON_*` and `VSCODE_*` stripped from the environment. A
shell inside VS Code carries `ELECTRON_RUN_AS_NODE=1`, which makes the packaged
application start as a Node interpreter and exit without a word.

## This repository is public

Everything committed here is readable by anyone. It grew in a private
repository, and the names of real client projects reached its test fixtures and
its README examples before that was noticed. So: **no client names, no customer
paths, no home directories** — in code, in tests, in comments or in a changelog
entry.

Two of them slipped past a search for the whole word, and both are worth
remembering:

- a **truncated** fragment, in a test checking prefix matching, which no search
  for the full name could find;
- a **release note that named them while explaining they had been removed**.

Search for fragments, not only for words, and search the tree you are about to
publish rather than the one you are working in.

## The rhythm

`npx tsc --noEmit`, `npx eslint src`, `npx vitest run`, `npm run build &&
npx playwright test`, `npm run contrast`. Then bump the version, update
`CHANGELOG.md` and `README.md`, commit, merge into `main`, push, and restart the
application as above.

A user-visible release also needs `gh release create v<version>` with the
installer **and** `latest.yml` attached — the update check refuses to install
from a release whose manifest does not cover the file.

Commit messages explain *why*, in prose, without bullet lists.

Code, comments, documentation and commits in English. The conversation is in
French.
