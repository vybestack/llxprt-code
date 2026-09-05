# Issue #3499 — Load-balancer context guard must compress or otherwise handle overflow instead of dead-ending

## Problem restated from evidence

A session on a `load-balancer` profile ("glm", sub-profiles zai / ollamaglm51 /
chutesglm52, all with a 200000-token limit) failed the turn with:

```
API Error: Load balancer "glm" context limit exceeded for all eligible backends:
zai: ... estimated 200266 tokens exceeds configured limit 200000;
ollamaglm51: ... estimated 203333 ...; chutesglm52: ... estimated 204973 ...
```

The session was marginally over the limit (zai by 266 tokens). The user expects
the system to "compress or otherwise handle it" — the same way direct-provider
traffic is handled — rather than kill the turn with an API error.

## Root-cause analysis

Two code paths meet at this failure, and each has a gap.

### Gap 1 — the guard's only remediation is one compression round

`LoadBalancingProvider.enforceTokenLimitForTarget`
(`packages/providers/src/LoadBalancingProvider.ts`) estimates the finalized
prompt per sub-profile and, when the estimate exceeds the target limit, calls
`compressForContextLimit`, which:

1. invokes `this.compressionCallback(clonedContents)` exactly once, then
2. re-estimates, and if still over the limit returns `undefined`, and then
3. throws `LoadBalancerContextLimitError` → failover walks every backend →
   `LoadBalancerAllContextLimitsExceededError` → the turn dies.

The callback maps to
`ProviderContentEnforcer.compressAndRecompose`
(`packages/agents/src/compression/providerContentEnforcement.ts`), which runs
ONE `performCompression` with `completionBudget = 0` and no fit check. It has
none of the escalation the pre-send `enforce()` ladder has: no
ineffective-compression retry, no fallback history truncation, no unified
tool-response truncation. So when compression is structurally ineffective for
the deficit (recent-turn and memory exclusions leave little compressible mass;
the session is only a few hundred tokens over), the guard dead-ends even though
the machinery to shed those tokens exists and is used for direct providers.
This matches the evidence: the per-backend messages are plain
`LoadBalancerContextLimitError`s, i.e. the callback returned contents (did not
throw) and the re-estimate still exceeded the limit.

### Gap 2 — the callback cannot target the guard's limit

The guard's estimate is the sub-profile's full finalized envelope: the delegate
provider's `projectPromptEnvelope` projection, which includes tool-schema
rendering (that is why the three backends report 200266 / 203333 / 204973 for
the same conversation). The enforcer's own estimate is contents-only (the
load-balancer implements no `projectPromptEnvelope`, so the app-side finalized
estimate is null and enforcement falls back to a contents-only estimate). The
callback receives only `contents` — it does not know the guard's estimate or
limit — so even with the full ladder it can only converge by luck of its
completion-budget margin covering the tool-schema overhead it cannot see.

## Accepted behavior

### AB1 — the compression callback escalates to the full reduction ladder

When the load-balancer guard invokes the compression callback,
`ProviderContentEnforcer.compressAndRecompose` must run the same escalation as
`enforce()`:

1. density optimization + recomposition,
2. compression (`performCompression`, cooldown bypassed),
3. ineffective-compression retry (< 5% reduction),
4. fallback history truncation to a deficit-exact target
   (`computeHistoryTruncationTarget` semantics),
5. unified tool-response truncation as the last resort,

and return contents that fit the target limit. A plain compression failure or
structural no-op no longer aborts the callback; truncation rescues the request.
Only when even tool-response truncation cannot fit does the callback throw
(preserving the provider callback failure contract:
`LoadBalancerCompressionCallbackError` → failover → aggregate error).

### AB2 — the callback targets the guard's actual limit

The `CompressionCallback` protocol gains an optional second argument the
load-balancer populates from its guard state:

```ts
type CompressionCallback = (
  contents: IContent[],
  guard?: { estimatedTokens: number; contextLimit: number },
) => Promise<IContent[]>;
```

`LoadBalancingProvider.compressForContextLimit` passes
`{ estimatedTokens: result.tokens, contextLimit }`. When the guard info is
present, the enforcer derives the per-request overhead it cannot see
(`overhead = guard.estimatedTokens - ownEstimate(originalContents)`, clamped at
0) and enforces `ownEstimate(contents') <= guard.contextLimit - overhead`
without adding its own completion budget (the guard defines the contract being
satisfied; re-reserving a 65536-token default budget would discard tens of
thousands of tokens of live context unnecessarily). Truncation targets that
deficit exactly, so the request converges onto the guard instead of over-cutting
or under-cutting. When the guard info is absent (any other caller), the ladder
runs against the enforcer's own computed limits (still strictly better than
today's single compression round).

Backward compatibility: existing callbacks that take only `contents` remain
assignable (fewer-parameters functions are assignable to the widened type); the
providers-package tests with `(contents) => ...` fakes keep passing unchanged.

### AB3 — behavior of the guard itself is otherwise unchanged

- Estimation, `getTargetContextLimit` (min of shared and member limits),
  failover walking, aggregate error text, metrics/circuit-breaker accounting,
  and transport are untouched.
- Round-robin and failover strategies both benefit through the shared
  `enforceTokenLimitForTarget` → `compressForContextLimit` path.
- When no callback is attached (embedders that never call
  `setCompressionCallback`) the guard still throws as today.

### AB4 — the overflow error stays honest

If reduction is genuinely impossible (limit smaller than the un-truncatable
payload), the callback throws the structured overflow error
(`buildContextOverflowError`) and the load balancer surfaces it through the
existing failover aggregate — a clear "cannot fit" message, not a silent
oversize send.

## Explicitly out of scope

- Prompt-envelope estimation parity for load-balancer profiles (making the
  app-side pre-send estimate tool-schema aware, e.g. a load-balancer
  `projectPromptEnvelope`). That is the Gap 2 root cause and deserves its own
  design (backend selection happens at send time, so projection parity has
  ambiguity to resolve). Filed as a follow-up issue; this PR links it.
- Changing LB guard semantics (limits, budget reservation inside the guard,
  bypassing the guard, "proceed anyway" modes).
- Compression strategy changes, new strategies, cooldown policy changes.
- UI/UX changes for the error text beyond what falls out of AB1/AB2.
- Any provider-estimator rework beyond passing the two guard numbers through.

## Test plan (written first, behavioral, `bun:test`)

Follows the existing patterns in
`packages/agents/src/compression/__tests__/compressionCallback.test.ts` and
`providerContentEnforcement.historyTruncationTarget.test.ts` (real
HistoryService + real ChatSession compression handler; duck-typed provider
carrying `setCompressionCallback`; assertions on recomposed contents and token
projections, not mock interactions).

### T1 — providers: guard passes token facts to the callback

In `packages/providers/src/__tests__/LoadBalancingProvider.compressionAccounting.test.ts`
(or a sibling file matching its fixtures): over-limit request, callback captures
its second argument → `{ estimatedTokens, contextLimit }` equal the guard's
estimate and limit; the compressed result is accepted when the re-estimate fits
(existing behavior, still green).

### T2 — agents: callback escalates when compression is insufficient

Real history sized so the guard target is missed by a small deficit after
`performCompression` (compression configured to be structurally ineffective or
to under-deliver — e.g. `top-down-truncation` with an exclusion-heavy layout).
Invoke the captured callback with guard info. Assert: returned contents'
projection (own estimator + overhead model) is at or under
`contextLimit - overhead`, and history actually shrank (truncation applied).
Under the current code this test fails (callback returns still-over contents or
throws the noop error).

### T3 — agents: compression no-op / failure no longer dead-ends

Callback path where `performCompression` reports noop/failure but history has
truncatable mass → callback returns fitting contents (does not throw).
Where truncation cannot fit (absurdly small limit) → callback throws the
structured overflow error (contract preserved).

### T4 — agents: exact targeting (no over-cut)

History where the deficit is a few hundred tokens: with guard info, the ladder
must NOT shrink contents to the default-budget ceiling (~limit/2); it targets
`contextLimit - overhead`. Without guard info, ladder still converges against
own limits (AB2 fallback branch).

### T5 — regression

Full `npm run test`; the existing LB compression/failover suites and
`compressionCallback.test.ts` stay green (callback-attachment, cleanup-on-error,
pending-content preservation, `compression-provider-fallback-propagation`).

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Review rounds

At most two deepthinker review rounds and two OCR rounds (initial + one
remediation). Findings triaged Blocker-Fix / In-scope-Fix / Reject / Defer;
remaining MEDIUM/LOW after round two are documented here as known follow-ups.

### Outcome

- deepthinker round 1: AB1/AB3/AB4 pass. Two findings:
  - MEDIUM (In-scope-Fix, fixed): the guard shape was duplicated across
    packages and missing from core's `RuntimeProvider.setCompressionCallback`
    contract. Remediated: `RuntimeCompressionGuardInfo` defined once in core
    (`packages/core/src/runtime/contracts/RuntimeProvider.ts`), re-exported
    from the contracts index, referenced by providers' `CompressionCallback`
    and agents' `CompressionGuardInfo` alias. Type-only change.
  - LOW (Defer): the overhead model (`guard.estimatedTokens - own estimate`)
    is an approximation; if the estimator gap grows after reduction the
    callback can satisfy its internal predicate yet fail the LB's independent
    re-check. Verified fail-safe: the LB re-estimates before any backend send
    and a failed re-check degrades to today's context-limit/failover outcome;
    no oversize request can be sent. The estimator-gap seam is the subject of
    the follow-up estimation-parity issue.
- deepthinker round 2: PASS (finding 1 resolved, finding 2 deferral sound, no
  regressions; 415 targeted tests green).
- OCR (zai-anthropic profile): 1 round, 10 files, 0 findings.

### Known follow-ups (deferred)

1. LB prompt-envelope estimation parity: load-balancer profiles implement no
   `projectPromptEnvelope`, so app-side pre-send estimates are tool-schema
   blind for LB traffic and the guard sees a larger number than pre-send
   enforcement. Filed as a separate issue (linked from the PR).
2. Integration test wiring the real callback through a delegate projection
   whose estimate changes after escalation (covers the deferred approximation
   seam above once parity lands).
