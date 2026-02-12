# Feature Specification: High Density Context Compression

**Issue**: #236
**Plan ID**: `PLAN-20260211-HIGHDENSITY`
**Status**: Proposal

## Purpose

Context compression is a heavy, lossy operation. Every time the LLM summarizes
conversation history, fidelity drops — nuance about task rationale, user
corrections, failed approaches, and actual code is lost. Meanwhile, large
portions of context space are consumed by stale or redundant tool outputs
(e.g., files read then rewritten, duplicate `@` inclusions).

High Density Context Compression introduces a new `high-density` compression
strategy that reclaims context space through deterministic pruning *before*
resorting to LLM summarization, and enriches LLM summarization prompts when
compression does run. The goal is to delay compression, reduce LLM compression
frequency, and improve post-compression fidelity.

## Architectural Decisions

- **Pattern**: Strategy pattern — all compression strategies implement a common
  `CompressionStrategy` interface. The new `high-density` strategy registers
  alongside existing strategies (`middle-out`, `top-down-truncation`, `one-shot`)
  through the existing `compressionStrategyFactory`.

- **Single Active Strategy**: The system runs one configured strategy at a time,
  not a chain or cascade. This avoids coordination complexity and unpredictable
  interaction between strategies.

- **Strategy-Declared Trigger**: Each strategy declares whether it runs
  continuously (on every turn) or only at a token threshold. The orchestrator
  reads the strategy's `trigger` declaration rather than hardcoding behavior.

- **Lazy Batch Optimization**: Continuous strategies do not mutate history in
  event callbacks. Optimization runs as a batch step at the natural read
  boundary (before the threshold check in `ensureCompressionBeforeSend`).

- **No LLM Calls**: The `high-density` strategy is entirely deterministic —
  `requiresLLM: false`. Both `optimize()` (continuous pruning) and `compress()`
  (threshold-triggered summarization of tool responses) are LLM-free.

- **Data Flow**: Orchestrator (`geminiChat.ts`) → resolves strategy →
  calls `optimize(rawHistory, config)` → applies `DensityResult` to
  `HistoryService` → recalculates tokens → checks threshold → optionally
  calls `compress(context)`.

## Project Structure

```
packages/core/src/core/compression/
  types.ts                        # Modified — StrategyTrigger, DensityResult, DensityConfig, DensityResultMetadata
  compressionStrategyFactory.ts   # Modified — add 'high-density' case
  HighDensityStrategy.ts          # Created — optimize() + compress() implementation
  HighDensityStrategy.test.ts     # Created — behavioral tests
  index.ts                        # Modified — export new types
  MiddleOutStrategy.ts            # Modified — add trigger property, todo injection
  TopDownTruncationStrategy.ts    # Modified — add trigger property
  OneShotStrategy.ts              # Modified — add trigger property, todo injection

packages/core/src/services/history/
  HistoryService.ts               # Modified — applyDensityResult(), getRawHistory(), recalculateTotalTokens()

packages/core/src/core/
  geminiChat.ts                   # Modified — ensureDensityOptimized(), densityDirty flag, todo population

packages/core/src/settings/
  settingsRegistry.ts             # Modified — 4 new density settings

packages/core/src/runtime/
  AgentRuntimeContext.ts           # Modified — density accessor types
  createAgentRuntimeContext.ts     # Modified — density accessor wiring
```

## Technical Environment

- **Type**: CLI Tool (LLxprt Code)
- **Runtime**: Node.js 20.x
- **Key Dependencies**: Existing compression infrastructure, HistoryService,
  settings registry, strategy factory — no new external dependencies
- **Language**: TypeScript (strict mode)

## Integration Points

### Existing Code That Will Use This Feature

- `packages/core/src/core/geminiChat.ts` — Orchestrator calls `optimize()` and
  `compress()` via the strategy interface during `ensureCompressionBeforeSend()`
- `packages/core/src/core/compression/compressionStrategyFactory.ts` — Factory
  returns `HighDensityStrategy` for `getCompressionStrategy('high-density')`
- `packages/core/src/settings/settingsRegistry.ts` — Settings enum auto-includes
  `'high-density'` via the `COMPRESSION_STRATEGIES` tuple derivation
- `packages/core/src/services/history/HistoryService.ts` — `applyDensityResult()`
  mutates history based on `DensityResult` from `optimize()`

### Existing Code To Be Modified (Not Replaced)

- `packages/core/src/core/compression/types.ts` — `CompressionStrategy` interface
  extended with `trigger` property and optional `optimize` method
- `packages/core/src/core/compression/MiddleOutStrategy.ts` — adds `trigger`
  property, todo context injection in compress
- `packages/core/src/core/compression/TopDownTruncationStrategy.ts` — adds `trigger`
- `packages/core/src/core/compression/OneShotStrategy.ts` — adds `trigger`, todo
  context injection
- `packages/core/src/core/geminiChat.ts` — adds density optimization step in
  `ensureCompressionBeforeSend()`, dirty flag tracking, todo/transcript population
  in `buildCompressionContext()`

### User Access Points

- CLI: `/set compression.strategy high-density` — activates the strategy
- CLI: `/set compression.density.readWritePruning true|false` — toggle READ→WRITE pruning
- CLI: `/set compression.density.fileDedupe true|false` — toggle `@` file dedup
- CLI: `/set compression.density.recencyPruning true|false` — toggle tool result recency pruning
- CLI: `/set compression.density.recencyRetention 3` — results to keep per tool type
- Profile: All settings persistable to profiles via `persistToProfile: true`

### Migration Requirements

- None — this is a new opt-in strategy. Existing strategies and their behavior
  are unchanged. The `trigger` property addition is backward-compatible.

## Formal Requirements

See [requirements.md](./requirements.md) for the complete EARS-format requirements.

Summary of requirement groups:
- **REQ-HD-001**: Strategy Interface Extension (trigger, optimize, DensityResult, DensityConfig)
- **REQ-HD-002**: Orchestration (density-before-threshold, dirty flag, emergency path)
- **REQ-HD-003**: HistoryService Changes (applyDensityResult, getRawHistory, recalculateTotalTokens)
- **REQ-HD-004**: High Density Strategy Registration (factory, name, properties)
- **REQ-HD-005**: READ→WRITE Pair Pruning
- **REQ-HD-006**: Duplicate `@` File Inclusion Dedup
- **REQ-HD-007**: Tool Result Recency Pruning
- **REQ-HD-008**: Threshold Compression (compress)
- **REQ-HD-009**: Settings
- **REQ-HD-010**: Enriched Compression Prompts
- **REQ-HD-011**: Todo-Aware Summarization
- **REQ-HD-012**: Transcript Fallback Reference
- **REQ-HD-013**: Failure Modes

## Detailed Design Documents

- [overview.md](./overview.md) — Functional overview: problem statement, design
  principles, strategy behavior, configuration surface, expected outcomes
- [technical-overview.md](./technical-overview.md) — Technical specification:
  interface changes, orchestration flow, HistoryService methods, algorithm
  details, settings wiring, locking considerations
- [requirements.md](./requirements.md) — Complete EARS-format requirements
  (REQ-HD-001 through REQ-HD-013)

## Constraints

- No external HTTP calls in unit tests
- All async operations must have timeouts or be serialized on existing lock chains
- `optimize()` is synchronous — no async operations, no LLM calls
- `compress()` is async but deterministic — no LLM calls
- `applyDensityResult()` must serialize on the existing `tokenizerLock` for token
  recalculation
- Density optimization only runs in the sequential pre-send window — no concurrent
  history mutations

## Performance Requirements

- `optimize()`: O(n) where n = history length, runs at most once per turn
- `applyDensityResult()`: O(n) for full token recalculation
- `compress()`: O(n) — single-pass summarization of tool responses
- No LLM API latency in any high-density path
