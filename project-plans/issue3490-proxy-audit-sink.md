# Issue #3490 — Credential proxy audit log must not write to a TUI-owned terminal

Plan id: `PLAN-20260901-PROXYAUDIT`

## Problem

`auditLog()` in `packages/providers/src/auth/proxy/audit-log.ts` writes a JSON
line to `process.stderr` for every credential-proxy event, at every severity,
unconditionally. The credential proxy runs in the host process that then hands
the terminal to an Ink TUI (the sandbox child), so proxy bookkeeping lands on
the same file descriptor the interface is drawing on.

## Where the proxy actually runs (verified)

- `createAndStartProxy()` (`sandbox-proxy-lifecycle.ts`) is constructed only
  from `packages/cli/src/utils/sandbox-containers.ts:637`, reached via
  `setupCredentialProxy()` from `sandbox-containers.ts` and
  `sandbox-exec.ts:480` (`startCredentialProxyGuarded`). Both run inside
  `start_sandbox()`.
- `start_sandbox()` is called from exactly one place:
  `maybeHopIntoSandbox()` in `packages/cli/src/cliSandbox.ts:202`.
- The host process keeps `patchStdio()` active for the whole hop, so raw
  `process.stderr.write` from the proxy is routed to `coreEvents` `Output` and
  buffered (no listener is registered on the host hop path) until
  `runExitCleanup()` drains it after the child exits. That drain is the
  "block dump at teardown" in the issue; the live overwrite is the same bytes
  reaching the shared terminal.
- The proxy server is therefore never live in a process rendering its own Ink
  UI. The terminal handoff at `start_sandbox()` is the single seam where a TUI
  takes ownership.

## Accepted behavior

Scope is `auditLog()` plus the one call site that marks terminal handoff.

### AB1 — durable sink, always

Every audit record, at every level, in every mode, is appended as one JSON line
to a file sink at `<Storage.getGlobalLogDir()>/credential-proxy-audit.log`.
`Storage.getGlobalLogDir()` is honored per write, so `LLXPRT_LOG_HOME` (and the
`LLXPRT_CONFIG_HOME` fallback) redirect the sink. The directory is created if
absent. Sink failures never throw out of `auditLog()`.

### AB2 — default (no TUI owns the terminal): unchanged stderr behavior

When no TUI owns the terminal, `auditLog()` writes the same JSON line to
`process.stderr` it writes today, for INFO, WARN and ERROR alike, still guarded
by `process.stderr.destroyed` and still swallowing write failures. This is the
non-interactive and non-TUI path required by acceptance criterion 4.

### AB3 — TUI owns the terminal: zero stderr bytes

When a TUI owns the terminal, `auditLog()` writes no bytes to `process.stderr`
at any level. INFO records go to the sink only.

### AB4 — WARN/ERROR stay visible via the UI error surface, plus a deferred stderr flush on release

When a TUI owns the terminal, WARN and ERROR records are additionally published
through `coreEvents.emitFeedback()` (severity `warning` / `error`) — the
existing user-feedback surface — carrying the same redacted line content. They
are not written to `process.stderr` while ownership is held.

`coreEvents` is a per-process in-memory singleton: the credential proxy runs
in the HOST process while the Ink UI subscribing to `CoreEvent.UserFeedback`
runs in the separately spawned sandbox child, so the host's publish cannot
reach that UI during the hop (and the teardown drain installs listeners only
for `Output`/`ConsoleLog`, so the feedback backlog is dropped). Transporting
notifications over host-to-sandbox IPC was considered and rejected as a new
subsystem, out of scope for this issue.

The operator-visible fallback is a deferred flush: while ownership is held,
WARN/ERROR lines are buffered in module state. When `setTuiOwnsTerminal(false)`
transitions from owned to not-owned — the sandbox child has exited and the
terminal is free, so the write cannot corrupt anything — the buffered lines
are written to `process.stderr` through the same guarded path as the normal
stderr record (`process.stderr.destroyed` check, same catch), and the buffer
is cleared. Releasing ownership with an empty buffer writes nothing;
re-asserting the current ownership value is a no-op, so nothing is duplicated
or reprinted. INFO is never buffered and never reaches stderr under TUI
ownership (sink only).

### AB5 — ownership is explicit and scoped to the handoff

`audit-log.ts` exports `setTuiOwnsTerminal(owned: boolean): void`. The CLI sets
it to `true` immediately before `start_sandbox()` in `maybeHopIntoSandbox()`
when the session is interactive (`config.isInteractive()`), and restores it to
`false` in a `finally` once `start_sandbox()` returns or throws. Nothing else
sets it. Default is `false`, so every other entry point (unit tests, scripts,
non-interactive runs, library consumers) keeps AB2 behavior.

Redaction and the unserialisable-details fallback are unchanged and apply to
the sink line, the stderr line and the feedback message identically.

## Boundary cases the tests must pin

1. INFO under TUI ownership: sink line present, zero stderr bytes, no feedback.
2. WARN and ERROR under TUI ownership: sink line present, zero stderr bytes,
   feedback emitted with matching severity.
3. INFO/WARN/ERROR without TUI ownership: stderr line present (today's bytes)
   AND sink line present.
4. Token-shaped values in `details` are redacted in the sink file, not just on
   stderr.
5. Unserialisable `details` still produce a record in the sink.
6. Ownership is restored to `false` after the handoff, including when
   `start_sandbox()` throws.
7. A sink that cannot be written (unwritable log dir) does not throw out of
   `auditLog()` and does not suppress the stderr path in default mode.

## Test plan

Real filesystem, no fs mocking: point `LLXPRT_LOG_HOME` at a per-test temp dir
and read the file back. `process.stderr.write` is captured the way the existing
suite already does it (`github-broker-security.test.ts`), which is capture of an
external sink, not a mock of the unit under test.

- New file `packages/providers/src/auth/proxy/__tests__/audit-log-sink.test.ts`
  (bun:test) covering boundary cases 1-5 and 7. Shared temp-dir lifecycle helper
  registered once, per the test-writing rules; ownership flag reset in
  `afterEach`.
- Existing `github-broker-security.test.ts` redaction/unserialisable cases stay
  green unchanged (they exercise the default no-TUI path).
- CLI-side behavioral test for boundary case 6 next to the existing
  `cliSandbox` tests: the flag is set for the duration of the interactive hop,
  is not set for a non-interactive hop, and is restored when `start_sandbox()`
  rejects.

## Out of scope

Log rotation/retention for the new sink, changing any audit call site's level,
routing other components' stderr writes, and the `sandbox-proxy-lifecycle.ts`
`stop()` warning write.
