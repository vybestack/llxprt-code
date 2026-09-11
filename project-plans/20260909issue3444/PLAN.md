# Plan: Retries must not replay a released media request (issue #3444)

Plan ID: PLAN-20260909-ISSUE3444
Generated: 2026-09-09
Issue: vybestack/llxprt-code#3444
Total Phases: 2 (RED tests, then GREEN fix)
Requirements: REQ-3444-01 .. REQ-3444-06

## Problem summary

`RetryOrchestrator` builds every physical attempt from the same
`requestOptions`, so a projected turn's `promptEnvelopeTransportToken` is
replayed on retry attempts. Providers treat the token as a one-shot prepared
envelope and release its media request in a per-attempt `finally`
(`finishMediaRequest`). Attempt 2 therefore calls `withContents` on a released
request and throws `Cannot consume media request contents after release`,
masking the original retryable transport error (429/5xx/network) and breaking
configured retry/failover for projected media turns on Anthropic Chat, OpenAI
Chat, and OpenAI Responses.

## Design decision (issue offered two options; this picks option 1)

**Each retry attempt gets a fresh projection and transport token, minted by the
orchestrator through the existing `projectPromptEnvelope` seam.**

Rationale:

- The codebase already established exactly this convention at the two other
  retry loops that carry tokens:
  - `LoadBalancingProvider` "uses a new matched projection token for each
    failover retry" (`LoadBalancingProvider.tokenAccounting.test.ts`) — it
    re-estimates (re-projects) per failover attempt and sends the new token.
  - The agent seam `sendWithFreshPromptEnvelopeRetries`
    (`packages/agents/src/core/promptEnvelopeSendSeam.ts`) re-projects via
    `prepareAtSendSeam` on every retry attempt.
  `RetryOrchestrator` is the only token-carrying retry loop that replays.
- It fixes all three providers (and any future one) at the single point that
  replays tokens; no per-provider rebuild logic, no provider code changes.
- Provider-side per-attempt release semantics stay exactly as merged: the
  attempt that consumes a token releases its media request. No ownership move
  across packages, no new public abstraction (`projectPromptEnvelope` and
  `releaseIfUnsent` already exist on the provider seam).
- Re-projection re-resolves media and auth per retry, matching what an
  unprojected turn's retry already does (fresh `resolveRequestMedia` +
  fresh request preparation per attempt).

Option 2 (hoist release ownership above the orchestrator) was rejected: the
LoadBalancingProvider drops `releaseIfUnsent` when threading sub-provider
tokens, so a "caller above owns release" contract would leak there and would
require changes in `agents`, `LoadBalancingProvider`, and all three providers.

## Acceptance criteria

### REQ-3444-01: First attempt keeps the caller's token

- GIVEN: options carrying `promptEnvelopeTransportToken` from a successful
  projection
- WHEN: the orchestrator executes its FIRST physical attempt
- THEN: that attempt is sent with the caller's original, unmodified token
  (the estimate==transport invariant for the estimated send is preserved)

### REQ-3444-02: Retry attempts use a fresh token, never the spent one

- GIVEN: options carrying `promptEnvelopeTransportToken`
- WHEN: a retryable pre-output failure (e.g. 429) causes the orchestrator to
  build physical attempt N+1 (N >= 1)
- THEN: the orchestrator calls `wrappedProvider.projectPromptEnvelope` with
  that attempt's options and sends the attempt with the returned fresh
  `transportToken`; the spent token is never re-sent

Boundary cases:

a. Wrapped provider has no `projectPromptEnvelope`, or it returns `undefined`
   at refresh time: the retry attempt is sent with `promptEnvelopeTransportToken`
   removed (unprojected re-resolution), never with the spent token. This mirrors
   the seam's own `projection === undefined -> { estimate: null, options }`
   degradation.
b. Refresh projection throws: the error becomes that attempt's error and flows
   through the normal retry classification/telemetry pipeline (no swallow, no
   special-casing, no masking of itself as a release error).
c. A refreshed projection that is minted but never consumed by a provider call
   is released via its `releaseIfUnsent` (no media-request leak). Once the
   provider call with the fresh token starts, the provider's existing
   per-attempt `finally` owns release (guardStream's finally closes the provider
   iterator on every exit path).
d. `metadata.loadBalancerDelegate === true` bypass: unchanged (single
   delegated attempt, no orchestrator retry loop).
e. Transport budget accounting: unchanged — each physical attempt consumes the
   shared budget exactly as before (provider-owned-attempt accounting included).
f. Options without a token: behavior byte-identical to today (no projection
   calls added).

### REQ-3444-03: Anthropic projected media turn survives a retry

- GIVEN: a real `AnthropicProvider` (mocked SDK transport only), a projected
  envelope via `projectPromptEnvelope`, options sent with the token, media in
  contents
- WHEN: the first physical attempt fails with 429 and the second succeeds
- THEN: the turn completes successfully; no
  `Cannot consume media request contents after release` error; exactly two
  physical SDK calls

### REQ-3444-04: OpenAI Chat projected media turn survives a retry

Same shape as REQ-3444-03 through `OpenAIProvider` chat transport.

### REQ-3444-05: OpenAI Responses projected media turn survives a retry

Same shape as REQ-3444-03 through the OpenAI Responses path (prepared request
context from `projectPromptEnvelope` consumed by the executor).

### REQ-3444-06: Original transport error is not masked

- GIVEN: a projected media turn whose retries are exhausted
- WHEN: the final error surfaces
- THEN: it is the transport error (or the retries-exhausted wrapper around the
  last transport error), never
  `Cannot consume media request contents after release`

## Out of scope (explicitly)

- No provider-side rebuild/retry logic; providers stay as merged.
- No change to `promptEnvelopeSendSeam`, `LoadBalancingProvider`, or the
  `PromptEnvelopeProjection` contract.
- No new IProvider surface (uses the existing optional
  `projectPromptEnvelope`).
- No refactor of retry classification/backoff.

## Test plan (RED first, all bun:test)

### New files

1. `packages/providers/src/__tests__/RetryOrchestrator.promptEnvelopeRetry.issue3444.test.ts`
   - Fake provider implementing the token contract with real one-shot release
     semantics (a `released` flag mirroring `ResolvedMediaRequest`), real
     `RetryOrchestrator`. Tests:
     - attempt 1 receives the caller's original token; attempt 2 receives a
       different token minted by a second `projectPromptEnvelope` call (tokens
       observed via sends); send fails if a spent token is replayed (this is
       the RED assertion).
     - both attempts' media released exactly once (release counters).
     - degradation: provider returns `undefined` projection on refresh ->
       attempt 2 sent with no token and succeeds.
     - refresh throw: provider's second projection rejects -> that error
       surfaces (and is not a release error).
2. `packages/providers/src/anthropic/AnthropicProvider.promptEnvelopeRetry.issue3444.test.ts`
   - Mirrors the `AnthropicProvider.imageRecovery.issue3216.test.ts` harness
     (mocked `@anthropic-ai/sdk` messages.create, real provider, real
     orchestrator, inline base64 image contents). Project -> send with token ->
     first attempt 429 -> second attempt succeeds. Asserts text output,
     exactly 2 SDK calls, and no release error (RED today).
3. `packages/providers/src/openai/OpenAIProvider.promptEnvelopeRetry.issue3444.test.ts`
   - Mirrors the `OpenAIProvider.mediaBlock.test.ts` harness (mocked `openai`
     SDK chat.completions.create). Same scenario and assertions.
4. `packages/providers/src/openai-responses/OpenAIResponsesProviderCore.promptEnvelopeRetry.issue3444.test.ts`
   - Real `OpenAIResponsesProviderCore` (or its test provider harness from
     `openAIResponsesExecutor.streamIntegrity.test.ts` with fetch mocking);
     project -> token -> 429 -> success. Same assertions.

### Existing suites that must stay green (no edits expected)

- `packages/providers/src/__tests__/LoadBalancingProvider.tokenAccounting.test.ts`
- `packages/providers/src/__tests__/promptEnvelopeWrapperChain.test.ts`
- `packages/agents/src/core/promptEnvelopeSendSeam.test.ts`
- `packages/providers/src/anthropic/AnthropicProvider.imageRecovery.issue3216.test.ts`
- `packages/providers/src/openai-responses/openAIResponsesExecutor.streamIntegrity.test.ts`
- full `npm run test`

## Implementation sketch (GREEN phase)

Modify only `packages/providers/src/RetryOrchestrator.ts` (plus a small helper
if the file's size/complexity budget demands extraction — prefer a sibling
helper module following `retryTransportOwnership.ts` style):

- Track the physical attempt index in `runRetryRequest`'s loop (local counter;
  do not rely on `budget.used`).
- For attempts after the first, when
  `requestOptions.promptEnvelopeTransportToken !== undefined`, refresh:
  - call `this.wrappedProvider.projectPromptEnvelope(attemptOptions)`;
  - on a projection: replace the token on the attempt options with
    `projection.transportToken`; hold `projection.releaseIfUnsent`;
  - on `undefined`/missing method: strip the token;
  - a throw propagates as the attempt's error into the existing
    catch/classify path.
- Release a held `releaseIfUnsent` only when the refreshed projection was
  never consumed by a provider call (documented ownership comment; after the
  provider call starts, the provider's per-attempt finally owns release).
- No behavior change when no token is present.

## Verification

- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run format`
- `npm run build`
- `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`
- Test-audit scanner on touched files: no new MOCK_MIRROR / SELF_CONFIRMING
  findings vs main baseline.

## Review gates

- deepthinker compliance review (max 2 rounds).
- OCR with zai profile, glm-5.3 (max 2 rounds), before push.
- PR must reference `fixes #3444`; CI green; CodeRabbit findings triaged as
  Blocker-Fix / In-scope-Fix / Reject / Defer.

## Review remediation log

2026-09-11: Option 1 remains unchanged: the orchestrator re-projects each retry.
Boundary c is amended: retain each minted retry envelope's cleanup handle until
the attempt settles, then release on failure or cancellation, including adapter
preparation failures before the provider generator starts. Release is idempotent
in `request-media-resolution.ts` and `request-media-resolver.ts`, so a provider
that already released the request causes no second disposal. Successful attempts
remain provider-owned. Regressions cover rejected preparation, a returned but
unstarted body, and cancellation during preparation, using disposal counters.

The recovery cap now combines this loop's transport-budget deltas with failed
pre-send refresh attempts. Physical-send accounting and telemetry are unchanged.
Two internal sends followed by one failed refresh exhaust a three-action cap.
The Anthropic harness uses the real retry classifier with SDK 429 errors and
checks that a distinct final failure survives exhaustion.

The Responses regression uses seven physical sends: six 429s exhaust the real
executor's default internal cap, and the seventh send exercises the orchestrator's
fresh-envelope outer retry. Invocation settings omit `retries`; the orchestrator
limit is seven. Both success and exhaustion cases retain payload assertions,
and exhaustion identifies the error from send seven.
