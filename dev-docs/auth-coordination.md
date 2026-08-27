# Interactive Authentication Coordination

Ownership and state-transition contract for host-owned interactive
authentication, introduced for issue #2562 (plan
`PLAN-20260827-ISSUE2562`). This document is the reference for how the
layers cooperate when authentication is required mid-operation, whether the
request came from the top-level interactive host or from a subagent.

Audience: contributors modifying the OAuth managers, provider runtimes,
subagent orchestration, or the CLI auth surfaces.

## Problem this solves

Before this contract, lazy OAuth had two failure modes:

- **It could not be cancelled.** `CodexOAuthProvider.initiateAuth()` owned an
  internal `AbortController` that no external code could reach. Abandoning a
  browser flow left the pending promise, callback server, timers, and device
  polling running, so the instance appeared to hang. Recovery required
  killing the process.
- **Subagents impersonated the interactive UI.** A subagent that discovered
  missing or expired credentials ran or printed an interactive flow inside
  its own context and told the user to re-authenticate there, even though the
  subagent context is not the interactive owner and may not be visible.

## Ownership rules

| Layer                                                                                        | Owns                                                                                                              | Must not                                                                                                                                    |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Interactive host (CLI)                                                                       | Auth UI for lazy interactive auth, browser/device-flow selection, cancellation (`/auth cancel`), completion                                 | Run *lazy* interactive auth outside the coordinator once a host handler is bound. The manual `/auth <provider>` command intentionally calls `OAuthManager.authenticate` directly: it is itself a user-directed interactive action, and it participates in cancellation through the shared-flight rules below.                                                                         |
| `InteractiveAuthCoordinator` (`packages/providers/src/auth/interactive-auth-coordinator.ts`) | Session state machine, waiter set, coalescing, terminal-outcome delivery, teardown                                | Persist credentials, render UI directly (it only emits events), interpret provider internals                                                |
| Orchestrator (`AuthFlowOrchestrator`, `OAuthManager`)                                        | Auth/refresh locking, single-flight joins, threading the session `AbortSignal` to `provider.initiateAuth(signal)` | Fall back from browser auth to device auth as a side effect of cancellation                                                                 |
| Subagent / agent runtime                                                                     | Detecting the auth requirement, escalating a structured challenge, waiting for the terminal outcome               | Print auth instructions, launch a browser, start device polling, or block on a local interaction                                            |
| Provider (`CodexOAuthProvider` et al.)                                                       | The actual flow; honoring the external `AbortSignal` with full teardown of servers, polling, and timers           | Ignore an aborted signal or treat a late completion as a new terminal transition. Provider completion after settlement is an ignored no-op. |
| UI (`useUpdateAndOAuthBridges`, `providerCommand` formatter)                                 | Rendering `oauth_waiting` / `oauth_settled` events, offering cancel/retry                                         | Assume it is the sole owner of credential state                                                                                             |

## State machine

One coordinator session per `provider::bucket` pair:

```
idle ──requestAuth──▶ waiting(waiters) ──terminal──▶ settling ──▶ cleaned
                          │
                          ├─ handler resolves      → 'succeeded'
                          ├─ host cancel / dispose → 'cancelled'
                          ├─ waiter-detach (last)  → aborted attempt, session removed
                          ├─ timeout fired         → 'timed_out'
                          └─ handler rejects       → 'failed' (error attached)
```

Terminal outcomes are delivered to every attached waiter **exactly once**.
The first terminal transition wins; later transitions are no-ops. Waiters
that arrive after a session settled start a new session.

## Challenge and outcome shapes

A challenge carries no credentials:

```ts
interface InteractiveAuthChallenge {
  readonly provider: string;
  readonly bucket: string;
  readonly requester: {
    readonly runtimeKind: string; // 'cli-interactive' | 'agent' | 'subagent' | ...
    readonly runtimeId?: string;
    readonly taskId?: string;
  };
  readonly reason: 'authentication-required' | 'reauthentication-required';
  readonly correlationId: string;
}
```

`authentication-required` means no credential was stored before escalation.
`reauthentication-required` means a stored credential was expired or invalid
and could not be refreshed.

Outcomes are `'succeeded' | 'cancelled' | 'failed' | 'timed_out'`, each
carrying the waiter's `correlationId`; `'failed'` attaches the underlying
error. Typed errors (`InteractiveAuthError` and subtypes
`InteractiveAuthUnavailableError`, `InteractiveAuthCancelledError`) carry the
outcome kind so callers can recover without string matching.

## Routing rules

`TokenAccessCoordinator.triggerAuthFlow` decides the route from
`getActiveRuntimeKind()` (from the `AsyncLocalStorage`-scoped runtime
registry):

- Runtime kind `agent` or `subagent`: **always** escalate via
  `interactiveAuthCoordinator.requestAuth`. If no host handler is bound,
  `requestAuth` fails fast with `InteractiveAuthUnavailableError` — the
  runtime never opens a hidden prompt and never waits indefinitely.
- Host-like runtimes (interactive CLI, bootstrap, unregistered): route via
  the coordinator when a host handler is bound (this is what makes
  host-triggered lazy auth cancellable); otherwise the legacy direct path
  applies (backward compatibility for embedded callers and tests).

On `'succeeded'`, the trigger re-reads stored credentials through the
existing post-auth path before the request stream starts, so successful
authentication resumes the blocked caller without replaying observable
output (the lazy trigger fires during token resolution, pre-stream).

## Cancellation and teardown parity

The same deterministic teardown path serves success, host failure, host
cancel, waiter-detach orphaning, timeout expiry, and host shutdown. CLI host
unmount calls `cancelActiveSessions()` before `unbindHost()`; coordinator
`dispose()` follows the same cancellation path.

- abort the session's `AbortSignal`, including after success or failure, which
  releases provider listeners, callback servers, device polling, timers, and
  clipboard waits;
- clear the session timer;
- deliver the terminal outcome to each waiter exactly once;
- remove the session.

Cancelling one waiter (via the request's `signal`) detaches **only** that
waiter; a shared attempt stays alive while other waiters remain, and the
last detach aborts the orphaned attempt. Existing stored credentials change
only when replacement authentication succeeds. An aborted flow must never
silently switch from browser auth to device-code auth; the provider rethrows
the abort reason before any fallback (device fallback remains only for
genuine non-abort failures). A cancelled attempt is retryable without
restarting LLxprt (`/auth <provider>`).

The orchestrator defines the cancellation-versus-credential-commit boundary
while holding the provider/bucket auth lock. It snapshots the prior token,
checks the session signal before persistence, and checks it again after
`saveToken` returns. If cancellation arrives during persistence, the
orchestrator restores the prior token or removes the newly written token when
none existed, then propagates the abort reason. OAuth enablement occurs only
after this post-save check, so a cancelled outcome cannot expose replacement
credentials or enable OAuth as a success side effect. The same boundary
applies to the pre-browser refresh path: an aborted caller never commits a
refreshed token, and cancellation is checked at orchestration entry, after
the auth-lock wait, before the refresh call, and around the refresh save.
The auth-lock and refresh-lock waits are bounded but not signal-aware; the
signal is honored immediately after each wait returns.

### Shared-flight cancellation ownership

Both `AuthFlowOrchestrator.authenticate` (per `provider:bucket`) and
`CodexOAuthProvider.initiateAuth` (per bucket) run same-process single
flights with **participant-counted cancellation ownership**:

- Every caller is a participant. Callers that pass an `AbortSignal`
  (coordinator sessions) may detach: their own abort rejects only their own
  await with their own abort reason.
- Signal-less callers (notably the manual `/auth <provider>` command) cannot
  detach and keep the shared attempt alive.
- The underlying flow runs on a flight-owned `AbortController`. It is aborted
  only when the last live participant leaves while the attempt is still
  running — a detached caller never kills a flow other participants still
  need, and an orphaned attempt (no live participants) is always aborted.
- When the flow is aborted because the last participant departed, the
  departing participant's abort reason is used, so cancellation reasons stay
  stable across the coordinator, orchestrator, and provider.

This is how a host-owned lazy challenge and a concurrent manual `/auth` flow
for the same bucket coexist: cancelling the coordinator session settles its
waiters while the manual flow, if present, keeps the shared attempt alive and
may still complete it on the user's behalf.

## Timeout

Setting `auth.interactiveTimeoutMs` (number, default `1_200_000` ms, matching
the provider's 20-minute `AUTH_TIMEOUT_MS`) bounds every interactive session.
Expiry performs cancel-identical teardown and settles waiters as
`timed_out`. The timeout is a backstop, not a substitute for the visible
cancel action.

## Visibility

The coordinator emits credential-free `oauth_waiting` and `oauth_settled`
events through the existing `oauthUIBridge`, which the CLI renders as visible
status lines naming the provider, bucket, and requesting runtime. Each waiter
receives a settled event with its own correlation ID and delivered outcome, so
a detached waiter reports `cancelled` even if a coalesced waiter later reports
`succeeded`. `getActiveSessions()` backs the `/auth cancel` affordance.

## Key source locations

- Coordinator and singleton: `packages/providers/src/auth/interactive-auth-coordinator.ts`
- Escalation gate: `packages/providers/src/auth/token-access-coordinator.ts` (`triggerAuthFlow`)
- Signal plumbing: `packages/providers/src/auth/types.ts`,
  `packages/providers/src/auth/auth-flow-orchestrator.ts`,
  `packages/providers/src/auth/oauth-manager.ts`,
  `packages/providers/src/auth/codex-oauth-provider.ts`
- Runtime kind detection: `packages/providers/src/runtime/active-runtime-identity.ts`,
  `packages/providers/src/runtime/runtimeAccessors.ts`
- Host binding and UI mapping:
  `packages/cli/src/ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.ts`,
  `packages/cli/src/ui/commands/providerCommand.ts`
- Cancel affordance: `packages/cli/src/ui/commands/authCommand.ts` (`/auth cancel`)
- Timeout setting: `packages/settings/src/settings/registry/registry-entries-2.ts`
  (`auth.interactiveTimeoutMs`)
- Event union: `packages/auth/src/oauth-ui-events.ts`

## Behavioral tests

- `packages/providers/src/auth/__tests__/interactive-auth-coordinator.spec.ts`
  — coordinator semantics (coalescing, cancel/success races, timeout,
  detachment, orphan cleanup, dispose, fail-fast, exactly-once)
- `packages/providers/src/auth/__tests__/interactive-auth-coordinator.ui.spec.ts`
  — UI event emission, credential-free payloads
- `packages/providers/src/auth/__tests__/token-access-coordinator.escalation.spec.ts`
  — routing, escalation, fail-fast, ordering (no post-output replay)
- `packages/providers/src/auth/__tests__/codex-oauth-provider.external-cancel.spec.ts`
  — provider teardown on abort, no device fallback on cancel
- `packages/providers/src/auth/__tests__/auth-flow-orchestrator.signal.spec.ts`
  — signal threading, lock release on abort
- `packages/cli/src/ui/commands/authCommand.cancel.test.ts`,
  `packages/cli/src/ui/containers/AppContainer/hooks/useUpdateAndOAuthBridges.test.ts`
  — cancel affordance and host binding/UI mapping
