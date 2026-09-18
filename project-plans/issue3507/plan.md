# Issue #3507 — Load-balancer prompt-envelope estimation parity (tool-aware pre-send estimates)

## Problem restated from evidence

Follow-up to #3499. Two estimation gaps were deferred there:

1. **Gap 1 — no LB projection parity.** `LoadBalancingProvider` implements no
   `projectPromptEnvelope`. Direct providers project their finalized envelope
   (tool schemas included) at the app send seam; for load-balancer traffic
   `prepareAtSendSeam` returns `estimate: null` and pre-send enforcement falls
   back to a contents-only estimate, while the LB guard itself estimates the
   full per-sub-profile envelope through the delegate provider's projection.
   A session can therefore pass pre-send enforcement and then trip the LB guard
   (the #3499 failure shape: 200266 / 203333 / 204973 against a 200000 limit),
   forcing all reduction work into the provider callback path instead of the
   ordinary enforcement path.
2. **Gap 2 — callback overhead model is an approximation.**
   `computeCallbackLimits` derives per-request overhead as
   `guard.estimatedTokens - enforcerOwnEstimate(budget 0)` and assumes the gap
   stays constant after reduction. Fail-safe but wastes a reduction round when
   the gap grows.

Additional git archaeology (this issue's research): commit 293093b5f (#3199,
media lifecycle rework) incidentally changed
`preparePromptEnvelopeAfterEnforcement` from #2817's original
projection-aware enforcement estimator
(`prepared.estimate?.estimatedPromptTokens ?? input.fallbackEstimate(candidate)`)
to always passing `input.fallbackEstimate`. Today pre-send enforcement is
contents-only for ALL providers; the projection estimate is consumed only
after enforcement (telemetry, transport token). #3199's PR body states no
estimation-policy change — the wiring change was fallout of moving media
resolution to request scope. Notably, #3199 also added the `releaseUnused`
preparer machinery, which is exactly what makes per-candidate projection
cleanup safe now (better than #2817's original, which had no cleanup).

## Estimation-policy decision (the decision this issue retains)

**Chosen: peek-next sub-profile delegate projection with an estimate-only
token, plus restoring the projection-aware enforcement estimator at the app
seam.**

### Part 1 — `LoadBalancingProvider.projectPromptEnvelope(options)`

- **Peek, don't consume**: round-robin peeks `subProfiles[roundRobinIndex]`;
  failover peeks `subProviders[failoverState.getIndex()]`. The peek must not
  mutate selection state.
- Resolve the delegate provider via `providerManager.getProviderByName`. If
  missing, return `undefined` (seam contract: capability unavailable; the
  send itself still fails fast with the existing error).
- If the delegate has no `projectPromptEnvelope`, or its projection resolves
  `undefined`, return `undefined` (never an error at the seam; the guard's
  stricter `ModelPromptEstimatorError` behavior stays guard-only).
- Build the options exactly like the guard path does:
  `optionsWithSelectedModelPrompt(options, providerName, model)` (issue #3157
  sub-profile system-prompt re-render — otherwise the projection misses the
  model-rendered prompt and under-estimates), then the same
  delegate-resolved options path `estimateForSubProfile` uses
  (`resolveMemberAuthentication` for failover, `buildDelegateResolvedOptions`).
- **Wrap the delegate projection as estimate-only**: fresh frozen
  `transportToken` (not registered in any delegate store), copy
  `model/protocol/method/projectionRevision/unsupportedMedia/finalizedProjection/accounting/legacyEstimate`.
  Do NOT forward the delegate's `releaseIfUnsent`; instead await it eagerly so
  the delegate's request-scoped resources (media reservation, prepared-store
  cleanup) are released within the call. A release failure propagates
  (fail-fast on resource-accounting bugs). The estimation fields are inert
  snapshots (`finalizedProjection` is a frozen
  `llxprt-provider-prompt-v3` value; `legacyEstimate` is a memoized
  token count over the serialized prompt), so eager release is safe.
- Why the estimate still lands correctly at the seam:
  `estimatePromptEnvelope('load-balancer', projection, factory)` dispatches on
  `projection.model`/`protocol`; model-keyed estimator families estimate
  identically to the guard path. Provider-restricted calibrated families fall
  back to `legacyEstimate` (still an envelope-derived heuristic). The guard
  re-estimates authoritatively at send time regardless.

### Part 2 — restore the projection-aware enforcement estimator

`preparePromptEnvelopeAfterEnforcement`
(`packages/agents/src/core/promptEnvelopeSendSeam.ts`) enforces with:

```ts
const contents = await input.enforce(input.contents, async (candidate) => {
  const prepared = await preparer.prepare(candidate);
  return (
    prepared.estimate?.estimatedPromptTokens ??
    input.fallbackEstimate(candidate)
  );
});
```

inside the existing try/catch that releases unused candidate projections.
This is #2817's original estimator composed with #3199's cleanup machinery.
It is the single provider-generic mechanism that makes pre-send enforcement
tool-aware for LB traffic (no LB type-sniffing) and restores direct providers
to #2817's documented intent ("first-send compression and hard context
decisions see the exact prompt-bearing envelope").

Side effect (no code change needed): the LB guard-path compression callback's
enforcer shares this estimator (`estimateFinalizedPromptTokens` is wired from
the seam through `enforceProviderContents`), so
`computeCallbackLimits`' overhead becomes envelope-vs-envelope — both sides
of the subtraction see tool schemas. That directly improves the Gap 2
approximation.

### Rejected alternatives (documented for the record)

- **Min-context backend projection**: estimates an envelope the next send
  usually does not transmit; still ambiguous across tokenizers (min context is
  not max envelope). Would under-catch exactly the marginal sessions #3499
  was about.
- **LB-level envelope protocol**: a new cross-package public abstraction for
  information delegate projections already carry. Out of proportion; would
  need separate approval per the issue's stop-gates.
- **Moving enforcement fully into the guard path**: abandons the ordinary
  app-side ladder — the opposite of the stated consequence to fix ("the
  pre-send ladder runs too late or not at all").

## Accepted behavior (acceptance criteria)

**AC1 — LB projection capability.** `LoadBalancingProvider.projectPromptEnvelope`
exists and returns an estimate-only projection derived from the peeked next
sub-profile's delegate:

- peeks without mutating round-robin or failover selection state;
- delegate receives guard-parity options (sub-profile system-prompt re-render
  + delegate-resolved options);
- `undefined` when the delegate cannot project;
- fresh transport token; delegate request-scoped resources released within
  the call (delegate's `releaseIfUnsent` awaited exactly once, not forwarded).

**AC2 — tool-aware pre-send enforcement.**
`preparePromptEnvelopeAfterEnforcement` estimates enforcement candidates with
the provider's finalized-envelope projection when available, falling back to
the contents-only estimator otherwise. For LB traffic this means a session
that is under the limit contents-only but over it once tool schemas are
rendered now triggers the ordinary pre-send ladder BEFORE the provider call,
and the LB guard no longer trips for such sessions (the guard-path compression
callback is not invoked).

**AC3 — Gap 2 integration test.** A committed Bun integration test wires the
REAL compression callback (real `ProviderContentEnforcer` machinery, real
history/truncation wiring per repo test rules) through a REAL
`LoadBalancingProvider` whose delegate projection's estimate CHANGES after
escalation, covering the seam directly:

- constant-overhead case: the callback's reduction satisfies the LB's
  independent re-check and the send proceeds;
- growing-gap case (overhead scales differently than contents): the callback
  can satisfy its internal predicate yet fail the LB re-check — pin the
  fail-safe outcome (`LoadBalancerContextLimitError`; no oversize request is
  sent).

The test path/case must be identifiable for the #2643/#2644 conformance
evidence linkage (LB prompt-envelope + tool-schema estimation through real
pre-send enforcement and the compression callback, including a delegate
projection whose overhead changes after reduction).

### Boundary cases

- Multiple sub-profiles with different models/protocols: the projection
  reflects the peeked sub-profile (per rotation position), and consecutive
  peeks rotate with the selection state.
- Providers without `projectPromptEnvelope`: behavior unchanged
  (contents-only enforcement; null seam estimate).
- Enforcement failure mid-ladder: unused candidate projections released via
  the existing `releaseUnused` path (preserve current behavior).
- Rotation drift between peek and send (concurrent requests): documented
  non-goal to make pre-send exact; the guard re-estimates authoritatively at
  send time, degrading to today's guard behavior.

### Explicit non-goals (scope guard)

- No change to `computeCallbackLimits` math or the guard itself.
- No new public abstractions (no LB envelope protocol).
- No restoration of candidate media materialization beyond what the preparer
  machinery already does.
- No changes to `.llxprt/` contents.

## Test plan (TDD order)

1. **New** `packages/providers/src/__tests__/LoadBalancingProvider.promptEnvelopeProjection.test.ts`
   (AC1): forwards estimation fields from the peeked sub-profile's delegate
   (real projection values, not mock-interaction assertions); tool-bearing
   options project larger than tool-less through a real delegate projection
   builder; non-mutating peek (round-robin/failover state unchanged; the next
   send still selects the peeked sub-profile); `undefined` passthrough when
   the delegate lacks projection; fresh transport token; delegate
   `releaseIfUnsent` awaited exactly once during projection; failover peeks
   its start index; delegate sees the sub-profile-rendered system prompt.
2. **Extend** `packages/agents/src/core/promptEnvelopeSendSeam.test.ts` (AC2):
   enforcement estimator receives the projection estimate when the provider
   projects; falls back to contents-only when it does not; candidate
   projections are reused/prepared per candidate and released on enforcement
   failure.
3. **New integration test** for AC3 (Gap 2) in
   `packages/agents/src/compression/__tests__/` wiring the real LB + real
   enforcer callback + delegate projection with changing overhead (agents
   package may import the providers package; precedent exists in
   `chatSession.systemPromptAssembly.test.ts`).
4. End-to-end LB parity assertion (AC2, LB-specific): marginal over-limit
   session with tool schemas — pre-send ladder reduces before the provider
   call; the guard callback is NOT invoked; the send succeeds. This can live
   with (3) or the seam test, implementer's choice, but the behavior must be
   asserted somewhere with real components.

Existing tests that pin the old null-estimate/seam behavior (e.g.
`chatSession.promptEnvelopeEstimation.test.ts`,
`tokenUsageFinalizedEstimate.test.ts`) may need expectation updates ONLY
where they contradict the new contract; each update must cite the AC.

## Implementation checkpoints

- Read `packages/agents/src/core/turnMediaRequest.ts`
  (`enforceTurnMediaRequestContents`) and confirm the restored estimator
  composes with the turn-media path without double projection.
- Keep `LoadBalancingProvider.ts` under the 800-line lint cap: put the
  wrapping logic in a new module under `packages/providers/src/loadBalancing/`
  (e.g. `promptEnvelopeProjection.ts`) and call it from the class method.
- `enforceProviderContents`' callback remains attached for the provider call
  after enforcement (existing contract, unchanged).
- License headers: 2026, Vybestack LLC, Apache-2.0.

## Verification

Full cycle per the issue-workflow skill:

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load zai-glm-flash "write me a haiku and nothing else"
```

Re-run after every remediation round. The conformance evidence linkage
(test path/case, PR, tested SHA, green result) is reported on #2643/#2644
after the PR lands its tested SHA.
