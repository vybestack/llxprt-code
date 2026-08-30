# Plan: Host-owned, cancellable interactive authentication (Issue #2562)

Plan ID: PLAN-20260827-ISSUE2562
Generated: 2026-08-27
Issue: vybestack/llxprt-code#2562 — "Make lazy authentication cancellable and route subagent auth challenges through the interactive host"
Total Phases: 6 (P0.5 preflight + P01–P05 implementation + P06 docs/verify)

## Problem statement (shaped from the issue)

Today, lazy OAuth (triggered when a provider discovers missing/expired credentials mid-operation)
has two defects:

1. **It is not cancellable.** `CodexOAuthProvider.initiateAuth()` owns an internal
   `AbortController` that no external code can reach. Abandoning the browser flow leaves the
   pending promise, callback server, timers, and device polling running; the instance appears
   to hang. There is a silent browser→device-code fallback on failure which must never happen
   as a *side effect of cancellation*.
2. **Subagents impersonate the interactive UI.** When a subagent runtime hits missing/expired
   Codex auth on the generic lazy-auth path (`TokenAccessCoordinator.triggerAuthFlow` →
   `facadeRef.authenticate()`), it runs/prints an interactive flow in its own context and
   errors tell the user to re-authenticate *inside the subagent context*, which may not even
   be visible. The top-level interactive host must own the flow; subagents must wait with a
   visible status and receive a typed terminal outcome.

## Design decisions (bounded scope)

- **One session-level coordinator**, `InteractiveAuthCoordinator`, exported as a singleton
  from `packages/providers/src/auth/interactive-auth-coordinator.ts`, modeled on the existing
  `oauthRuntimeBridge` / `oauthUIBridge` singleton-bridge precedents (in-process DI, settable,
  resettable for tests). The issue text explicitly authorizes introducing this coordinator.
- **Subagents run in-process** under an `AsyncLocalStorage`-scoped runtime registry
  (`getActiveRuntimeKind()` in `packages/providers/src/runtime/runtimeAccessors.ts`). The
  escalation gate keys off that: runtime kind `agent`/`subagent` ⇒ escalate to the host via
  the coordinator; never run interactive auth locally.
- **Host runtimes** route through the coordinator when a host handler is bound (the CLI
  composition root binds one). This is what makes host-triggered lazy auth cancellable via a
  visible action. If no host is bound and the runtime is host-like, the legacy direct path is
  preserved (backward compatibility for tests/embedded callers). If no host is bound and the
  runtime is a subagent/agent, fail fast with a typed, actionable error.
- **Cancellation surface**: `/auth cancel` slash command (new) →
  `interactiveAuthCoordinator.cancelActiveSessions()`. Retry without restart = run
  `/auth codex` (already exists) or send another message. Turn/ESC-level signal threading
  through the whole prompt pipeline is **out of scope** (it would touch every provider call
  path; the coordinator API supports a per-requester `signal` so this can be wired later).
- **Device-code fallback stays** for genuine non-abort failures (deliberate behavior from
  PR #1399). Cancellation/timeout must rethrow the abort reason *before* any fallback — the
  current code already has this guard for the internal signal; tests will pin it for the new
  external signal.
- **Replay safety (#2532)**: the lazy-auth trigger fires during token resolution, i.e. before
  the request/stream starts, so resuming after successful auth cannot replay after observable
  output. We do not modify the retry/commit policy; we assert ordering in tests.
- **Timeout**: new settings registry key `auth.interactiveTimeoutMs` (default `1_200_000` ms,
  matching the provider's 20-minute `AUTH_TIMEOUT_MS`), read through a new
  `getInteractiveAuthTimeoutMs()` accessor on `oauthRuntimeBridge` (implemented in
  `buildOAuthRuntimeAccessors()` from the settings service). Per-request override supported.
  Timeout is a backstop and performs the same teardown as cancel.

## Requirements

### REQ-2562-1: InteractiveAuthCoordinator semantics

**Full text**: The coordinator owns interactive authentication for the session. It accepts
structured challenges, coalesces equivalent concurrent ones, runs one host interaction,
delivers one of four typed terminal outcomes (`succeeded` / `cancelled` / `failed` /
`timed_out`) to every attached waiter exactly once, and tears down all attempt resources
(listeners, timers, polling) on any terminal transition.

**Behavior**:

- GIVEN a bound host handler and two concurrent challenges for the same provider+bucket
  WHEN both call `requestAuth`
  THEN the handler is invoked exactly once (coalescing), the challenge carries
       `{provider, bucket, requester:{runtimeKind, runtimeId?}, reason, correlationId}` and
       contains **no credentials**, and both waiters resolve `succeeded` exactly once.
- GIVEN an active session with waiters
  WHEN `cancelActiveSessions()` is called (host cancel action)
  THEN every waiter settles `cancelled` exactly once, the attempt's `AbortSignal` aborts,
       the session is removed, and the coordinator remains usable (no process/agent death).
- GIVEN a shared session with two waiters
  WHEN one waiter's request `signal` aborts (task cancellation)
  THEN only that waiter settles `cancelled`; the shared attempt stays active for the other;
       when the last waiter detaches with the attempt still pending, the attempt is aborted
       and cleaned up (orphan cleanup).
- GIVEN a session whose lifetime exceeds `timeoutMs` (request override or accessor default)
  WHEN the timer fires
  THEN teardown identical to cancel runs and every waiter settles `timed_out`.
- GIVEN a host handler that rejects with a non-abort error
  THEN every waiter settles `failed` carrying that error, exactly once.
- GIVEN races (cancel vs success, timeout vs cancel, dispose vs success)
  THEN the first terminal transition wins; every waiter settles exactly once; late
       transitions are no-ops; timers/listeners are cleared.
- GIVEN `dispose()` (host shutdown)
  THEN all sessions tear down like cancel and all waiters settle `cancelled` exactly once.
- GIVEN no host handler bound
  WHEN `requestAuth` is called
  THEN it rejects immediately with `InteractiveAuthUnavailableError` (typed, includes an
       actionable message such as "run `/auth codex` from the interactive host session");
       no browser launch, no device polling, no waiting.
- GIVEN a cancelled/failed/timed-out attempt
  THEN existing stored credentials are unchanged (only a *successful* handler completion may
       persist new tokens — handler contract + test).
- GIVEN a terminal outcome other than success
  THEN the provider side does NOT silently switch to device-code flow or reopen the same
       browser flow.

### REQ-2562-2: External cancellation of Codex lazy auth

**Full text**: The visible cancel action must abort provider polling, callback
listeners/servers, timers, and ephemeral auth-session state, without hanging.

**Behavior**:

- GIVEN `OAuthProvider.initiateAuth(signal?: AbortSignal)` (new optional param — backward
       compatible)
  WHEN the signal aborts mid-flow (Codex provider)
  THEN the internal `AbortController` aborts with the external reason; the callback server /
       device polling / pre-browser delays / clipboard waits are aborted through the existing
       `waitForAbort` machinery; the in-flight map entry is cleaned; the returned promise
       rejects with the abort reason (settles — never hangs).
- GIVEN an aborted external signal
  WHEN `performAuth` would fall back to device flow
  THEN the abort is rethrown BEFORE any fallback (`if (signal.aborted) throw signal.reason`
       guard applies to the external signal as well).
- GIVEN `AuthFlowOrchestrator.authenticate(provider, bucket, {signal})` (new optional
       `signal` in options, threaded to `authenticateInternal` → `doInitiateAuth` →
       `provider.initiateAuth(signal)`)
  WHEN the signal aborts
  THEN the auth lock is still released (existing `finally`) and the join-in-flight semantics
       are preserved for callers without a signal.

### REQ-2562-3: Subagent challenges escalate to the host

**Full text**: A subagent that needs authentication enters a visible waiting-for-auth state
and escalates a structured challenge to the host. It must not print user instructions, launch
a browser, start device polling, or block on an interaction local to the subagent.

**Behavior**:

- GIVEN active runtime kind `subagent` (or `agent`) registered via the runtime registry
  WHEN the lazy-auth trigger fires (`TokenAccessCoordinator.triggerAuthFlow`)
  THEN the local interactive flow is NOT started in the subagent context; instead a
       structured challenge goes to `interactiveAuthCoordinator.requestAuth` with
       `requester.runtimeKind` set, and the trigger awaits the terminal outcome.
- GIVEN an escalated challenge and a bound host
  THEN exactly one host interaction runs (the host handler calls
       `oauthManager.authenticate(challenge.provider, challenge.bucket, {signal})` with the
       session signal) and on success the subagent's pending token resolution resumes by
       re-reading stored credentials (existing post-auth path) BEFORE the request stream
       starts (no post-output replay).
- GIVEN an escalated challenge and a non-success outcome
  THEN the trigger throws a typed `InteractiveAuthError` (`cancelled` / `timed_out` /
       `failed` variants) whose message does NOT instruct the user to authenticate inside the
       subagent context.
- GIVEN runtime kind `subagent`/`agent` and NO host bound
  THEN the trigger fails fast with `InteractiveAuthUnavailableError`; it never opens a
       hidden prompt and never waits indefinitely.
- GIVEN host-like runtimes (`cli-interactive`, `cli-bootstrap`, unregistered)
  WHEN a host handler is bound
  THEN the trigger routes through the coordinator (making host lazy auth cancellable);
       when no host is bound, the legacy direct path runs (backward compatibility).
- GIVEN the `AllBucketsExhaustedError` re-auth hint suffix in
       `packages/providers/src/errors.ts`
       ("Please re-authenticate… The auth dialog will open on your next message.")
  WHEN built while running under a subagent/agent runtime
  THEN the suffix must not tell the user to act inside the subagent context (runtime-aware
       wording pointing at the interactive host).
- GIVEN an escalated waiting subagent
  THEN a waiting-for-auth state event reaches the host UI (visibility requirement; see
       REQ-2562-4) and the subagent transcript contains no auth instructions.

### REQ-2562-4: Host binding, visibility, and cancel affordance

**Full text**: Only the top-level interactive host owns authentication UI; the host should
offer explicit cancel and retry.

**Behavior**:

- GIVEN the interactive CLI composition root (where `oauthRuntimeBridge` accessors are
       registered for the interactive session)
  THEN a host handler is bound to the coordinator that runs the OAuth manager flow with the
       session signal, and it is unbound on teardown.
- GIVEN an active coordinator session
  THEN the host UI shows a waiting-for-auth notice (new `oauth_waiting` OAuthUIEvent carried
       through the existing `oauthUIBridge`; CLI `useUpdateAndOAuthBridges`/event formatter
       maps it to visible text naming provider/bucket and the requesting runtime, e.g.
       "waiting for codex/work auth (requested by subagent)"). No credentials in the event.
- GIVEN `/auth cancel`
  WHEN active interactive sessions exist
  THEN they are cancelled (all waiters settle `cancelled`), a confirmation is shown, and
       they can be retried via `/auth codex` without restarting; when none exist, an
       informative "no active authentication" message is shown.
- GIVEN the settings registry
  THEN key `auth.interactiveTimeoutMs` exists (number, default 1_200_000, described as the
       finite lifetime/backstop for interactive auth sessions), read through
       `oauthRuntimeBridge.getInteractiveAuthTimeoutMs()` implemented in
       `buildOAuthRuntimeAccessors()`.

### REQ-2562-5: Ownership and state-transition contract documented

**Full text**: The ownership and state-transition contract is documented for host,
orchestrator, subagent, provider, and UI layers.

**Behavior**: a durable doc under `dev-docs/` (e.g. `dev-docs/auth-coordination.md`)
describing: the coordinator state machine
(`idle → waiting(waiters) → settling(succeeded|cancelled|failed|timed_out) → cleaned`),
who owns UI/selection/cancellation/completion (host), what each layer may and may not do
(subagent: no UI/no polling, escalate and wait; provider: honor external signal, no fallback
on abort; orchestrator: thread signal; UI: display waiting state, offer cancel/retry), and
the exactly-once settlement rules.

## Out of scope (explicitly)

- Browser-profile/account association (#1045) — including "select another bucket/account"
  pickers; the host may retry with `/auth codex <bucket>` manually.
- Cross-process coordination of the coordinator itself (#1652 handled same-process
  single-flight via locks; the coordinator is per-process).
- Threading the turn AbortSignal (ESC) through the entire prompt pipeline to the auth
  trigger (coordinator API accepts per-request signals for future wiring).
- Changes to the retry/commit policy or replay semantics (#2532) — ordering asserted only.
- Non-Codex OAuth providers' internal flows (the `signal` param is additive on the interface;
  only Codex wires it internally).

## Test plan (TDD; bun tests, behavioral — no mock theater)

All new tests are `bun:test` TS files following existing conventions
(`*.spec.ts` / `__tests__/*.test.ts` in `packages/providers`, `packages/cli`), with
`@plan PLAN-20260827-ISSUE2562.Pxx` / `@requirement REQ-2562-x` markers, Apache-2.0 header,
current-year copyright. Real fakes per repo rules (recording handlers, deferred promises,
`AbortController`s — no pointless jest-style mock objects).

1. **Coordinator core** (`packages/providers/src/auth/__tests__/interactive-auth-coordinator.spec.ts`):
   success delivers exactly once to all waiters; coalescing (one handler invocation for N
   equivalent requests, distinct correlationIds per waiter); host cancel settles all
   `cancelled` and coordinator reusable; cancel/success race — first wins, second no-op,
   exactly-once; timeout → `timed_out` + timer cleared + signal aborted + teardown == cancel;
   provider failure → `failed` with error for all; waiter detach keeps shared attempt for
   other waiter; last-waiter detach aborts orphan; dispose → all `cancelled` once; no host →
   immediate typed `InteractiveAuthUnavailableError`, handler never invoked; credentials
   untouched on non-success outcomes (handler-contract recording store).
2. **Provider cancellation** (`packages/providers/src/auth/__tests__/codex-oauth-provider.external-cancel.spec.ts`,
   following existing hermetic patterns in `codex-oauth-provider.spec.ts` for stubbing the
   device/callback layer): external signal abort → internal controller aborts → pending
   `initiateAuth` rejects with abort reason; in-flight bucket map cleaned (retry works);
   abort-before-fallback guard (external abort during browser phase never reaches device
   flow); signal already aborted at entry → immediate rejection, no browser, no server.
3. **Orchestrator threading** (`packages/providers/src/auth/__tests__/auth-flow-orchestrator.signal.spec.ts`):
   `authenticate(provider, bucket, {signal})` passes signal to `provider.initiateAuth`;
   lock released on abort; signal-less callers unchanged.
4. **Escalation gate** (`packages/providers/src/auth/__tests__/token-access-coordinator.escalation.spec.ts`,
   using runtimeRegistry helpers from `issue2891-lazy-oauth-gating.test.ts`):
   subagent runtime + bound host → coordinator used, local `authenticate` not called from the
   subagent path, host handler invoked once with structured challenge (no credentials),
   waiter resumes after success and re-reads token before stream; subagent + no host →
   `InteractiveAuthUnavailableError` fail fast, no local flow; cancel outcome → typed
   `InteractiveAuthCancelledError` with host-pointing message; host runtime + bound host →
   routed via coordinator; host runtime + no host → legacy direct path intact; errors.ts
   suffix runtime-awareness (subagent context never told "dialog will open on next message").
5. **Settings + accessor** (extend `runtime-accessor-bridge.spec.ts` + settings registry
   patterns): `getInteractiveAuthTimeoutMs()` returns setting value; default 1_200_000 when
   unset; registry entry present/described.
6. **CLI surfaces** (`packages/cli/src/ui/commands/authCommand.cancel.test.ts` +
   oauth-waiting UI mapping test following `useUpdateAndOAuthBridges` test patterns):
   `/auth cancel` cancels active sessions (fake coordinator state) / no-op message when
   none; `oauth_waiting` event renders visible waiting text including requester; host
   binding/unbinding on setup/teardown.
7. **Regression preservation**: existing
   `oauth-manager.auth-lock-cancellation.behavioral.spec.ts`,
   `codex-oauth-provider.spec.ts`, `issue2891-lazy-oauth-gating.test.ts`,
   `error-reauth.spec.ts`, `authCommand.test.ts` must stay green (adjust only where behavior
   intentionally changed: error wording under subagent runtimes).

## Phases

- **P0.5 Preflight** — verify assumed types/call paths (`OAuthProvider.initiateAuth`
  signature, `AuthFlowOrchestrator.authenticate` options shape, runtimeRegistry helpers,
  `oauthUIBridge` event union, settings registry entry pattern, `/auth` command structure,
  `buildOAuthRuntimeAccessors` location). Record evidence in this plan file.
- **P01 Coordinator** — REQ-2562-1 + test file 1. Pure addition; no call-site changes yet.
- **P02 Provider cancellation** — REQ-2562-2 + tests 2–3. Additive optional params.
- **P03 Accessors/settings** — REQ-2562-4 (timeout part) + test 5.
- **P04 Escalation gate + error wording** — REQ-2562-3 + test 4 (the core routing change).
- **P05 Host binding + UI + `/auth cancel`** — REQ-2562-4 (remainder) + test 6.
- **P06 Docs + full verification** — REQ-2562-5, `dev-docs/auth-coordination.md`, then the
  full verification cycle (`npm run test`, `lint`, `typecheck`, `format`, `build`, and the
  `bun scripts/start.ts --profile-load stepfun-37` smoke).

## Success criteria

- Every REQ behavior above has a passing behavioral test.
- All pre-existing suites touched by this work stay green (full `npm run test`).
- Verification cycle green; OCR ≤ 2 rounds; findings triaged Blocker-Fix / In-scope-Fix /
  Reject / Defer with all Blocker-Fix and In-scope-Fix resolved before PR.
- PR title/body reference `Fixes #2562`.

## Execution tracker (updated 2026-08-27)

| Phase | Status | Notes |
|-------|--------|-------|
| P0.5 | done | assumptions verified during research |
| P01 coordinator | done | 15/15 incl. re-entrant-cancel exactly-once test |
| P02 provider/orchestrator signal | done | 5/5 + 11/11 signal spec incl. orphan-flight-abort, lock-release-on-abort, refresh rollback |
| P03 timeout setting/accessor | done | `auth.interactiveTimeoutMs` default 1,200,000 |
| P04 escalation gate + error wording | done | 22/22 escalation spec; runtime-aware re-auth suffix |
| P05 host binding + UI + `/auth cancel` | done | hook bind/unbind with latest-ref pattern + rerender test; schema order preserved for unlock test |
| P06 docs | done | dev-docs/auth-coordination.md |

Reviews: deepthinker round 1 FAIL → remediated (host scope, teardown, per-waiter settle,
rollback, /auth cancel guidance). Round 2 FAIL (B1–B4, I1–I3) → all remediated directly:
B1 coordinator notification re-entrancy (+test), B2 lock-wait/refresh abort checks (+tests),
B3 flight participant semantics in orchestrator and codex provider (sole-participant instant
abort; releaseFlightParticipant also deletes the flight-map entry so retries start a fresh
flight) (+tests), B4 hook latest-ref (+rerender test), I1 deterministic retry tests
(waitForAuthLockRelease helper; provider name 'recording'), I2 rerender test, I3 docs
shared-flight ownership. Review cap reached (2/2); no further review rounds per policy.

Honored rejects (scope): turn/ESC signal threading through the whole prompt pipeline;
signal wiring for non-Codex OAuth providers; cross-process coordinator coordination.

Verification: post-round-1 cycle all green; round-2 cycle in progress (targeted batteries
83 + 74 + hook green; lint/typecheck/full-suite/build/smoke on final head pending in
`tmp/verify2562/`).

## OCR round 1 triage (2026-08-27, 8 findings)

| ID | Severity | Finding | Disposition |
|----|----------|---------|-------------|
| F4 | bug/high | Creator `finally` cleared shared flight timeout while other participants still awaited → unbounded hang | **Blocker-Fix**: `clearTimeout` moved into `wireAuthFlightSettlement` (flight lifetime) |
| F5 | bug/medium | `awaitAuthFlight` (codex provider) never removed caller-signal abort listener after normal settlement | **In-scope-Fix**: single captured listener + `finally removeEventListener` |
| F8 | bug/medium | Twin listener leak in `awaitFlightAsParticipant` (orchestrator) | **In-scope-Fix**: same pattern |
| F7 | maint/medium | `'unregistered'` sentinel undeclared in challenge contract | **In-scope-Fix**: `InteractiveAuthRequesterKind = RuntimeKind \| 'unregistered'` declared in coordinator |
| F2 | bug/low | `cli-bootstrap` wrongly promised "auth dialog will open on your next message" | **In-scope-Fix**: added to host-session wording branch in `buildReauthenticateSuffix` |
| F3 | test/low | Missing coverage: host handler failure branches → `'failed'` outcome | **In-scope-Fix**: two behavioral tests (throwing getter at challenge time; non-conforming manager) |
| F1 | maint/low | `/auth` command name hardcoded in providers error message; share constant with CLI | **Reject**: providers→CLI constant import inverts package layering for a single user-facing string |
| F6 | perf/low | Extra `tokenStore.getToken()` read to derive `challengeReason` before `performDiskCheck` | **Defer**: perf-only; restructuring the disk-check authority path late in the cycle outweighs one in-memory keyring read |

Post-fix gates: typecheck EXIT=0; hook suite 7/7; targeted battery (coordinator/ui/escalation/signal/external-cancel/error-reauth) green; lint + full cycle re-run on frozen tree (logs: tmp/verify2562/lint6.log, full-test7.log, build4.log, smoke3.log).
