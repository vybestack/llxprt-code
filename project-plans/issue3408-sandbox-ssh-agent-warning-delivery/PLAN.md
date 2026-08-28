# Issue #3408 — Sandbox empty SSH-agent warning: flush the stdio backlog on the hop exit path and deliver the warning into the in-container session

## Problem

The #1699 empty-agent preflight fires correctly but its warning never reaches
any user-visible stream. Two independent defects in the delivery path:

1. **The sandbox supervisor drops all patched stdio output.** `main()` installs
   `patchStdio()` (packages/cli/src/cli.tsx:139) before anything else, which
   replaces `process.stderr.write` with a stub that buffers into
   `coreEvents._outputBacklog`. Every ordinary exit path drains that backlog
   (`initializeOutputListenersAndFlush()`, either during session startup or via
   the sync cleanup that `runExitCleanup()` drains). The sandbox hop path in
   `maybeHopIntoSandbox()` (packages/cli/src/cliSandbox.ts:208) ends with a bare
   `process.exit(exitCode)` and never calls `runExitCleanup()`, so the backlog
   dies with the process. The `initialAuthFailed` branch in the same function
   does the cleanup correctly.
2. **The warning is generated in the wrong process for interactive users.** The
   host supervisor generates it before the container starts; the TUI the user
   actually watches runs inside the container and never sees it. Even with the
   flush fixed, the host-side write only appears after the container exits.

## Scope

In scope:

- Call the exit cleanup on the sandbox hop exit path before `process.exit`, so
  all supervisor-side buffered output (including this warning) reaches real
  stderr.
- Hand the empty-agent condition from the host supervisor to the container via
  a non-secret `--env` flag pushed into the same args the forwarding helpers
  already mutate, for both docker and podman.
- Consume the flag in the in-container CLI: interactive sessions render the
  warning through the existing startup-warnings UI (Notifications
  startup-warnings box); non-interactive sessions write it to real stderr via
  `writeToStderr` (which bypasses the stdio patch by design).

Out of scope (tracked separately in #3408's companion follow-ups):

- The host-absolute `credential.https://github.com.helper` passthrough.
- Tunnel supervision and orphaned-container lifecycle.
- Any change to forwarding itself, to the `sshAgent: auto` semantics, or to
  the probe. The warning text and firing conditions from #1699 are unchanged.
- The Zed/ACP integration path, which bypasses session dispatch.

## Design

### Fix A: flush before exit on the hop path

In `maybeHopIntoSandbox()` (packages/cli/src/cliSandbox.ts), replace:

```ts
process.exit(exitCode);
```

with:

```ts
await runExitCleanup();
process.exit(exitCode);
```

This mirrors the `initialAuthFailed` branch twelve lines above. `runExitCleanup()`
drains sync cleanups, which runs the registered stdio flush
(`initializeOutputListenersAndFlush()` + `cleanupStdio()` from cli.tsx:140-144),
so buffered supervisor output reaches the real file descriptors. This is a
generic correctness fix for every supervisor-side `process.std*.write`, not
scoped to the SSH warning.

### Fix B: host-to-container warning handoff

**Host side** (`packages/cli/src/utils/sandbox-ssh.ts`):

- Export `SSH_AGENT_EMPTY_WARNING` (currently module-private) so the
  in-container consumer renders the identical text without duplication.
- Change `warnIfSshAgentHasNoIdentities()` to return `Promise<boolean>`: true
  when the empty-agent warning fired, false for every silent outcome. The
  write to `process.stderr.write` stays (Fix A makes it visible).
- In `setupSshAgentForwarding()`, inside the existing
  `containerWillReceiveSshAgent(args)` guard:

```ts
const warned = await warnIfSshAgentHasNoIdentities(sshAuthSock);
if (warned) {
  args.push('--env', 'LLXPRT_SANDBOX_SSH_AGENT_EMPTY=1');
}
```

Engine-agnostic: docker and podman both consume repeated `--env KEY=VAL` args,
and both forwarding helpers already push `--env SSH_AUTH_SOCK=...` through this
same array, so no per-engine work is needed. The flag is a boolean; no secret
or key material crosses the boundary.

**Container side** (`packages/cli/src/utils/startupWarnings.ts` or a sibling
module, imported by `packages/cli/src/session/nonInteractiveSession.ts`):

- `getSandboxHandoffWarning(env): string | undefined` returns
  `SSH_AGENT_EMPTY_WARNING` when `env.LLXPRT_SANDBOX_SSH_AGENT_EMPTY === '1'`,
  undefined otherwise. Import the constant from `sandbox-ssh.js` (same package,
  no drift).
- In `dispatchInteractiveOrNonInteractive()`:
  - Interactive branch: prepend the handoff warning to `startupWarnings` before
    `startInteractiveUI`, so it renders in the Notifications startup-warnings
    box from the first frame and persists for the session (the box has no
    dismiss control; the warnings array lives in App state for the session).
  - Non-interactive branch: before `runPipedOrPromptSession`, write the warning
    with `writeToStderr` (real fd 2, unaffected by `patchStdio`; stdout JSON
    stays clean).

The #1699 plan rejected the startup-warnings *file* because host and container
`os.tmpdir()` differ. This design does not use the file: the flag travels via
container env, and the in-container code injects the text directly into the
warnings array.

### Expected duplicate in non-interactive mode

A sandboxed non-interactive run now shows the warning twice: once immediately
from the in-container `writeToStderr`, once from the host flush at supervisor
exit. Both land on the same terminal. This is accepted: Fix A is a generic
flush that cannot suppress individual items, and immediate visibility beats a
single delayed copy. Interactive users see the in-TUI box, plus the host-side
copy after the TUI exits, for the same reason.

## Acceptance criteria

- **AC1** On the hop exit path, patched stdio output written before the
  container spawns is flushed to the real stderr before the process exits
  (supervisor no longer drops its own output).
- **AC2** When the empty-agent warning fires, the container args gain
  `--env LLXPRT_SANDBOX_SSH_AGENT_EMPTY=1`; when the probe finds identities, is
  inconclusive, or forwarding is off/declined, no such arg is added.
- **AC3** The handoff arg is added only inside the existing
  `containerWillReceiveSshAgent` guard (a declined helper still produces no
  flag, matching #1699 AC6).
- **AC4** In-container interactive session: with the env flag set, the
  three-line warning is part of `startupWarnings` passed to
  `startInteractiveUI` and rendered by the Notifications startup-warnings box;
  without the flag, startup warnings are unchanged.
- **AC5** In-container non-interactive session: with the env flag set, the
  warning is written to real stderr before the prompt runs; without the flag,
  nothing is written.
- **AC6** `sshAgent: auto` remains strictly non-blocking: forwarding args, the
  `SshAgentResult`, and container startup are identical in every outcome; only
  the extra `--env` pair on the warned branch differs.
- **AC7** Both engines get the flag through the shared `setupSshAgentForwarding`
  args mutation (no engine-specific code).

## Boundary cases

- Probe inconclusive (timeout, ENOENT, exit 2, non-empty failure output): no
  flag, no warning (unchanged #1699 AC5).
- `sshAgent: off`, missing `SSH_AUTH_SOCK`, missing socket, podman-macOS
  non-host network decline: no flag, no probe (unchanged #1699 AC6).
- Env flag already present in the environment for non-sandbox reasons: only the
  in-container display branch reads it; it is only ever set by the supervisor
  via `--env`.
- Double-hop or nested sandbox: the flag is boolean and idempotent in effect
  (the warning simply renders); no accumulation concern beyond one box entry.
- Zed/ACP path does not consume the handoff (out of scope; no behavior change
  there).

## Test plan (behavioral, no mock theater)

1. **Hop exit flush (AC1)** — in a new or extended `cliSandbox` test: call
   `patchStdio()`, write a marker via `process.stderr.write` (buffered), then
   run the hop exit sequence with `process.exit` replaced by a sentinel
   (throwing stub). Assert the marker reached real stderr (captured fd) and the
   sentinel fired, in that order. Use the real `registerSyncCleanup` /
   `runExitCleanup` machinery, not a mocked drain.
2. **Flag on warn (AC2/AC3/AC6)** — extend
   `sandbox-ssh-agent-preflight.test.ts`: empty-agent case now also asserts the
  `--env LLXPRT_SANDBOX_SSH_AGENT_EMPTY=1` pair in args (both orderings of the
   pair tolerated) and unchanged `SshAgentResult`; loaded-agent,
   inconclusive-probe, off/declined cases assert no such arg. These tests drive
   the public `setupSshAgentForwarding` with realistic probe outcomes as today.
3. **Handoff reader (AC4/AC5 seam)** — unit test of
   `getSandboxHandoffWarning`: flag `'1'` returns exactly
   `SSH_AGENT_EMPTY_WARNING`; unset, `''`, or other values return undefined.
4. **Interactive delivery (AC4)** — session-dispatch level test (extend the
   characterization suite or a focused test): env flag set → `startupWarnings`
   passed to `startInteractiveUI` starts with the warning; flag unset →
   unchanged warnings. If the existing harness renders the real App, assert the
   Notifications startup-warnings box content on first render.
5. **Non-interactive delivery (AC5)** — same dispatch level: env flag set → the
   exact warning text is written to stderr (via a captured `writeToStderr`
   target) before the session runs; flag unset → no write.

## Documentation

docs/sandbox.md troubleshooting ("SSH agent forwarded but git auth still
fails") gains one sentence: the warning now appears in the TUI startup-warnings
box (and on stderr for non-interactive runs) instead of only on host stderr.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and the CLI smoke test
(`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`).
Manual podman check on this machine: with the empty launchd agent, a sandboxed
non-interactive run's stderr contains the warning, and an interactive sandboxed
run shows the startup-warnings box entry.
