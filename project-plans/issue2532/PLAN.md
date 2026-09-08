# Plan: Unify streaming retry, recovery, and failover under one committed request budget (issue #2532)

Plan ID: PLAN-20260826-ISSUE2532
Generated: 2026-08-26
Issue: vybestack/llxprt-code#2532
Label: Code Quality / Modularization

## Problem statement

LLxprt currently recovers from provider failures through several independently
composed paths that each maintain their own notion of "may I retry?":

- `RetryOrchestrator` (central retry, backoff, first-chunk timeout, auth
  recovery, bucket rotation) guards post-yield replay through a WeakSet mark
  (`markErrorAfterStreamOutput`) applied in two private stream wrappers
  (`yieldStreamUnprotected`, `streamWithTimeout`).
- `LoadBalancingProvider` guards post-yield failover through a local
  `chunksYielded` boolean and its own timeout wrapper
  (`loadBalancing/streamTimeout.ts` `wrapWithTimeout`).
- `packages/providers/src/retryStreamTimeout.ts` is an extracted copy of the
  orchestrator's two wrappers that nothing imports (dead duplicate).
- Error classification vocabulary is split across `classifyRetryError`,
  `classifyProviderError`, `shouldRetryError`, `shouldFailover`,
  `isImmediateFailoverError`, `permitsLoadBalancerFailover`,
  `isTimeoutError`, with no shared taxonomy.
- `AnthropicStreamProcessor` never verifies a terminal event: an SSE stream
  that ends without `message_stop` (truncation) is committed as a successful
  turn.

Much of the budget/terminal-marking groundwork already landed via issues
#2917 (two-layer attempt accounting), #2450 (aggregate LB retryability),
#2559, and #3048 (partial-output boundary fence). This issue completes the
unification: one taxonomy, one request-scoped commit state, one guarded-stream
primitive, adapter-owned decoding, terminal-event validation, budget-aware
telemetry, and an architecture doc.

## Current-state inventory (verified on main @ ece3d796e)

Exists and must be preserved:

- `TransportAttemptBudget` (packages/providers/src/transportAttemptBudget.ts):
  aggregate attempt counter shared through
  `options.metadata._retryRequestContext` across orchestrator, LB, and
  providers; LB declares `transportAttemptOwnership = 'provider'`.
- Post-yield WeakSet marking (`retryErrorClassification.ts`) in both
  orchestrator wrappers; LB `chunksYielded` guard in
  `loadBalancing/failoverErrorHandler.ts`.
- Anthropic SDK client uses `maxRetries: 0`; OpenAI factory `maxRetries: 0`;
  openai-vercel passes `retries` ephemeral (default 2) into the AI SDK.
- In-band Anthropic errors (HTTP 200 + SSE `event: error`, including
  `overloaded_error`) surface as thrown errors from the SDK stream iterator
  and are classified retryable via `isOverloadError` (nested SDK shape).
- Retry-After normalization with 5-minute cap (`retryDelayPolicy.ts`).
- The agents-layer turn restart asymmetry pinned by
  `RetryOrchestrator.partialOutputBoundary.bun.test.ts`: post-output errors
  are terminal in providers but NOT in agents. This asymmetry is load-bearing
  for issue #3048 and must not change.

Missing (the work of this issue):

1. No documented failure taxonomy
   (phase/kind/status/retryAfterMs/providerCode/exposure/terminalSeen).
2. No positive request-scoped `committed` flag set before every outward
   event; commitment is inferred per-layer from local booleans or from an
   error mark applied after failure.
3. Three guarded-stream implementations (two live in RetryOrchestrator, one
   in loadBalancing/streamTimeout.ts) plus one dead duplicate
   (retryStreamTimeout.ts).
4. No terminal-event validation: truncated/malformed Anthropic streams are
   committed as successful turns.
5. Auth recovery never runs after exposure (terminal errors skip the auth
   handler entirely; the issue allows repair for future requests without
   replaying this one).
6. Retry telemetry does not report taxonomy/budget/commitment.
7. No architecture doc assigning decoding vs recovery ownership.

## Acceptance criteria

Each criterion is stated as behavior with a test that proves it. AC IDs are
referenced by plan markers as REQ-2532-ACnn.

### AC-01 — One documented taxonomy
A shared module under `packages/providers/src/` exports the taxonomy types:

```ts
type RetryFailurePhase =
  'connect' | 'headers' | 'stream' | 'protocol' | 'auth' | 'tool' | 'cancellation';
type RetryFailureKind =
  'timeout' | 'network' | 'rate_limit' | 'overload' | 'server' | 'auth' |
  'payment' | 'malformed' | 'truncated' | 'invalid_request' | 'cancelled' | 'unknown';
type StreamExposure = 'none' | 'metadata' | 'content' | 'tool_call';

interface RetryFailure {
  phase: RetryFailurePhase;
  kind: RetryFailureKind;
  status?: number;
  retryAfterMs?: number;
  providerCode?: string;
  cause: unknown;
}
```

A decode function maps any thrown error into `RetryFailure` using the
existing classification helpers (single source of truth; existing helpers may
delegate to it). Mapping table (test-pinned):

- HTTP 429 or `overloaded_error`/`rate_limit_error` body type → kind
  `rate_limit` (overloaded_error may decode to `overload`; both remain
  retryable pre-exposure)
- `api_error` body type or 5xx status → `server`
- 401/403 → `auth`; 402 → `payment`; 400/404/422 → `invalid_request`
- network transients (existing `isNetworkTransientError`) → `network`
- first-chunk/stream timeout errors → `timeout`
- AbortError/cancellation → `cancelled`
- missing terminal event → `truncated`; structurally invalid protocol event
  → `malformed`
- everything else → `unknown`

### AC-02 — Request-scoped commit state
A commit state object rides the existing `_retryRequestContext` metadata
context alongside the transport budget:

- `committed: boolean` — irreversible; set immediately BEFORE any IContent is
  yielded outward (metadata, text, thinking, or tool output all count).
- `exposure: StreamExposure` — the strongest exposure level that has escaped
  ('none' → 'metadata' → 'content' → 'tool_call').
- `terminalSeen: boolean` — set by adapters that can observe a terminal
  protocol event.

Any wrapper layer (orchestrator guarded stream, LB backend attempt) sets it
before yielding; all recovery decision points consult it. Setting it is
idempotent and monotonic.

### AC-03 — One guarded-stream primitive
A single module owns exposure marking + iterator cleanup for both normal and
timeout streams. `RetryOrchestrator.streamWithTimeout` and
`yieldStreamUnprotected` collapse onto it; the LB `wrapWithTimeout` path
delegates to it (preserving `RequestTimeoutError` observability used by LB
metrics). The dead duplicate `retryStreamTimeout.ts` is removed. Behavior:

- before each outward yield: mark committed + exposure on the request context
- on failure after any yield: mark the error terminal (existing WeakSet mark
  preserved for the agents-layer asymmetry) and rethrow
- first-chunk timeout (when configured): race only the first `next()`, on
  timeout abort the attempt controller and CLOSE the losing iterator
  (existing `closeIteratorBeforeContinuing`), throw a decoded `timeout`
  failure that stays retryable (no exposure yet)
- on any incomplete path: abort + close the iterator in `finally`
- return whether any content was produced (for empty-stream exhaustion)

### AC-04 — Commitment gates every recovery decision
After `committed === true` for a request:

- RetryOrchestrator: no retry, no bucket rotation (`tryFailover` not called),
  error is thrown terminal.
- Auth recovery: an auth-kind failure after commitment MAY invoke the auth
  error handler once (prepares future requests — token refresh/cache
  invalidation) but MUST NOT replay this request.
- LoadBalancingProvider: no same-backend retry and no advance to the next
  backend; the failure surfaces immediately.
- Metadata alone counts: a stream that yielded only usage metadata and then
  failed is committed (no replay).

### AC-05 — Pre-exposure recovery preserved
Before any outward event:

- Transient network, 429, 5xx, Anthropic in-band overload (HTTP 200 + SSE
  error event incl. `overloaded_error`), timeout, truncated, and malformed
  failures remain retryable inside the shared budget.
- Retry-After is normalized (existing cap) and delays count against the same
  request budget (attempt counters, not wall-clock, bound the budget).
- Anthropic owns no unbudgeted network replay loop (already true; pin with a
  test that a mid-stream network failure inside the Anthropic transport
  results in exactly one SDK call per orchestrator attempt).

### AC-06 — Terminal-event validation (Anthropic adapter)
`AnthropicStreamProcessor`:

- records `message_stop` and sets `terminalSeen` on the request state when
  observable
- on stream EOF without a terminal event, throws a decoded `truncated`
  failure (never completes as a successful turn)
- on a structurally invalid event (deterministic violations only — e.g.
  `input_json_delta` arriving with no open `tool_use` block), throws a
  decoded `malformed` failure
- tool pairing/deduplication and thinking-block identity semantics are
  unchanged (existing tests continue to pass)

Note: non-streaming (`parseAnthropicResponse`) receives complete messages and
needs no terminal validation.

### AC-07 — Budget telemetry
Attempt lifecycle notifications (the `AttemptLifecycleObserver` seam used by
telemetry) carry, without secrets: failure `kind` and `phase` (from AC-01),
`committed` + `exposure` (AC-02), and budget used/limit. Existing
AttemptEndInfo fields keep their shape (additive optional fields only).

### AC-08 — Architecture documentation
A durable doc under `dev-docs/providers/` (e.g.
`retry-recovery-architecture.md`) assigns ownership:

- adapters (Anthropic et al.) DECODE provider errors into the taxonomy and
  observe terminal events; they never decide retries
- the guarded stream owns commitment and cleanup
- RetryOrchestrator owns recovery policy (retry/backoff/auth/bucket) under
  the aggregate budget
- LoadBalancingProvider owns target selection/failover under the same budget
  and commit state
- SDK-level retries are documented against the budget: Anthropic/OpenAI
  clients run `maxRetries: 0`; openai-vercel forwards the `retries` ephemeral
  (default 2) into the AI SDK, which is counted as provider-owned transport
  attempts (verify and document; adjust the default only if unaccounted)

### AC-09 — Regressions retained
OAuth (incl. cross-process token recovery), credential buckets, load
balancing, cancellation, history integrity, tool pairing, headless mode all
keep working — proven by the existing suites passing unchanged (except where
a test encoded the old duplicated behavior being unified).

## Out of scope (explicitly)

- Changing the agents-layer turn-restart semantics (issue #3048) or
  `packages/core/src/utils/retry.ts` retryWithBackoff policy.
- Removing or weakening any existing retry capability.
- New public API beyond the providers package internals + additive optional
  telemetry fields.
- Refactors of providers not in the file catalog (gemini, chutes, kimi, zai
  adapters) — they keep working through the orchestrator unchanged.
- UI changes.

## Test plan (characterization, TDD; all bun tests)

New files (providers `__tests__` / `anthropic`):

1. `__tests__/retryFailureTaxonomy.test.ts` — decode mapping table (AC-01):
   429/overload/rate_limit_error/api_error/5xx/401/403/402/400/network/
   timeout/abort/truncated/malformed/unknown → expected kind+phase; Retry-After
   extraction; providerCode passthrough.
2. `__tests__/requestCommitState.test.ts` (or fold into 1) — commit state:
   set-before-yield monotonic exposure; irreversible; shared through nested
   wrappers via metadata context (AC-02).
3. `__tests__/guardedStream.behavior.test.ts` — one primitive (AC-03):
   - normal stream: passes chunks through, marks committed
   - failure after yield: error marked terminal, no retry upstream, iterator
     closed
   - failure before yield: unmarked, retryable, iterator closed
   - first-chunk timeout: losing iterator `return()` invoked + controller
     aborted; retryable
   - cancellation during first-chunk race: AbortError surfaces, iterator
     closed
4. `__tests__/RetryOrchestrator.commitBoundary.bun.test.ts` (AC-04/AC-05):
   - timeout-enabled partial text then network/429/5xx/in-band overload →
     exactly one transport call, original error surfaces
   - metadata-only then failure → no replay
   - auth failure after commitment → auth handler invoked at most once, no
     replay
   - first-chunk timeout before output → retries within budget
5. `anthropic/AnthropicStreamProcessor.terminalValidation.test.ts` (AC-06):
   - usage metadata (message_start) then error/reset → committed, no replay
     (compose with orchestrator or pin processor yield order + commit state)
   - HTTP-200 in-band `overloaded_error` before output → retried by
     orchestrator (composed test); after metadata → no replay; after text →
     no replay
   - EOF without `message_stop` → truncated failure thrown; composed: not a
     successful turn; pre-exposure → retryable
   - malformed event (input_json_delta with no open tool block) → malformed
     failure
   - partial thinking/tool assembly then failure → no replay; tool ids not
     duplicated on any later turn-level restart (pairing preserved)
6. `__tests__/LoadBalancingProvider.commitBoundary.test.ts` (AC-04):
   - failover strategy: partial text from backend A then ordinary network
     error / 5xx / aggregate all-backend failure → no same-backend retry, no
     backend B invocation, error surfaces
   - budget exhaustion mid-rotation → aggregate failure (existing behavior
     retained)
7. Extend `__tests__/attemptLifecycle.*.test.ts` (AC-07): onAttemptEnd
   carries kind/phase/committed/exposure/budget for error attempts; no
   secrets (message sanitization path unchanged).
8. Doc check is manual review (AC-08).

Existing suites that must stay green (regression net): RetryOrchestrator.*,
LoadBalancingProvider.*, anthropic/**, retryInfrastructure.behavior,
retryBoundary.integration, forbidden-composed (two-layer budget), OAuth
(error-reauth.spec, auth/**), headless, cancellation-related suites.

## Implementation phases

Phase 0.5 — Preflight: verify every assumption above on the branch head
(dead-file check for retryStreamTimeout.ts, SDK stream error behavior,
test-utils available: createProviderCallOptions, loadBalancerTestHelpers).

Phase 1 — Taxonomy + commit state modules with tests 1–2 (RED→GREEN).

Phase 2 — Guarded-stream primitive; wire RetryOrchestrator onto it; delete
dead duplicate; tests 3 (and keep partialOutputBoundary fence green).

Phase 3 — Commit gates in orchestrator retry/auth/bucket decisions + LB
retry/failover loop; tests 4–6.

Phase 4 — Anthropic terminal validation + in-band decode; tests 5 (processor
level) and composed cases.

Phase 5 — Telemetry fields (additive); tests 7.

Phase 6 — Architecture doc; final full verification cycle.

## Verification

Full cycle per dev-docs/RULES.md and the issue workflow skill:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Plus focused suites:
`bun test packages/providers/src/__tests__/RetryOrchestrator packages/providers/src/__tests__/LoadBalancingProvider packages/providers/src/anthropic packages/providers/src/__tests__/retryInfrastructure.behavior.test.ts`

## Risk notes for implementers

- Keep the WeakSet `markErrorAfterStreamOutput` behavior EXACTLY as is for
  the agents layer; commit state is additive, not a replacement.
- The LB `RequestTimeoutError` (code LLXPRT_REQUEST_TIMEOUT) is used by
  metrics (`isTimeoutError`); the unified primitive must remain identifiable
  by that check or the check must move to the taxonomy without breaking
  `LoadBalancingProvider.timeout.test.ts`.
- `ping` and `message_stop` events currently fall through the processor's
  branches; unknown-event handling must not classify known no-op events as
  malformed.
- Tool-call id sequence (`toolCallSequence`) and thinking stream ids must not
  change; they are pinned by issues #3128/#1150 tests.
- Don't let commit state leak ACROSS requests: it rides the per-request
  context created in `resolveRetryRequestContext` (same lifecycle as the
  budget; see retryInfrastructure.behavior.test.ts for context-sharing
  semantics).
- packages/providers has max-lines/source-size lint limits; the orchestrator
  is near 980 lines — extract rather than grow where needed.
