# Reporting a security problem

**Please do not open a public issue for one.** Use GitHub's private vulnerability
reporting, from the *Security* tab of this repository → *Report a vulnerability*.
That reaches the maintainer without the report being readable by everyone first.

Include what you did, what happened, and the version from *Help → About*. A
proof of concept is welcome and never required; a clear description of the path
is worth more than a working exploit.

## What this program is, so a report can be aimed

It reads transcript files written by two other programs, keeps a small HTTP
service on the loopback interface, and asks Windows to open URIs. It sends
nothing anywhere, has no accounts, and has no runtime dependencies.

Three areas are where a problem would matter most:

- **The loopback service.** It binds `127.0.0.1` and is reachable from every
  page the browser has open, so every request must carry a token minted at
  startup, and the `Host` and `Origin` headers must be ours. Anything that gets
  a request past `src/service/guard.ts` is serious.
- **The handover.** Session identifiers and workspace paths come out of files
  this program does not write, and end up in a URI handed to the operating
  system. Anything that turns one of those into a command, a different program,
  or a path outside what was asked for is serious. This has gone wrong once
  already, through `cmd`.
- **The update path.** It fetches a release from GitHub over TLS, checks the
  host at every redirect hop, and refuses to run an installer whose length and
  published `sha512` do not both match. Anything that gets an unverified file
  executed is serious.

## What is already known and is not a finding

- **The installer is not code-signed.** SmartScreen warns on first run. Signing
  is a purchase, not a change, and it is stated in the README rather than
  implied away.
- **The token is in the page's address.** It is what lets a reload work and a
  filtered view be kept as a favourite. Responses carry `Referrer-Policy:
  no-referrer` so the browser does not hand it on.
- **Anyone with your user account can read everything this reads.** The
  transcripts, the marks and the service file are all files in your own home
  directory, protected by the operating system and nothing else. This program
  is not a boundary between you and yourself.

## Versions

The latest release is the only one that gets a fix. There is no long-term
branch, and there is no schedule — this is one person's project.
