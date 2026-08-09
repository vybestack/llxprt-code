# Issue #2254 — Evidence-gated bounded adaptive reconciliation

## Accepted behavior

This issue may add a runtime adaptive decorator only for a canonical runtime
model key that has qualifying post-migration evidence. The evidence gate is the
first deliverable, not an assumption that adaptation will ship.

### B1 — Canonical evidence key

Every evaluated observation belongs to exactly one immutable runtime identity:
canonical model family and model, active provider, wire protocol, immutable
estimator version, tokenizer/base-counter asset revision, and finalized request
projection revision. Profile names are not identity. Observations from different
models, providers, protocols, estimator versions, assets, or projection
revisions are never pooled.

### B2 — Valid evidence

A candidate key is eligible for evaluation only with at least 100 valid
provider-grounded observations and a preregistered independent holdout. The
target is the provider's complete `promptTokens`, including cache-read and
cache-creation prompt tokens because they still occupy context. Evidence used
to fit the immutable estimator is not independent post-migration residual
evidence for an adaptive overlay. Pre-migration observations cannot be relabeled
as observations of a later estimator version or projection revision.

### B3 — Deterministic activation decision

For one eligible key, compare the registered immutable estimator with the
candidate correction on the untouched holdout. Activation requires both:

1. candidate held-out MAPE improves by at least 10% relative to the immutable
   baseline; and
2. candidate p95 underestimation is no worse than the immutable baseline.

An exact family with no demonstrated residual remains unadjusted. A zero-MAPE
baseline cannot pass by claiming a relative improvement. The decision is made
per key; there is no global/default/profile precedence and no cross-model
learning.

### B4 — Conditional runtime behavior

Only if a key passes B1–B3 may implementation add a decorator around that
registered immutable estimator. Any adjustment must be additive/non-lowering
relative to the immutable estimate. Versioned observation/coefficient schemas,
fail-closed validation, stale/mismatch rejection, shadow correlation, and
versioned persistence are required only for a passing key. Provider actual
usage and history synchronization remain authoritative and unchanged.
Disabling or removing valid adaptive state must restore the immutable estimate
bit for bit.

Introducing a runtime decorator, public abstraction, storage subsystem,
profile setting, tokenizer factory, request projection, or accounting change
without a passing key is outside the accepted behavior.

### B5 — Required no-go outcome

If no scoped key passes B1–B3, document the evidence decision and leave runtime
adaptation entirely disabled. In that outcome:

- no adaptive coefficients or state are generated;
- no observation/coefficient persistence schema is added;
- no estimator registry, agent estimate-to-actual seam, provider actual usage,
  or history synchronization code changes;
- the six registered immutable estimator paths remain the only runtime paths.

This is successful completion of the issue, not a partial implementation.

### B6 — GPT-5.6

GPT-5.6 remains explicitly unadjusted. Issue #2253 measured zero matched
incremental error, and its registered `o200k_base` estimator exactly counts the
finalized projected text. This does not claim zero error against complete
provider prompt totals for every request. GPT-5.6 can only become eligible if a
new independent, correctly keyed post-migration data set satisfies the same
B1–B3 gate; no exception or model-specific override is accepted.

## Relevant inputs and boundary cases

The scoped families are Claude Opus 5, Claude Fable 5, GPT-5.6, Kimi K3,
GLM 5.2, and MiniMax M3.

- Opus 5 and Fable 5 observations and coefficients are independent and cannot
  be combined despite similar results.
- GLM 5.2 observations from z.ai over Anthropic Messages and Ollama Cloud over
  OpenAI Chat are distinct keys and cannot be combined.
- Kimi K3 and MiniMax M3 are different families; historical profile naming does
  not change canonical model identity.
- Official tokenizer fixtures prove local codec semantics, not provider
  residuals or server-side template overhead.
- Claude #2835 data fitted and gated the immutable static calibration. It is not
  an independent residual-correction holdout, and each model has fewer than 100
  total observations in that corpus.
- #2253 data predates the finalized projection and current immutable estimator
  registrations. It cannot activate an overlay for the migrated identities.
- Malformed, stale, mismatched, corrupt, or under-sized evidence fails closed at
  the gate; it is not repaired, pooled, or given fallback precedence.

## Behavioral evidence

The evidence report must inventory every scoped key, state which immutable
estimator is registered, identify available observation sets and their
provenance, and record a deterministic PASS/FAIL reason for each gate step.
Counts and provenance must be reproducible from committed artifacts.

Because the accepted no-go behavior changes no runtime code, its behavioral
proof reuses the existing Bun suites that execute the real registry and
estimators:

1. `packages/providers/src/tokenizers/Gpt56ProviderUsageParity.test.ts` proves
   GPT-5.6's matched held-out increments remain exact.
2. `packages/providers/src/tokenizers/official/officialTokenizers.test.ts` and
   `providerFramingSeparation.test.ts` prove the three official model codecs and
   registry paths remain exact and immutable.
3. `packages/providers/src/tokenizers/claude/claudeCalibrationGate.test.ts` and
   `claudePromptEstimator.test.ts` prove Opus 5 and Fable 5 use their separate,
   deterministic immutable calibrations.
4. `packages/providers/src/runtime/providerManagerRuntimeFactories.test.ts`
   proves runtime-factory injection and the two Claude composition paths. The
   family-specific suites plus composition-root source inspection prove all six
   immutable estimator families remain registered.
5. A source search must find no prompt-estimator adaptive decorator/state path.
6. Full repository verification and the standard live smoke test must pass.

If the evidence inventory unexpectedly finds a passing key, stop before adding
the unplanned runtime subsystem and revise this plan with the concrete key,
coefficient form, schemas, persistence boundary, shadow-correlation seam, and
new behavioral tests.

## Evidence inventory to evaluate

- `research/issue2253/live-results.jsonl` and `report.md`
- `packages/providers/src/tokenizers/fixtures/gpt56-provider-usage-v1.json`
- `research/issue2835/claude5-live-results.jsonl`, `claude5-calibration.json`,
  and `report.md`
- Claude per-model sanitized fixtures under
  `packages/providers/src/tokenizers/claude/fixtures/`
- Official tokenizer implementation, manifests, and behavioral fixtures under
  `packages/providers/src/tokenizers/official/`
- Current registrations in `ModelPromptEstimatorRegistry.ts` and
  `providerManagerInstance.ts`

## Non-goals

No tokenizer asset work, request projection, accounting-ledger or cache-billing
changes, profile UI/settings, cross-model coefficients, new dependency,
workflow/quality-tool change, unrelated refactor, or models outside the six
scoped families.
