# PLAN-20260813-ISSUE3217 — Initialize mandatory prompt estimators before agent readiness

Issue: #3217 — Intermittent GPT-5.6 prompt-estimator initialization failure during interactive initial-prompt startup

## Symptom

A Jefe-launched interactive LLxprt session with an initial `-i` prompt can fail its
first chat with:

    Failed to initialize chat: Prompt estimator asset-unavailable for gpt-5.6-sol (openai-responses)

Restarting the LLxprt process and entering a prompt manually succeeds, and another
apparently identical Jefe launch may also succeed.

## Root cause

The provider composition root registers a lazy GPT-5.6 runtime tokenizer. The
mandatory local `o200k_base` encoder is first initialized only when
`ChatSessionFactory` accounts for the first chat's system prompt:

    ChatSessionFactory.applySystemPromptTokenOffset
      -> HistoryService.estimateTokensForText
      -> createGpt56RuntimeTokenizer.countTokens
      -> estimateGpt56Prompt
      -> getO200kBaseEncoder

`getO200kBaseEncoder` memoizes its initialization Promise. If the first module load
or `get_encoding('o200k_base')` operation rejects, that rejected Promise remains
cached for the process. `estimateGpt56Prompt` then maps every causal exception to
the generic `asset-unavailable` diagnostic.

Interactive startup renders before starting an unawaited update check. The initial
`-i` prompt can submit independently. If an update is available,
`handleAutoUpdate` starts a detached global package-manager install that replaces
the package tree while a process may still be performing first-use dependency
initialization. The update lock serializes writers only; it does not protect
readers. Local npm logs and live-process mappings verify that global replacement
and old-tree readers coexist. Concurrent startup against a stable tree succeeds,
so Jefe process concurrency by itself is not the cause.

## Requirements

### REQ-3217-001 — Readiness invariant

**Full text:** A finalized active provider/model that requires a mandatory exact
prompt estimator must initialize that estimator before the foreground Agent is
reported ready.

**Behavior:**

- GIVEN the active model is a sanctioned GPT-5.6 identity
- WHEN `fromConfig` completes provider activation
- THEN the shared local `o200k_base` encoder is initialized and proves it can
  encode ordinary text before `fromConfig` returns the Agent

### REQ-3217-002 — Exact accounting only

**Full text:** GPT-5.6 readiness and later prompt accounting must use the same exact
shared encoder and must not introduce a heuristic fallback, retry loop, or swallowed
initialization error.

**Behavior:**

- GIVEN GPT-5.6 readiness completed successfully
- WHEN the first chat estimates its system prompt
- THEN exact token accounting succeeds through the already-initialized encoder

### REQ-3217-003 — Fail-fast causal diagnostic

**Full text:** If the mandatory encoder cannot initialize, Agent bootstrap must
fail before interactive lifecycle startup or initial-prompt submission and retain
the underlying loader or codec failure in the displayed diagnostic.

**Behavior:**

- GIVEN the local tokenizer module or codec initialization fails
- WHEN Agent bootstrap prepares the active estimator
- THEN bootstrap rejects with the estimator context and causal error text
- AND no ready Agent is returned

### REQ-3217-004 — Concurrency

**Full text:** Concurrent readiness callers in one process must share initialization
and observe the same usable encoder or the same initialization failure.

## Integration contract

1. The providers package owns model recognition and estimator preparation.
2. The core-owned `RuntimeTokenizerFactory` contract exposes an asynchronous,
   provider/model-scoped preparation operation without importing provider types.
3. The agents package invokes that operation after activation has finalized the
   active provider/model and before `finalizeAgent` returns a ready Agent.
4. The CLI remains a thin client. It receives no ready Agent if preparation fails,
   so interactive rendering, `setupInstanceLifecycle`, auto-update, and the `-i`
   submission path cannot begin for that process.
5. Later `HistoryService` accounting obtains the same runtime tokenizer and shared
   process-wide encoder.

## Pseudocode

1. DEFINE `RuntimeTokenizerFactory.prepareTokenizer(providerName, model)` as an
   optional asynchronous composition-boundary operation.
2. IN the providers runtime-tokenizer factory implementation:
   1. RESOLVE model from explicit model or provider name.
   2. IF model is not a sanctioned GPT-5.6 model, RETURN without work.
   3. AWAIT the shared `o200k_base` encoder.
   4. ENCODE a small fixed ordinary-text probe.
   5. IF load or encoding fails, THROW `ModelPromptEstimatorError` with active
      provider, model, protocol, family, remediation, and the causal error.
3. IN `fromConfig`, after activation resolves:
   1. RESOLVE active provider from the post-activation manager, falling back to
      `config.getProvider()` only when needed.
   2. AWAIT `config.getTokenizerFactory()?.prepareTokenizer(activeProvider,
      config.getModel())`.
   3. ONLY THEN build parsed config and finalize the Agent.
4. ENSURE error formatting retains the causal error message for this readiness
   failure.

## Test-first phases

### Phase 1 — RED: provider preparation behavior

Add Bun behavioral tests that exercise the real provider factory seam:

- a sanctioned GPT-5.6 model prepares exact `o200k_base` accounting;
- a non-GPT model performs no mandatory GPT preparation;
- simultaneous GPT readiness calls both produce a usable exact tokenizer;
- an injected module/codec failure rejects with estimator context and causal text.

Tests assert returned counts and user-visible errors, not collaborator call counts.

### Phase 2 — RED: Agent bootstrap ordering

Add a Bun behavioral test through `fromConfig` proving that a mandatory preparation
failure prevents a ready Agent from being returned, while successful preparation
completes before the returned Agent's tokenizer is first used. Reuse existing real
runtime/config test fixtures rather than creating a parallel bootstrap path.

### Phase 3 — GREEN: implementation

Implement the core contract, provider preparation operation, and `fromConfig`
integration exactly at the post-activation/pre-finalization boundary. Preserve the
single-Agent and single-provider-manager architecture.

### Phase 4 — Integration/runtime regression

Extend the relocated GPT bundle fixture through the production readiness operation
where practical. Verify the bundle still externalizes `@dqbd/tiktoken`, can run
beside a relocated dependency tree, and produces an exact pinned count. Do not copy
WASM into `bundle/` or reverse externalization.

## Remediation architecture

- `fromConfig` treats the isolated runtime handle as transaction-owned until
  `finalizeAgent` returns. Activation, initialization, finalized provider/model
  activation, tokenizer readiness, and Agent finalization execute inside one
  failure boundary. Rejection awaits handle cleanup; a cleanup failure is composed
  after the primary bootstrap failure in an ordered `AggregateError`.
- Isolated runtime handles track cleanup obligation from activation start rather
  than only successful activation, so partial activation can be disposed by the
  same transaction.
- Provider composition installs a default tokenizer factory only when Config has
  none. An explicit caller-injected factory therefore remains the single factory
  observed by Config, ProviderManager, HistoryService, and Agent. `fromConfig`
  resolves that authoritative factory only after activation.
- The runtime tokenizer factory moved to a narrow composition module so bundle and
  relocation tests can exercise the production readiness API without pulling
  unrelated provider-manager/keyring assets into the fixture.
- Every factory owns an encoder resolver. The production resolver delegates to the
  existing process-wide encoder Promise; an injected loader receives a factory-local
  memoized encoder Promise shared by readiness and later GPT runtime tokenization.
- The production CLI topology remains the gate: `main` awaits
  `constructForegroundAgentAndDispatch`, which awaits `constructAgentWithSpinner`,
  which awaits `createForegroundAgent`/`fromConfig` before calling the shared
  interactive/non-interactive dispatcher. The `fromConfig` behavioral test proves
  readiness cannot return an Agent before completion and rejects transactionally.
  A separate `main` acceptance test was not retained because importing the full CLI
  entry under an isolated Bun module mock deadlocks before test execution; reproducing
  the orchestrator with mock call-order assertions would test the double, not behavior.
- Relocation coverage now calls production factory readiness, renames the relocated
  `@dqbd/tiktoken` package tree after preparation, and then performs the first exact
  runtime estimate. This proves post-readiness accounting does not re-read a package
  tree that an updater may replace.

## Verification

Focused:

    bun test packages/providers/src/tokenizers/Gpt56O200kPromptEstimator.test.ts
    bun test packages/agents/src/api/__tests__/fromConfig.behavior.test.ts
    bun test scripts/tests/gpt56-bundle-runtime.test.ts
    bun test scripts/tests/issue-3055-tiktoken-relocated.bun.test.ts

Full gate:

    npm run test
    npm run lint
    npm run typecheck
    npm run format
    npm run build
    bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"

Because this changes interactive startup ordering, verify an interactive `-i` launch
in the tmux harness before creating the PR.

## Constraints

- New and changed tests use TypeScript with `bun:test`; do not add or modify
  Vitest/Node suites.
- No new `eslint-disable`, TypeScript suppression directive, lint severity
  downgrade, ignored source path, or complexity/size threshold increase.
- No heuristic fallback, silent retry, swallowed exception, or downstream guard
  around chat creation. Establish the invariant at startup.
- Do not copy tokenizer assets into the CLI bundle and do not alter intentional
  tiktoken externalization.
- Do not modify `.llxprt/` contents.
