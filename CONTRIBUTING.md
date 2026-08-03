# Contributing

The standard this project is held to is written down in
[CLAUDE.md](CLAUDE.md), and it is worth reading before a first change rather
than after. It is short, and it is not a style guide — it is the set of
decisions that keep being made the same way. What follows is the practical part.

## The rhythm

```sh
npm ci
npx tsc --noEmit
npx eslint src
npx vitest run
npm run build && npx playwright test
npm run contrast
```

CI runs exactly these, on Windows, on node 20 and 24. Running them before
pushing is faster than finding out afterwards.

Windows matters here rather than being an accident: the interface suite drives
the compiled service, the notification path is PowerShell, and the handover asks
Windows to open a URI. A green run on another platform is a green run of
something else.

## What a change is expected to carry

- **A test that fails without it.** A test that passes both before and after is
  the most expensive kind of test, because it looks like cover. If the change is
  visual, `npm run contrast` and the Playwright suite are where it belongs.
- **The reason, in prose.** Comments here explain *why* a thing is the way it
  is, usually because the obvious alternative was tried and was wrong. Commit
  messages do the same, in sentences, without bullet lists.
- **English**, in code, comments, documentation and commits.

## What tends to come back in review

- **No shell one-liners rewriting source files.** Two NUL bytes reached `src/`
  that way once; they worked, made the files read as binary so `grep` skipped
  them, and were invisible on review.
- **Use the platform's mechanism, not an approximation of it.** `light-dark()`
  rather than a second palette, `Intl` rather than hand-built date strings, a
  `<dialog>` rather than a floating div.
- **One behaviour, whatever the provider.** Claude and Codex sessions appear in
  one table under one set of statuses. Different evidence reaching the same
  behaviour is expected; a capability that changes what the user sees on one
  side only does not ship.
- **Say what is not done.** A skipped or blocked part of a change belongs in the
  pull request, not in the reviewer's discovery.

## This repository is public

No client names, no customer paths, no home directories — not in code, tests,
comments, or a changelog entry. Two slipped through once: a *truncated* fragment
in a prefix-matching test, and a release note that named someone while
explaining they had been removed. Search for fragments rather than whole words.

## Releasing

Bump the version, add the `CHANGELOG.md` heading, then `npm run check-release`
before tagging. Pushing a `v*` tag builds and publishes the installer together
with `latest.yml`; the update path refuses a release whose manifest does not
cover its installer, so the two travel together or not at all.
