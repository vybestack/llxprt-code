# Issue 2908: Windows Sandbox Credential-Proxy Connection Loss

## Status

Candidate remediation and local verification are complete on POSIX (macOS arm64,
Bun 1.3.14). Windows candidate CI remains pending and is authoritative for the
reported named-pipe behavior.

## Root Cause

After a successful connect+handshake the proxy socket was unconditionally
`unref()`-ed. On Windows named pipes the libuv transport stops polling an
unreferenced handle, so transport events (error/close/end) were not delivered
promptly while a request was pending. A request whose server-side transport was
lost therefore waited the full 30-second request timeout instead of rejecting
with the connection-loss error.

## Accepted Production Fix (smallest root fix)

Socket reference is now driven by active-versus-idle state:

- The unconditional `socket.unref()` immediately after connect is removed, so
  the socket stays referenced while connect/handshake is in flight.
- `resetIdleTimer()` calls `socket.ref()` while requests are pending and
  `socket.unref()` once idle.
- `maybeArmIdleTimer()` releases the reference on the active→idle transition.

No ownership guards, listener-stripping, connect-cancellation subsystem, or
gracefulClose refactor. Those speculative expansions were reviewed and removed
because they could orphan connect (removeAllListeners strips one-shot
connect/error listeners) and are outside accepted issue behavior.

## Files Changed

1. `packages/auth/src/proxy/proxy-socket-client.ts` — production ref/unref
   lifecycle fix only (3 hunks: connect, resetIdleTimer, maybeArmIdleTimer).
2. `packages/auth/src/proxy/__tests__/proxy-socket-client.test.ts` — behavioral
   tests using real sockets/subprocess.
3. `packages/providers/src/auth/proxy/__tests__/integration.test.ts` —
   strengthened transport-loss provider integration test.

## Test Remediation

- Subprocess module locator uses a portable ESM file URL
  (`new URL('../proxy-socket-client.js', import.meta.url).href`) instead of
  `URL.pathname`.
- A single `TEST_DEADLINE_MS = 2_000` budget (well below Bun's 5s per-test cap
  and the 30s request timeout) centralizes all deadline races.
- `deadlineRace()` helper returns the losing timer so callers clear it in every
  path; subprocess cleanup always terminates and awaits child exit.
- The pre-existing auth transport-loss test ("surfaces 'Credential proxy
  connection lost' on connection error") is strengthened with a sub-cap deadline
  and strict connection-loss/not-timeout assertion.
- ONE multi-pending transport-loss + reconnection case is kept; it covers
  concurrent settlement and reconnect behavior directly.
- The speculative stale-terminal-event test and all standalone reconnect
  duplicates were removed (no deterministic RED evidence; overclaimed ownership).
- The real idle-process liveness subprocess test is kept and made portable and
  fail-fast (2s watchdog, child always terminated in cleanup).
- The provider integration test closes `proxyStore.getClient()` and clears the
  deadline timer in cleanup so no pending promise, timer, or referenced socket
  survives failure.

## Focused Verification (POSIX, macOS arm64, Bun 1.3.14)

- `packages/auth` proxy-socket-client tests: 16 pass, 0 fail (stable across 3
  repeated runs).
- `packages/providers` proxy integration tests: 25 pass, 0 fail (stable across
  3 repeated runs).
- ESLint on changed files: clean.
- Typecheck (`tsc --noEmit`) for `packages/auth` and `packages/providers`:
  clean.
- Prettier `--check` on changed files: clean.
- `git diff --check`: clean.

## Full Local Verification

- Repository-wide test suite: passed. An initial run had one core test-file
  process timeout; the isolated file passed immediately and the complete suite
  passed on rerun.
- Repository-wide lint: passed.
- Repository-wide typecheck: passed.
- Repository-wide format: passed.
- Repository build: passed.
- `stepfun-37` smoke test: passed.

## Remaining Mandatory Gate

Windows named-pipe CI is authoritative for the unref-polling behavior that
causes the reported request-loss symptom. POSIX tests cannot reproduce the
deferred event ordering that triggers the Windows failure. The PR cannot be
declared complete until the candidate head passes Windows CI with these tests.

## Accepted Behavior

### Required behavior

1. When an established sandbox credential-proxy transport is lost while a
   request is pending, that request rejects with the existing descriptive
   connection-loss error instead of waiting for its request timeout.
2. When the server stops after a successful request, a subsequent request does
   not remain pending on a stale Windows named-pipe connection. It rejects
   promptly with a transport/connect error.
3. Transport-loss cleanup settles each pending request once, clears its timeout
   and abort listener, and leaves the client able to establish a new connection
   when a server is available again.
4. A connected client remains unreferenced while idle so an idle proxy does not
   keep Bun alive. The socket is referenced while connect/handshake or an
   active request requires transport events; the reference is restored to idle
   unreferenced behavior after settlement.
5. Existing successful request, concurrent request, cancellation, explicit
   `close()`, graceful idle close, protocol negotiation, and POSIX socket
   behavior remain unchanged.

### Explicit non-goals

- No request-timeout increase or acceptance of timeout as a connection-loss
  result.
- No credential-proxy removal or redesign.
- No change to non-sandbox direct keyring behavior.
- No behavioral-eval prompt, assertion, model, provider, aggregation, or retry
  change.
- No GitHub Actions workflow change.
- No adjacent proxy cleanup, public abstraction, dependency, lint configuration,
  or test-runner change.

## Review Classification Rules

- **Blocker-Fix:** Violates an accepted behavior, causes test/CI failure,
  introduces a regression or unsafe lifecycle, weakens strict eval quality, or
  violates repository guardrails.
- **In-scope-Fix:** A valid defect in changed proxy lifecycle code/tests that is
  directly necessary for accepted behavior or maintainability of that bounded
  change.
- **Reject:** Factually incorrect, already covered, asks to weaken the contract,
  or proposes speculative hardening/cleanup.
- **Defer:** Valid but outside the accepted sandbox transport-lifecycle
  behavior, especially workflow/eval redesign or broader credential
  architecture.
