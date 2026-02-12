# Plan: High Density Context Compression

Plan ID: PLAN-20260211-HIGHDENSITY
Generated: 2026-02-11
Total Phases: 24
Requirements: REQ-HD-001 through REQ-HD-013

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 01)
2. Defined integration contracts for multi-component features
3. Written integration tests BEFORE unit tests
4. Verified all dependencies and types exist as assumed

## Execution Status

| Phase | ID | Status | Started | Completed | Verified | Semantic? | Notes |
|-------|-----|--------|---------|-----------|----------|-----------|-------|
| 01 | P01 | [ ] | - | - | - | N/A | Preflight verification |
| 02 | P02 | [ ] | - | - | - | N/A | Types & Constants |
| 03 | P03 | [ ] | - | - | - | [ ] | Existing Strategy Updates TDD |
| 04 | P04 | [ ] | - | - | - | [ ] | Existing Strategy Updates Impl |
| 05 | P05 | [ ] | - | - | - | [ ] | HistoryService Extensions TDD |
| 06 | P06 | [ ] | - | - | - | [ ] | HistoryService Extensions Impl |
| 07 | P07 | [ ] | - | - | - | [ ] | READ→WRITE Pruning TDD |
| 08 | P08 | [ ] | - | - | - | [ ] | READ→WRITE Pruning Impl |
| 09 | P09 | [ ] | - | - | - | [ ] | @ File Dedup TDD |
| 10 | P10 | [ ] | - | - | - | [ ] | @ File Dedup Impl |
| 11 | P11 | [ ] | - | - | - | [ ] | Recency Pruning TDD |
| 12 | P12 | [ ] | - | - | - | [ ] | Recency Pruning Impl |
| 13 | P13 | [ ] | - | - | - | [ ] | Threshold Compression TDD |
| 14 | P14 | [ ] | - | - | - | [ ] | Threshold Compression Impl |
| 15 | P15 | [ ] | - | - | - | [ ] | Factory & Registration TDD |
| 16 | P16 | [ ] | - | - | - | [ ] | Factory & Registration Impl |
| 17 | P17 | [ ] | - | - | - | [ ] | Settings & Runtime Accessors TDD |
| 18 | P18 | [ ] | - | - | - | [ ] | Settings & Runtime Accessors Impl |
| 19 | P19 | [ ] | - | - | - | [ ] | Orchestration TDD |
| 20 | P20 | [ ] | - | - | - | [ ] | Orchestration Impl |
| 21 | P21 | [ ] | - | - | - | [ ] | Enriched Prompts |
| 22 | P22 | [ ] | - | - | - | [ ] | Todo-Aware Summarization TDD |
| 23 | P23 | [ ] | - | - | - | [ ] | Todo-Aware Summarization Impl |
| 24 | P24 | [ ] | - | - | - | N/A | Full Verification |

---

# Phase 01: Preflight Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P01`

## Prerequisites

- Required: None (first phase)
- Verification: N/A
- Expected files from previous phase: N/A
- Preflight verification: This IS the preflight verification

## Purpose

Verify ALL assumptions before writing any code.

## Dependency Verification

| Dependency | Check Command | Status |
|------------|---------------|--------|
| vitest | `npm ls vitest` | PENDING |
| node:path | built-in | OK |
| node:fs | built-in | OK |

## Type/Interface Verification

| Type Name | Expected Location | Expected Shape | Verify Command |
|-----------|-------------------|----------------|----------------|
| `IContent` | `packages/core/src/services/history/IContent.ts` | `{ speaker, blocks, metadata? }` | `grep -n 'export interface IContent' packages/core/src/services/history/IContent.ts` |
| `ContentBlock` | `packages/core/src/services/history/IContent.ts` | Union of TextBlock, ToolCallBlock, ToolResponseBlock, etc. | `grep -n 'export type ContentBlock' packages/core/src/services/history/IContent.ts` |
| `ToolCallBlock` | `packages/core/src/services/history/IContent.ts` | `{ type: 'tool_call', id, name, parameters }` | `grep -n 'export interface ToolCallBlock' packages/core/src/services/history/IContent.ts` |
| `ToolResponseBlock` | `packages/core/src/services/history/IContent.ts` | `{ type: 'tool_response', callId, toolName, result }` | `grep -n 'export interface ToolResponseBlock' packages/core/src/services/history/IContent.ts` |
| `CompressionStrategy` | `packages/core/src/core/compression/types.ts` | `{ name, requiresLLM, compress() }` | `grep -n 'export interface CompressionStrategy' packages/core/src/core/compression/types.ts` |
| `CompressionContext` | `packages/core/src/core/compression/types.ts` | `{ history, runtimeContext, ... }` | `grep -n 'export interface CompressionContext' packages/core/src/core/compression/types.ts` |
| `COMPRESSION_STRATEGIES` | `packages/core/src/core/compression/types.ts` | `['middle-out', 'top-down-truncation', 'one-shot'] as const` | `grep -n 'COMPRESSION_STRATEGIES' packages/core/src/core/compression/types.ts` |
| `HistoryService.history` | `packages/core/src/services/history/HistoryService.ts` | `private history: IContent[]` | `grep -n 'private history' packages/core/src/services/history/HistoryService.ts` |
| `HistoryService.tokenizerLock` | `packages/core/src/services/history/HistoryService.ts` | `private tokenizerLock: Promise<void>` | `grep -n 'tokenizerLock' packages/core/src/services/history/HistoryService.ts` |

## Call Path Verification

| Function | Expected Caller | Verify Command |
|----------|-----------------|----------------|
| `getCompressionStrategy()` | `compressionStrategyFactory.ts` | `grep -rn 'getCompressionStrategy' packages/core/src/` |
| `HistoryService.add()` | `geminiChat.ts`, `client.ts` | `grep -rn '\.add(' packages/core/src/services/history/HistoryService.ts` |
| `HistoryService.getCurated()` | `geminiChat.ts` | `grep -rn 'getCurated' packages/core/src/` |
| `MiddleOutStrategy` | `compressionStrategyFactory.ts` | `grep -rn 'MiddleOutStrategy' packages/core/src/core/compression/` |

## Test Infrastructure Verification

| Component | Test File Exists? | Check Command |
|-----------|-------------------|---------------|
| `compressionStrategyFactory` | YES | `ls packages/core/src/core/compression/compressionStrategyFactory.test.ts` |
| `MiddleOutStrategy` | YES | `ls packages/core/src/core/compression/MiddleOutStrategy.test.ts` |
| `TopDownTruncationStrategy` | YES | `ls packages/core/src/core/compression/TopDownTruncationStrategy.test.ts` |
| `OneShotStrategy` | YES | `ls packages/core/src/core/compression/OneShotStrategy.test.ts` |
| `HistoryService` | PENDING | `ls packages/core/src/services/history/HistoryService.test.ts` |

## File Convention Verification

| Convention | Expected | Verify Command |
|------------|----------|----------------|
| Import extensions | `'./types.js'` style | `grep -n "from './" packages/core/src/core/compression/types.ts` |
| Test framework | Vitest (`describe`, `it`, `expect`) | `head -20 packages/core/src/core/compression/compressionStrategyFactory.test.ts` |
| Test co-location | `.test.ts` next to source | `ls packages/core/src/core/compression/*.test.ts` |
| Plan markers | `@plan PLAN-...` (space, not colon) | `grep '@plan ' packages/core/src/core/compression/types.ts` |
| `readonly` on context fields | Yes | `grep 'readonly' packages/core/src/core/compression/types.ts` |
| `as const` on tuples | Yes | `grep 'as const' packages/core/src/core/compression/types.ts` |

## Blocking Issues Found

[Populate during execution — list any issues that MUST be resolved before proceeding]

## Verification Gate

- [ ] All dependencies verified
- [ ] All types match expectations
- [ ] All call paths confirmed
- [ ] Test infrastructure ready
- [ ] File conventions confirmed

IF ANY CHECKBOX IS UNCHECKED: STOP and update plan before proceeding.

## Success Criteria

- All verification table cells populated with actual output
- No MISSING or NO entries that block implementation
- Blocking issues list is empty (or items have workarounds documented)

## Failure Recovery

If this phase fails:
1. Document the specific assumption that was wrong
2. Update the plan phases that depend on the wrong assumption
3. Cannot proceed to Phase 02 until all assumptions are verified

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P01.md`
Contents:
```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Verification: [paste all table outputs]
Blocking Issues: [none / list]
```

---

# Phase 02: Types & Constants

## Phase ID

`PLAN-20260211-HIGHDENSITY.P02`

## Prerequisites

- Required: Phase 01 completed
- Verification: `ls project-plans/issue236hdcompression/.completed/P01.md`
- Expected files from previous phase: `project-plans/issue236hdcompression/.completed/P01.md`
- Preflight verification: Phase 01 MUST be completed before any implementation phase

## Requirements Implemented (Expanded)

### REQ-HD-001.1: Trigger Declaration

**Full Text**: Every `CompressionStrategy` shall declare a `trigger` property of type `StrategyTrigger`, which is either `{ mode: 'threshold'; defaultThreshold: number }` or `{ mode: 'continuous'; defaultThreshold: number }`.

**Behavior**:
- GIVEN: A `CompressionStrategy` implementation
- WHEN: Its `trigger` property is accessed
- THEN: It returns a `StrategyTrigger` with `mode` of `'threshold'` or `'continuous'` and a numeric `defaultThreshold`

**Why This Matters**: Distinguishes strategies that only compress at threshold from those that run continuous density optimization before every send.

### REQ-HD-001.2: Optional Optimize Method

**Full Text**: The `CompressionStrategy` interface shall include an optional `optimize` method with signature `optimize(history: readonly IContent[], config: DensityConfig): DensityResult`.

**Behavior**:
- GIVEN: A `CompressionStrategy` instance
- WHEN: The orchestrator checks for `strategy.optimize`
- THEN: Threshold-only strategies return `undefined` (method absent); continuous strategies return a callable `optimize` function

**Why This Matters**: Allows the orchestrator to conditionally invoke density optimization without requiring all strategies to implement it.

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.

**Behavior**:
- GIVEN: An instance of `MiddleOutStrategy`, `TopDownTruncationStrategy`, or `OneShotStrategy`
- WHEN: The `trigger` property is accessed
- THEN: It returns `{ mode: 'threshold', defaultThreshold: 0.85 }`

**Why This Matters**: Existing strategies continue to behave as threshold-only; their default threshold is made explicit and discoverable.

### REQ-HD-001.4: Existing Strategy Compatibility

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall not implement `optimize`. Their `compress` behavior shall remain unchanged.

**Behavior**:
- GIVEN: An instance of any existing strategy
- WHEN: `strategy.optimize` is checked
- THEN: It is `undefined`
- AND WHEN: `strategy.compress(context)` is called with the same context as before
- THEN: The behavior is identical to the pre-change version

**Why This Matters**: Backward compatibility — existing strategies must not break when the interface is extended.

### REQ-HD-001.5: DensityResult Structure

**Full Text**: The `DensityResult` interface shall contain `removals` (readonly array of indices), `replacements` (readonly map of index to `IContent`), and `metadata` (of type `DensityResultMetadata`).

**Behavior**:
- GIVEN: A `DensityResult` object
- WHEN: Its fields are accessed
- THEN: `removals` is `readonly number[]`, `replacements` is `ReadonlyMap<number, IContent>`, and `metadata` is `DensityResultMetadata`

**Why This Matters**: Provides a structured, type-safe contract for density optimization output that the HistoryService can apply surgically.

### REQ-HD-001.6: DensityResult Conflict Invariant

**Full Text**: An index shall NOT appear in both `removals` and `replacements` within a single `DensityResult`. `applyDensityResult()` shall throw if this invariant is violated.

**Behavior**:
- GIVEN: A `DensityResult` where index N appears in both `removals` and `replacements`
- WHEN: `applyDensityResult()` is called with that result
- THEN: An error is thrown indicating the conflict

**Why This Matters**: Prevents ambiguous operations — an entry cannot be both replaced and removed.

### REQ-HD-001.7: DensityResult Index Bounds

**Full Text**: All indices in `removals` and `replacements` shall be within `[0, history.length)`. `applyDensityResult()` shall throw if any index is out of bounds.

**Behavior**:
- GIVEN: A `DensityResult` with an index >= `history.length` or < 0
- WHEN: `applyDensityResult()` is called
- THEN: An error is thrown indicating the out-of-bounds index

**Why This Matters**: Prevents silent corruption — out-of-bounds splices would produce incorrect history.

### REQ-HD-001.8: DensityResultMetadata

**Full Text**: The `DensityResultMetadata` shall contain `readWritePairsPruned` (number), `fileDeduplicationsPruned` (number), and `recencyPruned` (number).

**Behavior**:
- GIVEN: A `DensityResultMetadata` object
- WHEN: Its fields are accessed
- THEN: All three counters are present and numeric

**Why This Matters**: Enables observability — logging and debugging can report exactly what density optimization did.

### REQ-HD-001.9: DensityConfig Structure

**Full Text**: The `DensityConfig` interface shall contain `readWritePruning` (boolean), `fileDedupe` (boolean), `recencyPruning` (boolean), `recencyRetention` (number), and `workspaceRoot` (string). All fields shall be `readonly`.

**Behavior**:
- GIVEN: A `DensityConfig` object
- WHEN: Its fields are accessed
- THEN: All fields are present, typed correctly, and readonly

**Why This Matters**: Provides a single, immutable configuration object for density optimization, decoupled from the runtime context.

### REQ-HD-001.10: Threshold Precedence

**Full Text**: Where an ephemeral or profile `compression-threshold` setting is set, the system shall use that value. Where no setting is set, the system shall use the strategy's `trigger.defaultThreshold`. Resolution order: ephemeral override → profile setting → strategy default.

**Behavior**:
- GIVEN: A strategy with `trigger.defaultThreshold: 0.85`
- WHEN: No ephemeral/profile compression-threshold is set
- THEN: The system uses `0.85`
- AND WHEN: An ephemeral setting sets compression-threshold to `0.70`
- THEN: The system uses `0.70`

**Why This Matters**: Users can override thresholds without changing strategy, and strategies can declare sensible defaults.

### REQ-HD-011.1: CompressionContext Todo Field

**Full Text**: The `CompressionContext` interface shall include an optional `activeTodos?: readonly Todo[]` field.

**Behavior**:
- GIVEN: A `CompressionContext` being constructed
- WHEN: Active todos are available
- THEN: The `activeTodos` field is populated; when unavailable, it is `undefined`

**Why This Matters**: Enables LLM-based strategies to reference active todos when generating compression summaries, preserving task context.

### REQ-HD-012.1: CompressionContext Transcript Field

**Full Text**: The `CompressionContext` interface shall include an optional `transcriptPath?: string` field.

**Behavior**:
- GIVEN: A `CompressionContext` being constructed
- WHEN: A transcript path is available from the CLI layer
- THEN: The `transcriptPath` field is populated; when unavailable, it is `undefined`

**Why This Matters**: Allows LLM-based strategies to include a pointer to the full pre-compression transcript in summaries.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/types.ts`
  - ADD `StrategyTrigger` type (union of threshold and continuous modes)
  - ADD `DensityConfig` interface (readonly fields)
  - ADD `DensityResult` interface (removals, replacements, metadata)
  - ADD `DensityResultMetadata` interface
  - ADD `trigger: StrategyTrigger` to `CompressionStrategy` interface
  - ADD optional `optimize?` method to `CompressionStrategy` interface
  - ADD `'high-density'` to `COMPRESSION_STRATEGIES` tuple
  - ADD optional `activeTodos?: readonly Todo[]` to `CompressionContext`
  - ADD optional `transcriptPath?: string` to `CompressionContext`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P02`
  - Implements: `@requirement REQ-HD-001.1, REQ-HD-001.2, REQ-HD-001.5, REQ-HD-001.6, REQ-HD-001.7, REQ-HD-001.8, REQ-HD-001.9, REQ-HD-001.10, REQ-HD-011.1, REQ-HD-012.1`

### Required Code Markers

Every new type/interface added in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P02
 * @requirement REQ-HD-001.X
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan PLAN-20260211-HIGHDENSITY.P02" packages/core/src/core/compression/types.ts | wc -l
# Expected: 4+ occurrences (StrategyTrigger, DensityConfig, DensityResult, DensityResultMetadata)

# Check StrategyTrigger type exists
grep -n 'StrategyTrigger' packages/core/src/core/compression/types.ts
# Expected: type definition with threshold and continuous modes

# Check DensityResult interface exists
grep -n 'DensityResult' packages/core/src/core/compression/types.ts
# Expected: interface with removals, replacements, metadata

# Check DensityConfig interface exists
grep -n 'DensityConfig' packages/core/src/core/compression/types.ts
# Expected: interface with readWritePruning, fileDedupe, recencyPruning, recencyRetention, workspaceRoot

# Check high-density in COMPRESSION_STRATEGIES
grep "'high-density'" packages/core/src/core/compression/types.ts
# Expected: 1 match in the tuple

# Check trigger on CompressionStrategy
grep 'trigger:' packages/core/src/core/compression/types.ts
# Expected: readonly trigger: StrategyTrigger in interface

# Check optimize method
grep 'optimize?' packages/core/src/core/compression/types.ts
# Expected: optional method signature

# Check activeTodos
grep 'activeTodos' packages/core/src/core/compression/types.ts
# Expected: optional field in CompressionContext

# Check transcriptPath
grep 'transcriptPath' packages/core/src/core/compression/types.ts
# Expected: optional field in CompressionContext

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: May have errors in strategies that don't yet declare trigger (expected until P04)
```

### Structural Verification Checklist

- [ ] Phase 01 completion marker present
- [ ] All listed types/interfaces created
- [ ] Plan markers added to all new types
- [ ] `readonly` used on all DensityConfig fields
- [ ] `as const` on COMPRESSION_STRATEGIES tuple preserved
- [ ] Import for `Todo` type added (or inline type if not available)
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in types.ts
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/types.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/types.ts
# Expected: No matches

# Check for empty/placeholder types
grep -rn -E "(any;|unknown;|never;|// TODO)" packages/core/src/core/compression/types.ts | grep -v "parameters.*unknown"
# Expected: No matches (unknown in tool parameters is acceptable)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `StrategyTrigger` type has both `threshold` and `continuous` modes with `defaultThreshold`
   - [ ] `DensityConfig` has all 5 fields (`readWritePruning`, `fileDedupe`, `recencyPruning`, `recencyRetention`, `workspaceRoot`), all `readonly`
   - [ ] `DensityResult` has `removals`, `replacements`, and `metadata` fields
   - [ ] `DensityResultMetadata` has all 3 counters
   - [ ] `CompressionStrategy` has `trigger` property and optional `optimize` method
   - [ ] `CompressionContext` has `activeTodos` and `transcriptPath` optional fields
   - [ ] `COMPRESSION_STRATEGIES` tuple includes `'high-density'`
   - [ ] `StrategyTrigger` `defaultThreshold` is `number` (not optional)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Types are fully specified (no `any`, no `unknown` except where semantically correct)
   - [ ] Interfaces have all required fields with correct types

3. **Would the test FAIL if implementation was removed?**
   - [ ] Not directly testable (types are compile-time), but subsequent phases will fail to compile if types are missing or wrong

4. **Is the feature REACHABLE by users?**
   - [ ] Types are exported from `types.ts`
   - [ ] `'high-density'` in `COMPRESSION_STRATEGIES` enables factory resolution and settings validation

5. **What's MISSING?**
   - [ ] Strategy implementations that declare `trigger` (Phase 04)
   - [ ] `HighDensityStrategy` that implements `optimize` (Phase 14/16)

## Success Criteria

- All new types compile (though strategies won't satisfy the interface until P04)
- `COMPRESSION_STRATEGIES` includes `'high-density'`
- `CompressionStrategy` interface has `trigger` and optional `optimize`
- `DensityResult`, `DensityConfig`, `DensityResultMetadata` are exported
- `CompressionContext` has `activeTodos` and `transcriptPath`
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/types.ts`
2. Re-run Phase 02 with corrected type definitions
3. Cannot proceed to Phase 03 until types compile

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P02.md`
Contents:
```markdown
Phase: P02
Completed: YYYY-MM-DD HH:MM
Files Modified: [packages/core/src/core/compression/types.ts — diff stats]
Types Added: StrategyTrigger, DensityConfig, DensityResult, DensityResultMetadata
Verification: [paste of verification command outputs]
```

---

# Phase 03: Existing Strategy Updates TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P02" packages/core/src/core/compression/types.ts`
- Expected files from previous phase: Updated `packages/core/src/core/compression/types.ts` with `StrategyTrigger`, `DensityConfig`, `DensityResult`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.

**Behavior**:
- GIVEN: An instance of `MiddleOutStrategy`
- WHEN: `strategy.trigger` is accessed
- THEN: It returns `{ mode: 'threshold', defaultThreshold: 0.85 }`
- AND GIVEN: An instance of `TopDownTruncationStrategy`
- WHEN: `strategy.trigger` is accessed
- THEN: It returns `{ mode: 'threshold', defaultThreshold: 0.85 }`
- AND GIVEN: An instance of `OneShotStrategy`
- WHEN: `strategy.trigger` is accessed
- THEN: It returns `{ mode: 'threshold', defaultThreshold: 0.85 }`

**Why This Matters**: Makes threshold defaults explicit and verifiable, enabling the orchestrator to resolve thresholds from strategy metadata.

### REQ-HD-001.4: Existing Strategy Compatibility

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall not implement `optimize`. Their `compress` behavior shall remain unchanged.

**Behavior**:
- GIVEN: An instance of any existing strategy
- WHEN: `strategy.optimize` is accessed
- THEN: It is `undefined`
- AND WHEN: `strategy.compress(context)` is called
- THEN: Output is identical to the pre-change version

**Why This Matters**: Zero-regression guarantee — extending the interface must not alter existing behavior.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/MiddleOutStrategy.test.ts`
  - ADD test: `trigger` property returns `{ mode: 'threshold', defaultThreshold: 0.85 }`
  - ADD test: `optimize` property is `undefined`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P03`
  - Implements: `@requirement REQ-HD-001.3, REQ-HD-001.4`

- `packages/core/src/core/compression/TopDownTruncationStrategy.test.ts`
  - ADD test: `trigger` property returns `{ mode: 'threshold', defaultThreshold: 0.85 }`
  - ADD test: `optimize` property is `undefined`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P03`
  - Implements: `@requirement REQ-HD-001.3, REQ-HD-001.4`

- `packages/core/src/core/compression/OneShotStrategy.test.ts`
  - ADD test: `trigger` property returns `{ mode: 'threshold', defaultThreshold: 0.85 }`
  - ADD test: `optimize` property is `undefined`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P03`
  - Implements: `@requirement REQ-HD-001.3, REQ-HD-001.4`

- `packages/core/src/core/compression/compressionStrategyFactory.test.ts`
  - ADD test: factory resolves `'high-density'` to an instance (will fail until P14)
  - ADD test: `COMPRESSION_STRATEGIES` includes `'high-density'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P03`
  - Implements: `@requirement REQ-HD-004.1`

### Required Code Markers

```typescript
describe('trigger property @plan PLAN-20260211-HIGHDENSITY.P03 @requirement REQ-HD-001.3', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist in test files
grep -r "@plan PLAN-20260211-HIGHDENSITY.P03" packages/core/src/core/compression/ | wc -l
# Expected: 4+ occurrences (one per test file)

# Run phase-specific tests (will FAIL — strategies don't have trigger yet)
npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: Tests exist but fail with property access errors (RED)

npx vitest run packages/core/src/core/compression/TopDownTruncationStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: Tests fail (RED)

npx vitest run packages/core/src/core/compression/OneShotStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 02 markers present in types.ts
- [ ] New tests added to all three existing strategy test files
- [ ] Tests follow behavioral pattern (GIVEN/WHEN/THEN in test names or structure)
- [ ] Tests will fail naturally until implementation (RED phase)
- [ ] All tests tagged with plan and requirement IDs

## Success Criteria

- 6+ new tests created (2 per strategy: trigger value, optimize undefined)
- Additional tests in factory for `'high-density'`
- All new tests FAIL with property/method not found (not import errors)
- Tests are tagged with P03 marker

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/*.test.ts`
2. Re-run Phase 03 with corrected test expectations
3. Cannot proceed to Phase 04 until tests exist and fail for the right reason

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P03.md`
Contents:
```markdown
Phase: P03
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 04: Existing Strategy Updates Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P03" packages/core/src/core/compression/`
- Expected files from previous phase: Updated test files for MiddleOutStrategy, TopDownTruncationStrategy, OneShotStrategy
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.

**Behavior**:
- GIVEN: An instance of any existing strategy
- WHEN: `strategy.trigger` is accessed
- THEN: It returns `{ mode: 'threshold', defaultThreshold: 0.85 }`

**Why This Matters**: Makes threshold defaults explicit and discoverable from strategy metadata.

### REQ-HD-001.4: Existing Strategy Compatibility

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall not implement `optimize`. Their `compress` behavior shall remain unchanged.

**Behavior**:
- GIVEN: An instance of any existing strategy
- WHEN: `strategy.optimize` is checked
- THEN: It is `undefined`

**Why This Matters**: Zero-regression guarantee for existing strategies.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };`
  - ADD import for `StrategyTrigger` from `'./types.js'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P04`
  - Implements: `@requirement REQ-HD-001.3`

- `packages/core/src/core/compression/TopDownTruncationStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };`
  - ADD import for `StrategyTrigger` from `'./types.js'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P04`
  - Implements: `@requirement REQ-HD-001.3`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };`
  - ADD import for `StrategyTrigger` from `'./types.js'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P04`
  - Implements: `@requirement REQ-HD-001.3`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P04
 * @requirement REQ-HD-001.3
 */
readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist in impl files
grep -r "@plan PLAN-20260211-HIGHDENSITY.P04" packages/core/src/core/compression/ | wc -l
# Expected: 3 occurrences (one per strategy)

# Check trigger property on all strategies
grep -n 'readonly trigger' packages/core/src/core/compression/MiddleOutStrategy.ts
grep -n 'readonly trigger' packages/core/src/core/compression/TopDownTruncationStrategy.ts
grep -n 'readonly trigger' packages/core/src/core/compression/OneShotStrategy.ts
# Expected: 1 match each

# Run tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts --reporter=verbose 2>&1 | tail -20
npx vitest run packages/core/src/core/compression/TopDownTruncationStrategy.test.ts --reporter=verbose 2>&1 | tail -20
npx vitest run packages/core/src/core/compression/OneShotStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts | grep -v ".test.ts"
# Expected: No new matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts | grep -v ".test.ts"
# Expected: No new matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Each strategy declares `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`
   - [ ] No strategy implements `optimize`
   - [ ] `compress()` behavior is unchanged (no functional modifications)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] `trigger` is a concrete object literal, not a stub

3. **Would the test FAIL if implementation was removed?**
   - [ ] Test checks `strategy.trigger.mode === 'threshold'`
   - [ ] Test checks `strategy.trigger.defaultThreshold === 0.85`
   - [ ] Test checks `strategy.optimize === undefined`

4. **Is the feature REACHABLE by users?**
   - [ ] `trigger` is a public readonly property on each strategy
   - [ ] Strategies are resolved via `getCompressionStrategy()`

5. **What's MISSING?**
   - [ ] Nothing — this phase is complete when all three strategies have `trigger`

#### Integration Points Verified

- [ ] `StrategyTrigger` type imported from `'./types.js'`
- [ ] Each strategy still satisfies `CompressionStrategy` interface
- [ ] Existing tests still pass (no regressions)

## Success Criteria

- All P03 tests pass (GREEN)
- All existing compression tests still pass
- Typecheck passes
- Each strategy has `readonly trigger: StrategyTrigger`

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
2. `git checkout -- packages/core/src/core/compression/TopDownTruncationStrategy.ts`
3. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
4. Re-run Phase 04

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P04.md`
Contents:
```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 05: HistoryService Extensions TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P04" packages/core/src/core/compression/`
- Expected files from previous phase: Updated MiddleOutStrategy.ts, TopDownTruncationStrategy.ts, OneShotStrategy.ts with `trigger`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-003.1: applyDensityResult Method

**Full Text**: The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>` method that applies replacements and removals to the raw history array.

**Behavior**:
- GIVEN: A `HistoryService` with history `[A, B, C, D, E]`
- WHEN: `applyDensityResult({ removals: [1, 3], replacements: new Map([[2, C']]), metadata })` is called
- THEN: The history becomes `[A, C', E]` (B removed, C replaced with C', D removed)

**Why This Matters**: Core mutation API — the density optimizer cannot apply its results without this method.

### REQ-HD-003.2: Replacement Before Removal

**Full Text**: `applyDensityResult()` shall apply replacements before removals, so that removal indices are stable during the replacement pass.

**Behavior**:
- GIVEN: A `DensityResult` with both replacements and removals
- WHEN: `applyDensityResult()` is called
- THEN: Replacements are applied first (by index into the original array), then removals use the same original indices
- AND: Replacement at index 2 + removal at index 3 produces the correct result

**Why This Matters**: Index stability — if removals ran first, replacement indices would shift and target wrong entries.

### REQ-HD-003.3: Reverse-Order Removal

**Full Text**: `applyDensityResult()` shall apply removals in reverse index order (highest first), so that earlier indices remain stable during removal.

**Behavior**:
- GIVEN: Removals `[1, 3, 5]`
- WHEN: Removals are applied
- THEN: Index 5 is removed first, then 3, then 1
- AND: Each splice does not affect the indices of entries yet to be removed

**Why This Matters**: Correct splice ordering — removing index 1 first would shift indices 3 and 5.

### REQ-HD-003.4: Token Recalculation

**Full Text**: After applying removals and replacements, `applyDensityResult()` shall trigger a full token recalculation through the existing `tokenizerLock` promise chain.

**Behavior**:
- GIVEN: `applyDensityResult()` has applied removals/replacements
- WHEN: The method completes (promise resolves)
- THEN: `totalTokens` reflects the actual token count of the mutated history

**Why This Matters**: Token count must be accurate for the subsequent `shouldCompress()` check.

### REQ-HD-003.5: getRawHistory Accessor

**Full Text**: The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]` method that returns a read-only typed view of the backing history array.

**Behavior**:
- GIVEN: A `HistoryService` with entries `[A, B, C]`
- WHEN: `getRawHistory()` is called
- THEN: It returns `[A, B, C]` as `readonly IContent[]`
- AND: The returned array cannot be mutated through the type system

**Why This Matters**: The `optimize()` method needs the raw array (not the curated view that filters empty AI messages) to produce indices that align with `applyDensityResult()`.

### REQ-HD-003.6: recalculateTotalTokens

**Full Text**: The `HistoryService` shall provide an async `recalculateTotalTokens()` method that re-estimates tokens for all entries in the history, running through the `tokenizerLock`.

**Behavior**:
- GIVEN: A `HistoryService` where the history has been mutated externally (via `applyDensityResult`)
- WHEN: `recalculateTotalTokens()` is called
- THEN: It iterates all history entries, estimates tokens for each, sums them, and updates `totalTokens`
- AND: The recalculation runs through `tokenizerLock` to avoid racing with incremental updates

**Why This Matters**: After surgical history edits, the incremental token tracking is stale; a full recount is needed.

## Implementation Tasks

### Files to Create

- `packages/core/src/services/history/HistoryService.density.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P05`
  - MUST include: `@requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-003.4, REQ-HD-003.5, REQ-HD-003.6`
  - Test: `applyDensityResult` applies replacements correctly
  - Test: `applyDensityResult` applies removals correctly
  - Test: `applyDensityResult` applies replacements before removals (combined case)
  - Test: `applyDensityResult` removes in reverse order (verify correct result)
  - Test: `applyDensityResult` throws on conflict (index in both removals and replacements)
  - Test: `applyDensityResult` throws on out-of-bounds index (removal)
  - Test: `applyDensityResult` throws on out-of-bounds index (replacement)
  - Test: `applyDensityResult` recalculates tokens after mutation
  - Test: `applyDensityResult` with empty removals and empty replacements is no-op
  - Test: `getRawHistory` returns the backing array content
  - Test: `getRawHistory` includes entries that `getCurated` would filter
  - Test: `recalculateTotalTokens` updates token count

### Required Code Markers

```typescript
describe('applyDensityResult @plan PLAN-20260211-HIGHDENSITY.P05 @requirement REQ-HD-003.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan PLAN-20260211-HIGHDENSITY.P05" packages/core/src/services/history/ | wc -l
# Expected: 3+ occurrences

# Check test file exists
ls packages/core/src/services/history/HistoryService.density.test.ts
# Expected: exists

# Run tests (will FAIL — methods don't exist yet)
npx vitest run packages/core/src/services/history/HistoryService.density.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail with "not a function" or "property undefined" (RED)
```

### Structural Verification Checklist

- [ ] Phase 04 markers present
- [ ] Test file created at expected path
- [ ] Tests cover all 6 requirements (REQ-HD-003.1 through 003.6)
- [ ] Tests construct real HistoryService instances (no mock theater)
- [ ] Tests will fail naturally until implementation
- [ ] All tests tagged with plan and requirement IDs

## Success Criteria

- 12+ tests created covering all REQ-HD-003 requirements
- Tests use real HistoryService (behavioral, not mocked)
- All tests FAIL with method-not-found (not import/compile errors)
- Tests are tagged with P05 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/services/history/HistoryService.density.test.ts`
2. Re-run Phase 05 with corrected test setup
3. Cannot proceed to Phase 06 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P05.md`
Contents:
```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Created: [HistoryService.density.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 06: HistoryService Extensions Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P06`

## Prerequisites

- Required: Phase 05 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P05" packages/core/src/services/history/`
- Expected files from previous phase: `packages/core/src/services/history/HistoryService.density.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-003.1: applyDensityResult Method

**Full Text**: The `HistoryService` shall provide an `async applyDensityResult(result: DensityResult): Promise<void>` method that applies replacements and removals to the raw history array.

**Behavior**:
- GIVEN: A `HistoryService` with populated history
- WHEN: `applyDensityResult(result)` is called with valid removals and replacements
- THEN: History is mutated in place — replacements applied, entries removed, tokens recalculated

**Why This Matters**: Enables surgical history edits from the density optimizer.

### REQ-HD-003.2: Replacement Before Removal

**Full Text**: `applyDensityResult()` shall apply replacements before removals, so that removal indices are stable during the replacement pass.

**Behavior**: Replacements use indices from the original array. Removals run after, also using original indices but applied highest-first.

**Why This Matters**: Index stability during mutation.

### REQ-HD-003.3: Reverse-Order Removal

**Full Text**: `applyDensityResult()` shall apply removals in reverse index order (highest first).

**Behavior**: `[1, 3, 5].sort(desc)` → splice 5, then 3, then 1.

**Why This Matters**: Prevents index shifting during splice operations.

### REQ-HD-003.4: Token Recalculation

**Full Text**: After applying removals and replacements, `applyDensityResult()` shall trigger a full token recalculation through the existing `tokenizerLock` promise chain.

**Behavior**: After mutations, `recalculateTotalTokens()` is called and awaited.

**Why This Matters**: Stale token counts would cause incorrect compression decisions.

### REQ-HD-003.5: getRawHistory Accessor

**Full Text**: The `HistoryService` shall provide a `getRawHistory(): readonly IContent[]` method.

**Behavior**: Returns the backing `this.history` array typed as `readonly IContent[]`.

**Why This Matters**: `optimize()` needs the un-filtered history for correct index alignment.

### REQ-HD-003.6: recalculateTotalTokens

**Full Text**: The `HistoryService` shall provide an async `recalculateTotalTokens()` method that re-estimates tokens for all entries in the history, running through the `tokenizerLock`.

**Behavior**: Iterates history, estimates tokens per entry, sums, updates `totalTokens`. Runs through `tokenizerLock`.

**Why This Matters**: Full recount after surgical edits.

## Implementation Tasks

### Files to Modify

- `packages/core/src/services/history/HistoryService.ts`
  - ADD method: `async applyDensityResult(result: DensityResult): Promise<void>`
    - Validate: no index in both removals and replacements (throw on conflict)
    - Validate: all indices in bounds (throw on out-of-bounds)
    - Apply replacements first (iterate `result.replacements`, set `this.history[index]`)
    - Apply removals in reverse order (sort descending, splice each)
    - Call `this.recalculateTotalTokens()` and await
  - ADD method: `getRawHistory(): readonly IContent[]`
    - Return `this.history` as `readonly IContent[]`
  - ADD method: `async recalculateTotalTokens(): Promise<void>`
    - Enqueue on `tokenizerLock`
    - Iterate `this.history`, call `estimateContentTokens()` per entry
    - Sum and set `this.totalTokens`
  - ADD import for `DensityResult` from `'../../core/compression/types.js'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P06`
  - Implements: `@requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3, REQ-HD-003.4, REQ-HD-003.5, REQ-HD-003.6`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P06
 * @requirement REQ-HD-003.1, REQ-HD-003.2, REQ-HD-003.3
 */
async applyDensityResult(result: DensityResult): Promise<void> {
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P06" packages/core/src/services/history/HistoryService.ts | wc -l
# Expected: 2+ occurrences

# Check methods exist
grep -n 'applyDensityResult' packages/core/src/services/history/HistoryService.ts
grep -n 'getRawHistory' packages/core/src/services/history/HistoryService.ts
grep -n 'recalculateTotalTokens' packages/core/src/services/history/HistoryService.ts
# Expected: method definitions found

# Run P05 tests — should now PASS (GREEN)
npx vitest run packages/core/src/services/history/HistoryService.density.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors

# Run ALL existing history tests to check for regressions
npx vitest run packages/core/src/services/history/ --reporter=verbose 2>&1 | tail -30
# Expected: All pass
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in new code
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/services/history/HistoryService.ts | grep -i "density\|applyDensity\|getRawHistory\|recalculateTotal"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/services/history/HistoryService.ts | grep -i "density\|applyDensity\|getRawHistory\|recalculateTotal"
# Expected: No matches

# Check for empty returns
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/services/history/HistoryService.ts | grep -i "density\|applyDensity\|getRawHistory\|recalculateTotal"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `applyDensityResult` validates conflict invariant and throws
   - [ ] `applyDensityResult` validates bounds and throws
   - [ ] Replacements applied before removals
   - [ ] Removals applied highest-index-first
   - [ ] Token recalculation runs through `tokenizerLock`
   - [ ] `getRawHistory()` returns `this.history` as readonly

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] `applyDensityResult` actually mutates `this.history`
   - [ ] `recalculateTotalTokens` actually re-sums tokens

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify history content after mutations
   - [ ] Tests verify token counts after recalculation
   - [ ] Tests verify error throwing on invalid input

4. **Is the feature REACHABLE by users?**
   - [ ] Methods are public on `HistoryService`
   - [ ] Will be called from `ensureDensityOptimized()` in later phases

5. **What's MISSING?**
   - [ ] Nothing for this phase — caller (geminiChat) comes in later phases

#### Integration Points Verified

- [ ] `DensityResult` type imported from compression types
- [ ] `tokenizerLock` chaining preserved (no deadlocks)
- [ ] Existing `add()` / `clear()` methods unaffected
- [ ] `estimateContentTokens` accessible for recalculation

#### Edge Cases Verified

- [ ] Empty removals + empty replacements = no-op
- [ ] Negative index rejected
- [ ] Index equal to history.length rejected
- [ ] Index in both removals and replacements rejected

## Success Criteria

- All P05 tests pass (GREEN)
- All existing HistoryService tests still pass
- Typecheck passes
- `applyDensityResult`, `getRawHistory`, `recalculateTotalTokens` exist as public methods

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/services/history/HistoryService.ts`
2. Re-run Phase 06
3. Cannot proceed to Phase 07 until P05 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P06.md`
Contents:
```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Modified: [HistoryService.ts — diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 07: READ→WRITE Pruning TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P07`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P06" packages/core/src/services/history/HistoryService.ts`
- Expected files from previous phase: Updated `HistoryService.ts` with `applyDensityResult`, `getRawHistory`, `recalculateTotalTokens`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-005.1: Stale Read Identification

**Full Text**: When `readWritePruning` is enabled in `DensityConfig`, the `optimize()` method shall identify tool calls where a file was read by a read tool and subsequently written by a write tool later in history.

**Behavior**:
- GIVEN: History contains `[read_file("a.ts"), ..., write_file("a.ts")]`
- WHEN: `optimize()` runs with `readWritePruning: true`
- THEN: The `read_file("a.ts")` tool call and its response are marked for removal

**Why This Matters**: Stale file contents waste context tokens — the file has been modified since the read.

### REQ-HD-005.2: Read Tool Set

**Full Text**: The system shall recognize the following as read tools: `read_file`, `read_line_range`, `read_many_files`, `ast_read_file`.

**Behavior**:
- GIVEN: A tool call with `name` matching one of the read tools
- WHEN: The pruner evaluates it
- THEN: It is treated as a read operation for READ→WRITE analysis

**Why This Matters**: Defines the boundary of what constitutes a "read" in the pruning logic.

### REQ-HD-005.3: Write Tool Set

**Full Text**: The system shall recognize the following as write tools: `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range`.

**Behavior**:
- GIVEN: A tool call with `name` matching one of the write tools
- WHEN: The pruner evaluates it
- THEN: It is treated as a write operation for READ→WRITE analysis

**Why This Matters**: Defines the boundary of what constitutes a "write" in the pruning logic.

### REQ-HD-005.4: File Path Extraction

**Full Text**: The system shall extract file paths from `ToolCallBlock.parameters` using the keys `file_path`, `absolute_path`, or `path` (checked in that order).

**Behavior**:
- GIVEN: A tool call with `parameters: { file_path: '/src/a.ts' }`
- WHEN: The path extractor runs
- THEN: It returns `'/src/a.ts'`
- AND GIVEN: `parameters: { absolute_path: '/src/b.ts' }`
- THEN: It returns `'/src/b.ts'`
- AND GIVEN: `parameters: { path: '/src/c.ts' }`
- THEN: It returns `'/src/c.ts'`
- AND GIVEN: `parameters: { file_path: '/src/a.ts', absolute_path: '/src/b.ts' }`
- THEN: It returns `'/src/a.ts'` (`file_path` takes priority)

**Why This Matters**: Different tools use different parameter names; the extractor must handle all variants.

### REQ-HD-005.5: Path Normalization

**Full Text**: File paths shall be normalized using `path.resolve()` before comparison. The strategy shall compare resolved paths exactly as returned, without case folding.

**Behavior**:
- GIVEN: A read of `'./src/../src/a.ts'` and a write of `'/workspace/src/a.ts'`
- WHEN: Both paths are resolved against the workspace root `/workspace`
- THEN: They resolve to the same path and are matched

**Why This Matters**: Prevents missed matches due to relative path variations.

### REQ-HD-005.6: Stale Read Removal

**Full Text**: When a read tool call's file path has a later write tool call for the same path, the read's tool response block and corresponding tool call block shall be marked for removal.

**Behavior**:
- GIVEN: History `[ai(tool_call:read_file(a.ts)), tool(tool_response:read_file), ..., ai(tool_call:write_file(a.ts)), tool(tool_response:write_file)]`
- WHEN: `optimize()` runs
- THEN: `removals` includes the indices of the read's AI entry (tool_call) and tool entry (tool_response)

**Why This Matters**: Core pruning behavior — removes stale file content from context.

### REQ-HD-005.7: Post-Write Reads Preserved

**Full Text**: Read tool calls that occur after the latest write to the same file shall NOT be marked for removal.

**Behavior**:
- GIVEN: History `[write_file(a.ts), ..., read_file(a.ts)]` (read is after write)
- WHEN: `optimize()` runs
- THEN: The read is NOT in `removals`

**Why This Matters**: Reads after writes reflect the current state — they're not stale.

### REQ-HD-005.8: Block-Level Granularity

**Full Text**: Where an `ai` speaker entry contains multiple tool call blocks and only some are stale reads, the strategy shall replace the entry (removing only the stale tool call blocks) rather than removing the entire entry. The corresponding `tool` speaker entry shall have only the matching `tool_response` blocks removed.

**Behavior**:
- GIVEN: An AI entry with `[tool_call:read_file(a.ts), tool_call:write_file(b.ts)]` where `a.ts` has a later write
- WHEN: `optimize()` runs
- THEN: The AI entry is in `replacements` (not `removals`) with the stale `tool_call` block removed; the tool entry is similarly replaced with only the stale `tool_response` removed

**Why This Matters**: Prevents loss of non-stale tool calls that share an AI entry with stale ones.

### REQ-HD-005.9: Multi-File Tool Handling

**Full Text**: For `read_many_files`, only concrete file paths (no glob characters `*`, `?`, `**`) shall be checked against the write map. If all concrete paths have subsequent writes and no glob entries exist, the entry is removable. Otherwise the entry shall be kept.

**Behavior**:
- GIVEN: `read_many_files({ paths: ['/src/a.ts', '/src/b.ts'] })` and both have later writes
- WHEN: `optimize()` runs
- THEN: The entry is marked for removal
- AND GIVEN: `read_many_files({ paths: ['/src/a.ts', '**/*.ts'] })` and `a.ts` has a later write
- THEN: The entry is NOT removed (glob entry present)

**Why This Matters**: Glob expansions are opaque — we can't know which files were actually read.

### REQ-HD-005.10: Disabled When Config False

**Full Text**: When `readWritePruning` is `false` in `DensityConfig`, no READ→WRITE pair pruning shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `readWritePruning: false`
- WHEN: `optimize()` runs on history with stale reads
- THEN: No removals related to READ→WRITE pairs are produced

**Why This Matters**: User opt-out capability.

### REQ-HD-005.11: Workspace Root Resolution

**Full Text**: Relative paths in tool parameters shall be resolved against `DensityConfig.workspaceRoot`.

**Behavior**:
- GIVEN: A tool call with `parameters: { file_path: 'src/a.ts' }` and `workspaceRoot: '/workspace'`
- WHEN: The path is normalized
- THEN: It resolves to `'/workspace/src/a.ts'`

**Why This Matters**: Ensures consistent path comparison when tools receive relative paths.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/readWritePruning.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P07`
  - MUST include: `@requirement REQ-HD-005.1` through `REQ-HD-005.11`
  - Test: Identifies stale reads with subsequent writes
  - Test: Does not mark reads that occur after the latest write
  - Test: Handles `file_path`, `absolute_path`, `path` parameter keys (priority order)
  - Test: Normalizes paths with `path.resolve()`
  - Test: Block-level granularity — partial AI entry replacement
  - Test: `read_many_files` with all concrete paths written → removable
  - Test: `read_many_files` with glob entry → not removable
  - Test: `read_many_files` with mix of written and unwritten → not removable
  - Test: Disabled when `readWritePruning: false`
  - Test: Relative paths resolved against `workspaceRoot`
  - Test: Skips tool calls with non-object parameters
  - Test: Skips tool calls with no recognizable path key
  - Test: Multiple reads of same file, only pre-write reads removed
  - Test: Multiple writes to same file, only latest write counts
  - Test: Metadata counts accurate (`readWritePairsPruned`)

### Required Code Markers

```typescript
describe('READ→WRITE pruning @plan PLAN-20260211-HIGHDENSITY.P07 @requirement REQ-HD-005.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P07" packages/core/src/core/compression/ | wc -l
# Expected: 5+ occurrences

# Check test file exists
ls packages/core/src/core/compression/readWritePruning.test.ts
# Expected: exists

# Run tests (will FAIL — function doesn't exist yet)
npx vitest run packages/core/src/core/compression/readWritePruning.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 06 markers present in HistoryService.ts
- [ ] Test file created at expected path
- [ ] Tests cover all 11 requirements (REQ-HD-005.1 through 005.11)
- [ ] Tests construct real IContent arrays (no mock theater)
- [ ] Tests use helper functions for building tool call/response entries
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 15+ tests covering all REQ-HD-005 scenarios
- Tests build realistic IContent history arrays with tool_call and tool_response blocks
- All tests FAIL because the pruning function doesn't exist yet (RED)
- Tests are tagged with P07 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/readWritePruning.test.ts`
2. Re-run Phase 07
3. Cannot proceed to Phase 08 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P07.md`
Contents:
```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Created: [readWritePruning.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 08: READ→WRITE Pruning Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P08`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P07" packages/core/src/core/compression/readWritePruning.test.ts`
- Expected files from previous phase: `packages/core/src/core/compression/readWritePruning.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-005.1: Stale Read Identification

**Full Text**: When `readWritePruning` is enabled in `DensityConfig`, the `optimize()` method shall identify tool calls where a file was read by a read tool and subsequently written by a write tool later in history.

**Behavior**:
- GIVEN: History contains `[read_file("a.ts"), ..., write_file("a.ts")]`
- WHEN: `optimize()` runs with `readWritePruning: true`
- THEN: The `read_file("a.ts")` tool call and its response are marked for removal

**Why This Matters**: Stale file contents waste context tokens — the file has been modified since the read.

### REQ-HD-005.2: Read Tool Set

**Full Text**: The system shall recognize the following as read tools: `read_file`, `read_line_range`, `read_many_files`, `ast_read_file`.

**Behavior**:
- GIVEN: A tool call with `name` matching one of the read tools
- WHEN: The pruner evaluates it
- THEN: It is treated as a read operation for READ→WRITE analysis

**Why This Matters**: Defines the boundary of what constitutes a "read" in the pruning logic.

### REQ-HD-005.3: Write Tool Set

**Full Text**: The system shall recognize the following as write tools: `write_file`, `ast_edit`, `replace`, `insert_at_line`, `delete_line_range`.

**Behavior**:
- GIVEN: A tool call with `name` matching one of the write tools
- WHEN: The pruner evaluates it
- THEN: It is treated as a write operation for READ→WRITE analysis

**Why This Matters**: Defines the boundary of what constitutes a "write" in the pruning logic.

### REQ-HD-005.4: File Path Extraction

**Full Text**: The system shall extract file paths from `ToolCallBlock.parameters` using the keys `file_path`, `absolute_path`, or `path` (checked in that order).

**Behavior**:
- GIVEN: A tool call with `parameters: { file_path: '/src/a.ts' }`
- WHEN: The path extractor runs
- THEN: It returns `'/src/a.ts'`
- AND GIVEN: `parameters: { absolute_path: '/src/b.ts' }`
- THEN: It returns `'/src/b.ts'`
- AND GIVEN: `parameters: { path: '/src/c.ts' }`
- THEN: It returns `'/src/c.ts'`
- AND GIVEN: `parameters: { file_path: '/src/a.ts', absolute_path: '/src/b.ts' }`
- THEN: It returns `'/src/a.ts'` (`file_path` takes priority)

**Why This Matters**: Different tools use different parameter names; the extractor must handle all variants.

### REQ-HD-005.5: Path Normalization

**Full Text**: File paths shall be normalized using `path.resolve()` before comparison. The strategy shall compare resolved paths exactly as returned, without case folding.

**Behavior**:
- GIVEN: A read of `'./src/../src/a.ts'` and a write of `'/workspace/src/a.ts'`
- WHEN: Both paths are resolved against the workspace root `/workspace`
- THEN: They resolve to the same path and are matched

**Why This Matters**: Prevents missed matches due to relative path variations.

### REQ-HD-005.6: Stale Read Removal

**Full Text**: When a read tool call's file path has a later write tool call for the same path, the read's tool response block and corresponding tool call block shall be marked for removal.

**Behavior**:
- GIVEN: History `[ai(tool_call:read_file(a.ts)), tool(tool_response:read_file), ..., ai(tool_call:write_file(a.ts)), tool(tool_response:write_file)]`
- WHEN: `optimize()` runs
- THEN: `removals` includes the indices of the read's AI entry (tool_call) and tool entry (tool_response)

**Why This Matters**: Core pruning behavior — removes stale file content from context.

### REQ-HD-005.7: Post-Write Reads Preserved

**Full Text**: Read tool calls that occur after the latest write to the same file shall NOT be marked for removal.

**Behavior**:
- GIVEN: History `[write_file(a.ts), ..., read_file(a.ts)]` (read is after write)
- WHEN: `optimize()` runs
- THEN: The read is NOT in `removals`

**Why This Matters**: Reads after writes reflect the current state — they're not stale.

### REQ-HD-005.8: Block-Level Granularity

**Full Text**: Where an `ai` speaker entry contains multiple tool call blocks and only some are stale reads, the strategy shall replace the entry (removing only the stale tool call blocks) rather than removing the entire entry. The corresponding `tool` speaker entry shall have only the matching `tool_response` blocks removed.

**Behavior**:
- GIVEN: An AI entry with `[tool_call:read_file(a.ts), tool_call:write_file(b.ts)]` where `a.ts` has a later write
- WHEN: `optimize()` runs
- THEN: The AI entry is in `replacements` (not `removals`) with the stale `tool_call` block removed; the tool entry is similarly replaced with only the stale `tool_response` removed

**Why This Matters**: Prevents loss of non-stale tool calls that share an AI entry with stale ones.

### REQ-HD-005.9: Multi-File Tool Handling

**Full Text**: For `read_many_files`, only concrete file paths (no glob characters `*`, `?`, `**`) shall be checked against the write map. If all concrete paths have subsequent writes and no glob entries exist, the entry is removable. Otherwise the entry shall be kept.

**Behavior**:
- GIVEN: `read_many_files({ paths: ['/src/a.ts', '/src/b.ts'] })` and both have later writes
- WHEN: `optimize()` runs
- THEN: The entry is marked for removal
- AND GIVEN: `read_many_files({ paths: ['/src/a.ts', '**/*.ts'] })` and `a.ts` has a later write
- THEN: The entry is NOT removed (glob entry present)

**Why This Matters**: Glob expansions are opaque — we can't know which files were actually read.

### REQ-HD-005.10: Disabled When Config False

**Full Text**: When `readWritePruning` is `false` in `DensityConfig`, no READ→WRITE pair pruning shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `readWritePruning: false`
- WHEN: `optimize()` runs on history with stale reads
- THEN: No removals related to READ→WRITE pairs are produced

**Why This Matters**: User opt-out capability.

### REQ-HD-005.11: Workspace Root Resolution

**Full Text**: Relative paths in tool parameters shall be resolved against `DensityConfig.workspaceRoot`.

**Behavior**:
- GIVEN: A tool call with `parameters: { file_path: 'src/a.ts' }` and `workspaceRoot: '/workspace'`
- WHEN: The path is normalized
- THEN: It resolves to `'/workspace/src/a.ts'`

**Why This Matters**: Ensures consistent path comparison when tools receive relative paths.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/readWritePruning.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P08`
  - MUST include: `@requirement REQ-HD-005.1` through `REQ-HD-005.11`
  - EXPORT: `pruneReadWritePairs(history: readonly IContent[], config: DensityConfig): { removals: number[]; replacements: Map<number, IContent>; prunedCount: number }`
  - Internal helpers:
    - `extractFilePath(params: unknown): string | undefined` — checks `file_path`, `absolute_path`, `path` in order
    - `isGlobPattern(p: string): boolean` — checks for `*`, `?`, `**`
    - `buildWriteMap(history, config): Map<string, number>` — walks history, maps resolved paths to latest write index
    - Main function: walks history forward, identifies stale reads, builds removals and replacements
  - Uses `import { resolve } from 'node:path'` for path normalization
  - READ_TOOLS and WRITE_TOOLS constants

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P08
 * @requirement REQ-HD-005.1, REQ-HD-005.2, REQ-HD-005.3, REQ-HD-005.4, REQ-HD-005.5
 * @requirement REQ-HD-005.6, REQ-HD-005.7, REQ-HD-005.8, REQ-HD-005.9, REQ-HD-005.10, REQ-HD-005.11
 */
export function pruneReadWritePairs(
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P08" packages/core/src/core/compression/readWritePruning.ts | wc -l
# Expected: 2+ occurrences

# Check exported function
grep -n 'export function pruneReadWritePairs' packages/core/src/core/compression/readWritePruning.ts
# Expected: 1 match

# Check constants
grep -n 'READ_TOOLS\|WRITE_TOOLS' packages/core/src/core/compression/readWritePruning.ts
# Expected: Both defined

# Run P07 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/readWritePruning.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/readWritePruning.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/readWritePruning.ts
# Expected: No matches

# Check for empty returns
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/readWritePruning.ts
# Expected: No matches (early returns for disabled config OK, but not stubs)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Builds write map from WRITE_TOOLS tool calls
   - [ ] Walks forward checking READ_TOOLS against write map
   - [ ] Extracts paths via `file_path` → `absolute_path` → `path` priority
   - [ ] Normalizes with `path.resolve(workspaceRoot, extractedPath)`
   - [ ] Handles block-level granularity (partial AI entry replacement)
   - [ ] Handles `read_many_files` glob detection
   - [ ] Returns empty when `readWritePruning: false`
   - [ ] Skips malformed parameters

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Function actually walks history and computes removals
   - [ ] Path resolution uses `node:path` `resolve()`

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify specific indices in `removals`
   - [ ] Tests verify replacement content has stale blocks removed
   - [ ] Tests verify metadata count accuracy

4. **Is the feature REACHABLE by users?**
   - [ ] Will be called from `HighDensityStrategy.optimize()` in later phases
   - [ ] Function is exported

5. **What's MISSING?**
   - [ ] Integration with `HighDensityStrategy` (Phase 14)

#### Edge Cases Verified

- [ ] Empty history → empty result
- [ ] No reads → empty result
- [ ] No writes → empty result
- [ ] Non-object parameters → skipped
- [ ] Missing path keys → skipped

## Success Criteria

- All P07 tests pass (GREEN)
- Typecheck passes
- `pruneReadWritePairs` is exported and functional
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/readWritePruning.ts`
2. Re-run Phase 08
3. Cannot proceed to Phase 09 until P07 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P08.md`
Contents:
```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Created: [readWritePruning.ts — line count]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 09: @ File Dedup TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P09`

## Prerequisites

- Required: Phase 08 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P08" packages/core/src/core/compression/readWritePruning.ts`
- Expected files from previous phase: `packages/core/src/core/compression/readWritePruning.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-006.1: Inclusion Detection

**Full Text**: When `fileDedupe` is enabled in `DensityConfig`, the `optimize()` method shall identify `@` file inclusions in human messages by matching the `--- <filepath> ---` ... `--- End of content ---` delimiter pattern in text blocks.

**Behavior**:
- GIVEN: A human message containing `"Look at this\n--- src/a.ts ---\nconst x = 1;\n--- End of content ---\nMore text"`
- WHEN: The dedup function scans it
- THEN: It identifies `src/a.ts` as an included file at this history index

**Why This Matters**: Detects `@` file inclusions so duplicates can be pruned.

### REQ-HD-006.2: Latest Inclusion Preserved

**Full Text**: When the same file path is `@`-included multiple times across different human messages, the most recent inclusion shall be preserved. All earlier inclusions of the same file shall have their file content portion removed.

**Behavior**:
- GIVEN: Human message at index 2 includes `--- a.ts ---` content, and human message at index 8 also includes `--- a.ts ---` content
- WHEN: Dedup runs
- THEN: Index 2 is in `replacements` with the `a.ts` content stripped; index 8 is untouched

**Why This Matters**: Earlier inclusions are stale — the user re-included the file because they wanted the latest version.

### REQ-HD-006.3: Replacement Not Removal

**Full Text**: Dedup shall use `replacements` (modified `IContent` with file content stripped from text blocks) rather than `removals` (the human message may contain other text that must be preserved).

**Behavior**:
- GIVEN: A human message with user text AND a file inclusion
- WHEN: The file inclusion is a duplicate
- THEN: The entry is in `replacements` (user text preserved, file content stripped), NOT in `removals`

**Why This Matters**: Human messages may contain instructions alongside file inclusions; removing the entire message would lose those instructions.

### REQ-HD-006.4: Disabled When Config False

**Full Text**: When `fileDedupe` is `false` in `DensityConfig`, no deduplication shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `fileDedupe: false`
- WHEN: Dedup runs on history with duplicate inclusions
- THEN: No replacements related to file dedup are produced

**Why This Matters**: User opt-out capability.

### REQ-HD-006.5: Fail-Safe Heuristic

**Full Text**: The delimiter matching shall require both opening (`--- filepath ---`) and closing (`--- End of content ---`) markers. If markers do not pair correctly, the text block shall be left unchanged.

**Behavior**:
- GIVEN: A text block with `--- a.ts ---` but no `--- End of content ---`
- WHEN: Dedup scans it
- THEN: It does not treat this as an inclusion (left unchanged)
- AND GIVEN: A text block with `--- End of content ---` but no opening marker
- THEN: It is also left unchanged

**Why This Matters**: Prevents incorrect content stripping when delimiter-like text appears in user messages.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/fileDedup.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P09`
  - MUST include: `@requirement REQ-HD-006.1` through `REQ-HD-006.5`
  - Test: Detects single `@` file inclusion in human message
  - Test: Detects multiple file inclusions in a single human message
  - Test: Preserves most recent inclusion, strips earlier duplicates
  - Test: Uses replacements (not removals) — user text preserved
  - Test: Multiple different files — only duplicates stripped
  - Test: Disabled when `fileDedupe: false`
  - Test: Unpaired opening marker (no `--- End of content ---`) → no dedup
  - Test: Unpaired closing marker → no dedup
  - Test: Non-human messages ignored
  - Test: File paths are compared exactly (case-sensitive)
  - Test: Metadata counts accurate (`fileDeduplicationsPruned`)

### Required Code Markers

```typescript
describe('@ file dedup @plan PLAN-20260211-HIGHDENSITY.P09 @requirement REQ-HD-006.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P09" packages/core/src/core/compression/ | wc -l
# Expected: 3+ occurrences

# Check test file exists
ls packages/core/src/core/compression/fileDedup.test.ts
# Expected: exists

# Run tests (will FAIL — function doesn't exist yet)
npx vitest run packages/core/src/core/compression/fileDedup.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 08 markers present in readWritePruning.ts
- [ ] Test file created at expected path
- [ ] Tests cover all 5 requirements (REQ-HD-006.1 through 006.5)
- [ ] Tests construct real IContent arrays with text blocks containing delimiter patterns
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 11+ tests covering all REQ-HD-006 scenarios
- Tests build realistic human message IContent with `@` inclusion patterns
- All tests FAIL because the dedup function doesn't exist yet (RED)
- Tests are tagged with P09 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/fileDedup.test.ts`
2. Re-run Phase 09
3. Cannot proceed to Phase 10 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P09.md`
Contents:
```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Created: [fileDedup.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 10: @ File Dedup Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P10`

## Prerequisites

- Required: Phase 09 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P09" packages/core/src/core/compression/fileDedup.test.ts`
- Expected files from previous phase: `packages/core/src/core/compression/fileDedup.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-006.1: Inclusion Detection

**Full Text**: When `fileDedupe` is enabled in `DensityConfig`, the `optimize()` method shall identify `@` file inclusions in human messages by matching the `--- <filepath> ---` ... `--- End of content ---` delimiter pattern in text blocks.

**Behavior**:
- GIVEN: A human message containing `"Look at this
--- src/a.ts ---
const x = 1;
--- End of content ---
More text"`
- WHEN: The dedup function scans it
- THEN: It identifies `src/a.ts` as an included file at this history index

**Why This Matters**: Detects `@` file inclusions so duplicates can be pruned.

### REQ-HD-006.2: Latest Inclusion Preserved

**Full Text**: When the same file path is `@`-included multiple times across different human messages, the most recent inclusion shall be preserved. All earlier inclusions of the same file shall have their file content portion removed.

**Behavior**:
- GIVEN: Human message at index 2 includes `--- a.ts ---` content, and human message at index 8 also includes `--- a.ts ---` content
- WHEN: Dedup runs
- THEN: Index 2 is in `replacements` with the `a.ts` content stripped; index 8 is untouched

**Why This Matters**: Earlier inclusions are stale — the user re-included the file because they wanted the latest version.

### REQ-HD-006.3: Replacement Not Removal

**Full Text**: Dedup shall use `replacements` (modified `IContent` with file content stripped from text blocks) rather than `removals` (the human message may contain other text that must be preserved).

**Behavior**:
- GIVEN: A human message with user text AND a file inclusion
- WHEN: The file inclusion is a duplicate
- THEN: The entry is in `replacements` (user text preserved, file content stripped), NOT in `removals`

**Why This Matters**: Human messages may contain instructions alongside file inclusions; removing the entire message would lose those instructions.

### REQ-HD-006.4: Disabled When Config False

**Full Text**: When `fileDedupe` is `false` in `DensityConfig`, no deduplication shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `fileDedupe: false`
- WHEN: Dedup runs on history with duplicate inclusions
- THEN: No replacements related to file dedup are produced

**Why This Matters**: User opt-out capability.

### REQ-HD-006.5: Fail-Safe Heuristic

**Full Text**: The delimiter matching shall require both opening (`--- filepath ---`) and closing (`--- End of content ---`) markers. If markers do not pair correctly, the text block shall be left unchanged.

**Behavior**:
- GIVEN: A text block with `--- a.ts ---` but no `--- End of content ---`
- WHEN: Dedup scans it
- THEN: It does not treat this as an inclusion (left unchanged)
- AND GIVEN: A text block with `--- End of content ---` but no opening marker
- THEN: It is also left unchanged

**Why This Matters**: Prevents incorrect content stripping when delimiter-like text appears in user messages.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/fileDedup.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P10`
  - MUST include: `@requirement REQ-HD-006.1` through `REQ-HD-006.5`
  - EXPORT: `deduplicateFileInclusions(history: readonly IContent[], config: DensityConfig): { replacements: Map<number, IContent>; dedupCount: number }`
  - Internal helpers:
    - `extractInclusions(text: string): Array<{ filePath: string; start: number; end: number }>` — regex-based extraction of `--- filepath ---` ... `--- End of content ---` blocks
    - `stripInclusions(text: string, filePaths: string[]): string` — removes specific file inclusion blocks from text
  - Logic:
    1. Walk human messages, extract file inclusions per message
    2. Build `Map<string, number>` of file path to latest inclusion index
    3. For messages with inclusions of files that have a later inclusion, create replacement IContent with those file blocks stripped

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P10
 * @requirement REQ-HD-006.1, REQ-HD-006.2, REQ-HD-006.3, REQ-HD-006.4, REQ-HD-006.5
 */
export function deduplicateFileInclusions(
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P10" packages/core/src/core/compression/fileDedup.ts | wc -l
# Expected: 2+ occurrences

# Check exported function
grep -n 'export function deduplicateFileInclusions' packages/core/src/core/compression/fileDedup.ts
# Expected: 1 match

# Run P09 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/fileDedup.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/fileDedup.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/fileDedup.ts
# Expected: No matches

# Check for empty returns
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/fileDedup.ts
# Expected: No matches (early return for disabled config is OK with empty Map)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Detects `--- filepath ---` / `--- End of content ---` patterns
   - [ ] Builds latest-inclusion map by file path
   - [ ] Strips earlier duplicate inclusions from text blocks
   - [ ] Preserves user text outside inclusion markers
   - [ ] Returns replacements, not removals
   - [ ] Returns empty when `fileDedupe: false`
   - [ ] Requires both opening and closing markers (fail-safe)

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Regex actually matches delimiter patterns
   - [ ] Strip function actually removes content

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify replacement content has file sections stripped
   - [ ] Tests verify user text is preserved
   - [ ] Tests verify metadata count accuracy

4. **Is the feature REACHABLE by users?**
   - [ ] Will be called from `HighDensityStrategy.optimize()` in later phases
   - [ ] Function is exported

5. **What's MISSING?**
   - [ ] Integration with `HighDensityStrategy` (Phase 14)

#### Edge Cases Verified

- [ ] Empty history → empty result
- [ ] No human messages → empty result
- [ ] No inclusions → empty result
- [ ] Single inclusion (no duplicates) → empty result
- [ ] Unpaired markers → no stripping

## Success Criteria

- All P09 tests pass (GREEN)
- Typecheck passes
- `deduplicateFileInclusions` is exported and functional
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/fileDedup.ts`
2. Re-run Phase 10
3. Cannot proceed to Phase 11 until P09 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P10.md`
Contents:
```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Created: [fileDedup.ts — line count]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 11: Recency Pruning TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P10" packages/core/src/core/compression/fileDedup.ts`
- Expected files from previous phase: `packages/core/src/core/compression/fileDedup.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-007.1: Recency Window

**Full Text**: When `recencyPruning` is enabled in `DensityConfig`, the `optimize()` method shall count tool responses per tool name walking history in reverse. For each tool type, results beyond the `recencyRetention` count shall have their response content replaced with a pointer string.

**Behavior**:
- GIVEN: History with 5 `read_file` tool responses and `recencyRetention: 3`
- WHEN: `optimize()` runs with `recencyPruning: true`
- THEN: The 2 oldest `read_file` responses have their content replaced with the pointer string; the 3 most recent are untouched

**Why This Matters**: Older tool results of the same type are less likely to be relevant; compacting them saves tokens.

### REQ-HD-007.2: Pointer String

**Full Text**: The replacement pointer string shall be: `"[Result pruned — re-run tool to retrieve]"`.

**Behavior**:
- GIVEN: A tool response marked for recency pruning
- WHEN: The replacement is created
- THEN: The `result` field of the `ToolResponseBlock` is replaced with `"[Result pruned — re-run tool to retrieve]"`

**Why This Matters**: Users and the AI see a clear indicator that data was pruned and how to recover it.

### REQ-HD-007.3: Structure Preservation

**Full Text**: Recency pruning shall use `replacements` (preserving tool call and tool response structure). It shall NOT remove the `tool_call` or `tool_response` entries — only the response payload content is replaced.

**Behavior**:
- GIVEN: A tool entry with a `tool_response` block
- WHEN: Recency pruning replaces its content
- THEN: The entry remains in history (not in `removals`), in `replacements` with all fields intact except `result`

**Why This Matters**: Preserves the conversation structure — the AI can see which tools were called and when, just not the full result.

### REQ-HD-007.4: Default Retention

**Full Text**: The default value for `recencyRetention` shall be 3.

**Behavior**:
- GIVEN: No explicit `recencyRetention` configuration
- WHEN: The default is applied
- THEN: The most recent 3 results per tool type are preserved

**Why This Matters**: Sensible default — keeps enough context for iterative tool usage patterns.

### REQ-HD-007.5: Default Disabled

**Full Text**: The default value for `recencyPruning` shall be `false`.

**Behavior**:
- GIVEN: No explicit `recencyPruning` configuration
- WHEN: The default is applied
- THEN: No recency pruning occurs

**Why This Matters**: Conservative default — pruning is opt-in to avoid surprises.

### REQ-HD-007.6: Disabled When Config False

**Full Text**: When `recencyPruning` is `false` in `DensityConfig`, no recency pruning shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `recencyPruning: false`
- WHEN: Optimize runs on history with many tool responses
- THEN: No replacements related to recency pruning are produced

**Why This Matters**: User opt-out capability.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/recencyPruning.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P11`
  - MUST include: `@requirement REQ-HD-007.1` through `REQ-HD-007.6`
  - Test: Prunes oldest tool responses beyond retention count
  - Test: Preserves the N most recent results per tool type
  - Test: Different tool types tracked independently
  - Test: Pointer string is exactly `"[Result pruned — re-run tool to retrieve]"`
  - Test: Uses replacements, not removals (structure preserved)
  - Test: `tool_call` blocks in AI entries are NOT modified
  - Test: Disabled when `recencyPruning: false`
  - Test: `recencyRetention` of 1 keeps only the latest per tool type
  - Test: `recencyRetention` less than 1 treated as 1 (REQ-HD-013.6)
  - Test: Tool responses without `toolName` are skipped
  - Test: Metadata counts accurate (`recencyPruned`)
  - Test: Mixed tool types — correct per-type counting

### Required Code Markers

```typescript
describe('recency pruning @plan PLAN-20260211-HIGHDENSITY.P11 @requirement REQ-HD-007.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P11" packages/core/src/core/compression/ | wc -l
# Expected: 3+ occurrences

# Check test file exists
ls packages/core/src/core/compression/recencyPruning.test.ts
# Expected: exists

# Run tests (will FAIL — function doesn't exist yet)
npx vitest run packages/core/src/core/compression/recencyPruning.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 10 markers present in fileDedup.ts
- [ ] Test file created at expected path
- [ ] Tests cover all 6 requirements (REQ-HD-007.1 through 007.6)
- [ ] Tests construct real IContent arrays with tool_response blocks
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 12+ tests covering all REQ-HD-007 scenarios
- Tests build realistic tool response IContent
- All tests FAIL because the pruning function doesn't exist yet (RED)
- Tests are tagged with P11 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/recencyPruning.test.ts`
2. Re-run Phase 11
3. Cannot proceed to Phase 12 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P11.md`
Contents:
```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created: [recencyPruning.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 12: Recency Pruning Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P11" packages/core/src/core/compression/recencyPruning.test.ts`
- Expected files from previous phase: `packages/core/src/core/compression/recencyPruning.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-007.1: Recency Window

**Full Text**: When `recencyPruning` is enabled in `DensityConfig`, the `optimize()` method shall count tool responses per tool name walking history in reverse. For each tool type, results beyond the `recencyRetention` count shall have their response content replaced with a pointer string.

**Behavior**:
- GIVEN: History with 5 `read_file` tool responses and `recencyRetention: 3`
- WHEN: `optimize()` runs with `recencyPruning: true`
- THEN: The 2 oldest `read_file` responses have their content replaced with the pointer string; the 3 most recent are untouched

**Why This Matters**: Older tool results of the same type are less likely to be relevant; compacting them saves tokens.

### REQ-HD-007.2: Pointer String

**Full Text**: The replacement pointer string shall be: `"[Result pruned — re-run tool to retrieve]"`.

**Behavior**:
- GIVEN: A tool response marked for recency pruning
- WHEN: The replacement is created
- THEN: The `result` field of the `ToolResponseBlock` is replaced with `"[Result pruned — re-run tool to retrieve]"`

**Why This Matters**: Users and the AI see a clear indicator that data was pruned and how to recover it.

### REQ-HD-007.3: Structure Preservation

**Full Text**: Recency pruning shall use `replacements` (preserving tool call and tool response structure). It shall NOT remove the `tool_call` or `tool_response` entries — only the response payload content is replaced.

**Behavior**:
- GIVEN: A tool entry with a `tool_response` block
- WHEN: Recency pruning replaces its content
- THEN: The entry remains in history (not in `removals`), in `replacements` with all fields intact except `result`

**Why This Matters**: Preserves the conversation structure — the AI can see which tools were called and when, just not the full result.

### REQ-HD-007.4: Default Retention

**Full Text**: The default value for `recencyRetention` shall be 3.

**Behavior**:
- GIVEN: No explicit `recencyRetention` configuration
- WHEN: The default is applied
- THEN: The most recent 3 results per tool type are preserved

**Why This Matters**: Sensible default — keeps enough context for iterative tool usage patterns.

### REQ-HD-007.5: Default Disabled

**Full Text**: The default value for `recencyPruning` shall be `false`.

**Behavior**:
- GIVEN: No explicit `recencyPruning` configuration
- WHEN: The default is applied
- THEN: No recency pruning occurs

**Why This Matters**: Conservative default — pruning is opt-in to avoid surprises.

### REQ-HD-007.6: Disabled When Config False

**Full Text**: When `recencyPruning` is `false` in `DensityConfig`, no recency pruning shall occur.

**Behavior**:
- GIVEN: `DensityConfig` with `recencyPruning: false`
- WHEN: Optimize runs on history with many tool responses
- THEN: No replacements related to recency pruning are produced

**Why This Matters**: User opt-out capability.

### REQ-HD-013.6: Invalid Recency Retention

**Full Text**: Where `recencyRetention` in `DensityConfig` is less than 1, the system shall treat it as 1 (retain at least the most recent result per tool type).

**Behavior**:
- GIVEN: `DensityConfig` with `recencyRetention: 0`
- WHEN: Recency pruning runs
- THEN: It behaves as if `recencyRetention` were 1

**Why This Matters**: Prevents accidental removal of all tool results.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/recencyPruning.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P12`
  - MUST include: `@requirement REQ-HD-007.1` through `REQ-HD-007.6`, `REQ-HD-013.6`
  - EXPORT: `pruneByRecency(history: readonly IContent[], config: DensityConfig): { replacements: Map<number, IContent>; prunedCount: number }`
  - Constants:
    - `PRUNED_POINTER = '[Result pruned — re-run tool to retrieve]' as const`
  - Logic:
    1. If `recencyPruning` is false, return empty
    2. Clamp `recencyRetention` to `Math.max(1, config.recencyRetention)`
    3. Walk history in reverse, counting tool responses per `toolName`
    4. For each tool type, once count exceeds retention, mark the entry for replacement
    5. Build replacement IContent: clone the tool entry, replace the `tool_response` block's `result` with `PRUNED_POINTER`
    6. Return replacements map and pruned count

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P12
 * @requirement REQ-HD-007.1, REQ-HD-007.2, REQ-HD-007.3, REQ-HD-007.4, REQ-HD-007.5, REQ-HD-007.6
 * @requirement REQ-HD-013.6
 */
export function pruneByRecency(
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P12" packages/core/src/core/compression/recencyPruning.ts | wc -l
# Expected: 2+ occurrences

# Check exported function
grep -n 'export function pruneByRecency' packages/core/src/core/compression/recencyPruning.ts
# Expected: 1 match

# Check pointer constant
grep -n 'PRUNED_POINTER' packages/core/src/core/compression/recencyPruning.ts
# Expected: defined

# Run P11 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/recencyPruning.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/recencyPruning.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/recencyPruning.ts
# Expected: No matches

# Check for empty returns
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/recencyPruning.ts
# Expected: No matches (early return for disabled config with empty Map is acceptable)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Walks history in reverse, counting per tool type
   - [ ] Beyond retention count, replaces `result` with pointer string
   - [ ] Pointer string is exactly `"[Result pruned — re-run tool to retrieve]"`
   - [ ] Uses replacements, not removals (structure preserved)
   - [ ] `tool_call` blocks in AI entries are untouched
   - [ ] Returns empty when `recencyPruning: false`
   - [ ] Clamps `recencyRetention` to at least 1

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Function actually counts and replaces tool response content
   - [ ] Cloned IContent has modified `result` field

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify specific indices in replacements
   - [ ] Tests verify replacement content has pointer string
   - [ ] Tests verify original entries are preserved for recent results
   - [ ] Tests verify metadata count accuracy

4. **Is the feature REACHABLE by users?**
   - [ ] Will be called from `HighDensityStrategy.optimize()` in later phases
   - [ ] Function is exported

5. **What's MISSING?**
   - [ ] Integration with `HighDensityStrategy` (Phase 14)

#### Edge Cases Verified

- [ ] Empty history → empty result
- [ ] No tool responses → empty result
- [ ] All tool responses within retention → empty result
- [ ] `recencyRetention: 0` → treated as 1
- [ ] `recencyRetention: -1` → treated as 1
- [ ] Tool response without `toolName` → skipped

## Success Criteria

- All P11 tests pass (GREEN)
- Typecheck passes
- `pruneByRecency` is exported and functional
- `PRUNED_POINTER` constant exported
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/recencyPruning.ts`
2. Re-run Phase 12
3. Cannot proceed to Phase 13 until P11 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P12.md`
Contents:
```markdown
Phase: P12
Completed: YYYY-MM-DD HH:MM
Files Created: [recencyPruning.ts — line count]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 13: Threshold Compression TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P13`

## Prerequisites

- Required: Phase 12 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P12" packages/core/src/core/compression/recencyPruning.ts`
- Expected files from previous phase: `packages/core/src/core/compression/recencyPruning.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-008.1: No LLM Call

**Full Text**: The `HighDensityStrategy.compress()` method shall not make any LLM calls.

**Behavior**:
- GIVEN: A `HighDensityStrategy` instance
- WHEN: `compress(context)` is called
- THEN: It returns a `CompressionResult` without invoking any LLM provider or `resolveProvider`
- AND: `requiresLLM` is `false`

**Why This Matters**: The high-density strategy is deterministic and token-efficient — no LLM overhead for compression.

### REQ-HD-008.2: Recent Tail Preservation

**Full Text**: The `compress()` method shall preserve the recent tail of history, determined by `preserveThreshold` from the runtime context (same as other strategies).

**Behavior**:
- GIVEN: History with 20 entries and `preserveThreshold: 0.2`
- WHEN: `compress()` runs
- THEN: The most recent ~20% of entries (by token count) are preserved exactly as-is
- AND: Only entries outside the preserved tail are candidates for tool response summarization

**Why This Matters**: Recent context is most valuable and must be preserved intact for the AI to continue coherently.

### REQ-HD-008.3: Tool Response Summarization

**Full Text**: For tool responses outside the preserved tail, `compress()` shall replace the full response payload with a compact one-line summary containing: tool name, key parameters (file path or command), and outcome (success or error status).

**Behavior**:
- GIVEN: A tool response for `read_file` with `file_path: '/src/a.ts'` and a 500-line result, outside the preserved tail
- WHEN: `compress()` processes it
- THEN: The `result` field is replaced with a compact string like `"[read_file /src/a.ts — success]"`
- AND: The original tool_response structure (type, callId, toolName) is preserved

**Why This Matters**: Tool responses are typically the largest token consumers; summarizing them dramatically reduces context size while preserving the action record.

### REQ-HD-008.4: Non-Tool Content Preserved

**Full Text**: All tool call blocks, human messages, and AI text blocks shall be preserved intact by `compress()`.

**Behavior**:
- GIVEN: History containing human messages, AI text responses, and tool call blocks
- WHEN: `compress()` runs
- THEN: These entries appear unchanged in `newHistory`
- AND: Only `tool_response` blocks outside the preserved tail have their `result` modified

**Why This Matters**: Human instructions and AI reasoning are essential context; only bulky tool output is compressed.

### REQ-HD-008.5: CompressionResult Assembly

**Full Text**: The `compress()` method shall return a `CompressionResult` with `newHistory` containing the modified history and appropriate `metadata`.

**Behavior**:
- GIVEN: `compress()` completes
- WHEN: The result is examined
- THEN: `result.newHistory` is a complete history array (same length or shorter) with summarized tool responses
- AND: `result.metadata` includes compression statistics

**Why This Matters**: Follows the existing `CompressionResult` contract that the orchestrator expects.

### REQ-HD-008.6: Target Token Count

**Full Text**: The `compress()` method shall target a post-compression token count of approximately `compressionThreshold × contextLimit × 0.6`, providing headroom before the next threshold trigger.

**Behavior**:
- GIVEN: `compressionThreshold: 0.85` and `contextLimit: 100000`
- WHEN: `compress()` targets its output size
- THEN: It aims for approximately `0.85 × 100000 × 0.6 = 51000` tokens
- AND: If summarizing all non-preserved tool responses doesn't reach the target, it returns the best-effort result

**Why This Matters**: Provides sufficient headroom so the threshold isn't immediately re-triggered on the next turn.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/HighDensityStrategy.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P13`
  - MUST include: `@requirement REQ-HD-008.1` through `REQ-HD-008.6`
  - Test: `compress()` returns a `CompressionResult` with `newHistory`
  - Test: `compress()` does not call any LLM provider (no `resolveProvider` usage)
  - Test: Recent tail entries are preserved intact (based on `preserveThreshold`)
  - Test: Tool responses outside preserved tail are summarized to one-line
  - Test: Summary includes tool name and key parameters
  - Test: Summary includes outcome (success/error)
  - Test: Human messages preserved exactly
  - Test: AI text blocks preserved exactly
  - Test: Tool call blocks preserved exactly (only responses modified)
  - Test: `CompressionResult.metadata` has compression statistics
  - Test: Token target — resulting history's estimated token count is approximately `threshold × contextLimit × 0.6` (±10% tolerance). E.g., with `compressionThreshold: 0.85` and `contextLimit: 100000`, the post-compression token estimate should be near 51000 tokens
  - Test: Empty history returns empty `newHistory`
  - Test: History with no tool responses returns history unchanged

### Required Code Markers

```typescript
describe('HighDensityStrategy.compress @plan PLAN-20260211-HIGHDENSITY.P13 @requirement REQ-HD-008.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P13" packages/core/src/core/compression/ | wc -l
# Expected: 3+ occurrences

# Check test file exists
ls packages/core/src/core/compression/HighDensityStrategy.test.ts
# Expected: exists

# Run tests (will FAIL — class doesn't exist yet or compress not implemented)
npx vitest run packages/core/src/core/compression/HighDensityStrategy.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 12 markers present in recencyPruning.ts
- [ ] Test file created at expected path
- [ ] Tests cover all 6 requirements (REQ-HD-008.1 through 008.6)
- [ ] Tests construct real `CompressionContext` objects (no mock theater)
- [ ] Tests use realistic IContent arrays with tool_call and tool_response blocks
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 13+ tests covering all REQ-HD-008 scenarios
- Tests build realistic CompressionContext with history containing tool responses
- All tests FAIL because `HighDensityStrategy` or `compress()` doesn't exist yet (RED)
- Tests are tagged with P13 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/HighDensityStrategy.test.ts`
2. Re-run Phase 13
3. Cannot proceed to Phase 14 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P13.md`
Contents:
```markdown
Phase: P13
Completed: YYYY-MM-DD HH:MM
Files Created: [HighDensityStrategy.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 14: Threshold Compression Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P14`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P13" packages/core/src/core/compression/HighDensityStrategy.test.ts`
- Expected files from previous phase: `packages/core/src/core/compression/HighDensityStrategy.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-008.1: No LLM Call

**Full Text**: The `HighDensityStrategy.compress()` method shall not make any LLM calls.

**Behavior**:
- GIVEN: A `HighDensityStrategy` instance
- WHEN: `compress(context)` is called
- THEN: It returns a `CompressionResult` without invoking any LLM provider or `resolveProvider`
- AND: `requiresLLM` is `false`

**Why This Matters**: The high-density strategy is deterministic and token-efficient — no LLM overhead for compression.

### REQ-HD-008.2: Recent Tail Preservation

**Full Text**: The `compress()` method shall preserve the recent tail of history, determined by `preserveThreshold` from the runtime context (same as other strategies).

**Behavior**:
- GIVEN: History with 20 entries and `preserveThreshold: 0.2`
- WHEN: `compress()` runs
- THEN: The most recent ~20% of entries (by token count) are preserved exactly as-is
- AND: Only entries outside the preserved tail are candidates for tool response summarization

**Why This Matters**: Recent context is most valuable and must be preserved intact for the AI to continue coherently.

### REQ-HD-008.3: Tool Response Summarization

**Full Text**: For tool responses outside the preserved tail, `compress()` shall replace the full response payload with a compact one-line summary containing: tool name, key parameters (file path or command), and outcome (success or error status).

**Behavior**:
- GIVEN: A tool response for `read_file` with `file_path: '/src/a.ts'` and a 500-line result, outside the preserved tail
- WHEN: `compress()` processes it
- THEN: The `result` field is replaced with a compact string like `"[read_file /src/a.ts — success]"`
- AND: The original tool_response structure (type, callId, toolName) is preserved

**Why This Matters**: Tool responses are typically the largest token consumers; summarizing them dramatically reduces context size while preserving the action record.

### REQ-HD-008.4: Non-Tool Content Preserved

**Full Text**: All tool call blocks, human messages, and AI text blocks shall be preserved intact by `compress()`.

**Behavior**:
- GIVEN: History containing human messages, AI text responses, and tool call blocks
- WHEN: `compress()` runs
- THEN: These entries appear unchanged in `newHistory`
- AND: Only `tool_response` blocks outside the preserved tail have their `result` modified

**Why This Matters**: Human instructions and AI reasoning are essential context; only bulky tool output is compressed.

### REQ-HD-008.5: CompressionResult Assembly

**Full Text**: The `compress()` method shall return a `CompressionResult` with `newHistory` containing the modified history and appropriate `metadata`.

**Behavior**:
- GIVEN: `compress()` completes
- WHEN: The result is examined
- THEN: `result.newHistory` is a complete history array (same length or shorter) with summarized tool responses
- AND: `result.metadata` includes compression statistics

**Why This Matters**: Follows the existing `CompressionResult` contract that the orchestrator expects.

### REQ-HD-008.6: Target Token Count

**Full Text**: The `compress()` method shall target a post-compression token count of approximately `compressionThreshold × contextLimit × 0.6`, providing headroom before the next threshold trigger.

**Behavior**:
- GIVEN: `compressionThreshold: 0.85` and `contextLimit: 100000`
- WHEN: `compress()` targets its output size
- THEN: It aims for approximately `0.85 × 100000 × 0.6 = 51000` tokens
- AND: If summarizing all non-preserved tool responses doesn't reach the target, it returns the best-effort result

**Why This Matters**: Provides sufficient headroom so the threshold isn't immediately re-triggered on the next turn.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P14`
  - MUST include: `@requirement REQ-HD-008.1` through `REQ-HD-008.6`
  - CLASS: `HighDensityStrategy implements CompressionStrategy`
    - `readonly name = 'high-density' as const`
    - `readonly requiresLLM = false`
    - `readonly trigger: StrategyTrigger = { mode: 'continuous', defaultThreshold: 0.85 }`
    - `async compress(context: CompressionContext): Promise<CompressionResult>`
      - Calculate preserved tail using `preserveThreshold` from `context.runtimeContext.ephemerals.preserveThreshold()`
      - Calculate target tokens: `compressionThreshold × contextLimit × 0.6`
      - Walk history: preserve tail intact, summarize tool responses outside tail
      - Build summary: `"[toolName filePath/command — success|error]"`
      - Extract file path from tool_call parameters using `file_path`, `absolute_path`, `path` keys
      - Return `CompressionResult` with `newHistory` and `metadata`
    - `optimize(history: readonly IContent[], config: DensityConfig): DensityResult`
      - Stub: delegate to pruning modules (composition wired in P16)
      - For this phase: only `compress()` needs to be fully functional
  - Internal helpers:
    - `summarizeToolResponse(entry: IContent, toolCallEntry: IContent): IContent` — creates compact summary
    - `extractToolInfo(toolCallBlock: ToolCallBlock): { name: string; keyParam: string }` — extracts tool name and primary parameter
    - `determineOutcome(result: unknown): 'success' | 'error'` — checks if result indicates error
  - Imports from `'./types.js'`: `CompressionStrategy`, `CompressionContext`, `CompressionResult`, `StrategyTrigger`, `DensityConfig`, `DensityResult`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P14
 * @requirement REQ-HD-008.1, REQ-HD-008.2, REQ-HD-008.3, REQ-HD-008.4, REQ-HD-008.5, REQ-HD-008.6
 */
export class HighDensityStrategy implements CompressionStrategy {
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P14" packages/core/src/core/compression/HighDensityStrategy.ts | wc -l
# Expected: 2+ occurrences

# Check class export
grep -n 'export class HighDensityStrategy' packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match

# Check requiresLLM
grep -n 'requiresLLM.*false' packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match

# Check trigger
grep -n "mode: 'continuous'" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: 1 match

# Run P13 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/HighDensityStrategy.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches

# Check for empty returns
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches (returning empty newHistory for empty input is acceptable)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `compress()` returns `CompressionResult` with `newHistory`
   - [ ] No LLM provider calls (`requiresLLM: false`, no `resolveProvider` usage)
   - [ ] Recent tail preserved based on `preserveThreshold`
   - [ ] Tool responses outside tail summarized to one-line
   - [ ] Summary includes tool name, key parameters, and outcome
   - [ ] Human messages, AI text, and tool call blocks preserved intact
   - [ ] Token target is `compressionThreshold × contextLimit × 0.6`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] `compress()` actually walks history and builds summarized entries
   - [ ] Summarization produces meaningful one-line strings from tool responses

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify `newHistory` contains summarized tool responses
   - [ ] Tests verify preserved tail entries are identical to originals
   - [ ] Tests verify human messages and AI text are unchanged
   - [ ] Tests verify metadata contains compression statistics

4. **Is the feature REACHABLE by users?**
   - [ ] `HighDensityStrategy` is exported
   - [ ] Will be registered in factory in Phase 16
   - [ ] `compress()` follows the `CompressionStrategy` contract

5. **What's MISSING?**
   - [ ] Factory registration (Phase 16)
   - [ ] `optimize()` wiring to pruning modules (Phase 16)

#### Edge Cases Verified

- [ ] Empty history → empty `newHistory`
- [ ] All entries within preserved tail → no summarization
- [ ] No tool responses → history returned unchanged
- [ ] Tool response with error result → summary shows "error"
- [ ] Tool response without recognizable parameters → summary uses tool name only

## Success Criteria

- All P13 tests pass (GREEN)
- Typecheck passes
- `HighDensityStrategy` is exported with `compress()` functional
- `requiresLLM` is `false`
- `trigger` is `{ mode: 'continuous', defaultThreshold: 0.85 }`
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/compression/HighDensityStrategy.ts`
2. Re-run Phase 14
3. Cannot proceed to Phase 15 until P13 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P14.md`
Contents:
```markdown
Phase: P14
Completed: YYYY-MM-DD HH:MM
Files Created: [HighDensityStrategy.ts — line count]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 15: Factory & Registration TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P14" packages/core/src/core/compression/HighDensityStrategy.ts`
- Expected files from previous phase: `packages/core/src/core/compression/HighDensityStrategy.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.

**Behavior**:
- GIVEN: The `COMPRESSION_STRATEGIES` tuple in `types.ts`
- WHEN: Its values are inspected
- THEN: `'high-density'` is a member of the tuple

**Why This Matters**: Strategy names must be registered in the canonical tuple for type-safe factory resolution and settings validation.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.

**Behavior**:
- GIVEN: The factory function `getCompressionStrategy`
- WHEN: Called with `'high-density'`
- THEN: It returns an instance of `HighDensityStrategy`
- AND: `instance.name` is `'high-density'`
- AND: `instance.requiresLLM` is `false`
- AND: `instance.trigger.mode` is `'continuous'`

**Why This Matters**: The orchestrator uses the factory to resolve strategies; without registration, `'high-density'` cannot be selected.

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.

**Behavior**:
- GIVEN: A `HighDensityStrategy` instance
- WHEN: Properties are accessed
- THEN: `name === 'high-density'`, `requiresLLM === false`, `trigger.mode === 'continuous'`, `trigger.defaultThreshold === 0.85`

**Why This Matters**: Correct metadata ensures the orchestrator invokes `optimize()` for continuous strategies and skips LLM setup.

### REQ-HD-004.4: Settings Auto-Registration

**Full Text**: When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the `compression.strategy` setting's `enumValues` shall automatically include it (via the existing `[...COMPRESSION_STRATEGIES]` derivation).

**Behavior**:
- GIVEN: The `compression.strategy` setting in `SETTINGS_REGISTRY`
- WHEN: Its `enumValues` are inspected
- THEN: `'high-density'` is included (derived from `[...COMPRESSION_STRATEGIES]`)

**Why This Matters**: Users can select `'high-density'` via `/set compression.strategy high-density` without additional registration.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/compressionStrategyFactory.test.ts`
  - ADD test: `getCompressionStrategy('high-density')` returns a `HighDensityStrategy` instance
  - ADD test: returned instance has `name === 'high-density'`
  - ADD test: returned instance has `requiresLLM === false`
  - ADD test: returned instance has `trigger.mode === 'continuous'`
  - ADD test: returned instance has `trigger.defaultThreshold === 0.85`
  - ADD test: returned instance has an `optimize` method (function type)
  - ADD test: returned instance has a `compress` method (function type)
  - ADD test: `COMPRESSION_STRATEGIES` includes `'high-density'` (if not already from P03)
  - ADD test: `optimize()` merge conflict detection — when sub-results produce an index in both removals and replacements, the removal wins and the replacement is discarded
  - ADD test: `optimize()` metadata recount after merge — counts reflect the merged result, not naïve sum of sub-results
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement REQ-HD-004.1, REQ-HD-004.2, REQ-HD-004.3, REQ-HD-004.4`

- `packages/core/src/settings/settingsRegistry.test.ts` (or equivalent)
  - ADD test: `compression.strategy` setting's `enumValues` includes `'high-density'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement REQ-HD-004.4`

### Required Code Markers

```typescript
describe('high-density strategy @plan PLAN-20260211-HIGHDENSITY.P15 @requirement REQ-HD-004.2', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers in test files
grep -r "@plan PLAN-20260211-HIGHDENSITY.P15" packages/core/src/ | wc -l
# Expected: 2+ occurrences

# Run factory tests (will FAIL — factory doesn't have the case yet)
npx vitest run packages/core/src/core/compression/compressionStrategyFactory.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: New tests fail (RED), existing tests pass
```

### Structural Verification Checklist

- [ ] Phase 14 markers present in HighDensityStrategy.ts
- [ ] Tests added to factory test file
- [ ] Tests verify all 4 requirements (REQ-HD-004.1 through 004.4)
- [ ] Tests check concrete property values, not just existence
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until factory registration

## Success Criteria

- 8+ new tests covering all REQ-HD-004 scenarios
- Tests verify strategy properties, factory resolution, and settings auto-registration
- New tests FAIL because the factory case doesn't exist yet (RED)
- Tests are tagged with P15 marker

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/compressionStrategyFactory.test.ts`
2. Re-run Phase 15
3. Cannot proceed to Phase 16 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P15.md`
Contents:
```markdown
Phase: P15
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 16: Factory & Registration Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P15" packages/core/src/core/compression/compressionStrategyFactory.test.ts`
- Expected files from previous phase: Updated `compressionStrategyFactory.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.

**Behavior**:
- GIVEN: The `COMPRESSION_STRATEGIES` tuple in `types.ts`
- WHEN: Its values are inspected
- THEN: `'high-density'` is a member of the tuple

**Why This Matters**: Strategy names must be registered in the canonical tuple for type-safe factory resolution and settings validation.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.

**Behavior**:
- GIVEN: The factory function `getCompressionStrategy`
- WHEN: Called with `'high-density'`
- THEN: It returns an instance of `HighDensityStrategy`
- AND: `instance.name` is `'high-density'`
- AND: `instance.requiresLLM` is `false`
- AND: `instance.trigger.mode` is `'continuous'`

**Why This Matters**: The orchestrator uses the factory to resolve strategies; without registration, `'high-density'` cannot be selected.

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.

**Behavior**:
- GIVEN: A `HighDensityStrategy` instance
- WHEN: Properties are accessed
- THEN: `name === 'high-density'`, `requiresLLM === false`, `trigger.mode === 'continuous'`, `trigger.defaultThreshold === 0.85`

**Why This Matters**: Correct metadata ensures the orchestrator invokes `optimize()` for continuous strategies and skips LLM setup.

### REQ-HD-004.4: Settings Auto-Registration

**Full Text**: When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the `compression.strategy` setting's `enumValues` shall automatically include it (via the existing `[...COMPRESSION_STRATEGIES]` derivation).

**Behavior**:
- GIVEN: The `compression.strategy` setting in `SETTINGS_REGISTRY`
- WHEN: Its `enumValues` are inspected
- THEN: `'high-density'` is included (derived from `[...COMPRESSION_STRATEGIES]`)

**Why This Matters**: Users can select `'high-density'` via `/set compression.strategy high-density` without additional registration.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/compressionStrategyFactory.ts`
  - ADD: `case 'high-density': return new HighDensityStrategy();`
  - ADD import: `import { HighDensityStrategy } from './HighDensityStrategy.js';`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P16`
  - Implements: `@requirement REQ-HD-004.2`

- `packages/core/src/core/compression/HighDensityStrategy.ts` (if `optimize()` needs wiring)
  - WIRE: `optimize()` method to compose results from `pruneReadWritePairs`, `deduplicateFileInclusions`, and `pruneByRecency`
  - ADD imports: `import { pruneReadWritePairs } from './readWritePruning.js'`, `import { deduplicateFileInclusions } from './fileDedup.js'`, `import { pruneByRecency } from './recencyPruning.js'`
  - `optimize()` implementation:
    1. Call `pruneReadWritePairs(history, config)` → get removals, replacements, count (each pruning function runs on the ORIGINAL history)
    2. Call `deduplicateFileInclusions(history, config)` → get replacements, count (runs on the ORIGINAL history)
    3. Call `pruneByRecency(history, config)` → get replacements, count (runs on the ORIGINAL history)
    4. Composition order is deterministic: readWritePruning → fileDedupe → recencyPruning
    5. Merge all removals and replacements into a single `DensityResult`
    6. Handle conflicts: if an index appears in both read-write removals and dedup/recency replacements, prefer the removal
    7. Validate: no index appears in both merged `removals` and merged `replacements` (throw if violated — REQ-HD-001.6)
    8. After merge: recount metadata totals from the merged result (do not simply sum sub-results, since conflict resolution may discard some replacements)
    9. Return merged `DensityResult` with accurate metadata
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P16`
  - Implements: `@requirement REQ-HD-004.3`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P16
 * @requirement REQ-HD-004.2
 */
case 'high-density':
  return new HighDensityStrategy();
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P16" packages/core/src/core/compression/ | wc -l
# Expected: 2+ occurrences

# Check factory case
grep -n "'high-density'" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: 1 match in switch case

# Check import
grep -n 'HighDensityStrategy' packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: import statement

# Check optimize wiring
grep -n 'pruneReadWritePairs\|deduplicateFileInclusions\|pruneByRecency' packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: All three imported and called in optimize()

# Run P15 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/compression/compressionStrategyFactory.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Run ALL compression tests
npx vitest run packages/core/src/core/compression/ --reporter=verbose 2>&1 | tail -40
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/compressionStrategyFactory.ts packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/compressionStrategyFactory.ts packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches

# Check for empty returns in optimize
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `getCompressionStrategy('high-density')` returns `HighDensityStrategy`
   - [ ] `optimize()` calls all three pruning modules
   - [ ] `optimize()` merges removals and replacements correctly
   - [ ] Conflict resolution: removals take precedence over replacements at same index
   - [ ] Metadata aggregates counts from all three modules
   - [ ] `COMPRESSION_STRATEGIES` includes `'high-density'` (from P02)
   - [ ] Settings auto-registration via `[...COMPRESSION_STRATEGIES]` spread

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Factory case actually instantiates `HighDensityStrategy`
   - [ ] `optimize()` actually calls the pruning functions and merges results

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests call `getCompressionStrategy('high-density')` and check instance type
   - [ ] Tests verify `name`, `requiresLLM`, `trigger` on returned instance
   - [ ] Tests verify `optimize` is a function

4. **Is the feature REACHABLE by users?**
   - [ ] `/set compression.strategy high-density` is now valid
   - [ ] Factory resolves the strategy for the orchestrator

5. **What's MISSING?**
   - [ ] Settings for density config (Phase 18)
   - [ ] Runtime accessors (Phase 18)
   - [ ] Orchestration wiring (Phase 20)

#### Integration Points Verified

- [ ] Factory imports `HighDensityStrategy` from `'./HighDensityStrategy.js'`
- [ ] `HighDensityStrategy` imports pruning modules with `.js` extensions
- [ ] All existing factory tests still pass
- [ ] All existing compression tests still pass

## Success Criteria

- All P15 tests pass (GREEN)
- All existing compression tests still pass
- Typecheck passes
- Factory resolves `'high-density'` to `HighDensityStrategy`
- `optimize()` composes results from all three pruning modules
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/compressionStrategyFactory.ts`
2. `git checkout -- packages/core/src/core/compression/HighDensityStrategy.ts`
3. Re-run Phase 16
4. Cannot proceed to Phase 17 until P15 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P16.md`
Contents:
```markdown
Phase: P16
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 17: Settings & Runtime Accessors TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P17`

## Prerequisites

- Required: Phase 16 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P16" packages/core/src/core/compression/compressionStrategyFactory.ts`
- Expected files from previous phase: Updated `compressionStrategyFactory.ts` with `'high-density'` case
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-009.1: Read-Write Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.readWritePruning` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.readWritePruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Exposes READ→WRITE pruning as a user-configurable setting that persists across sessions.

### REQ-HD-009.2: File Dedupe Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.fileDedupe` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.fileDedupe'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Exposes file deduplication as a user-configurable setting.

### REQ-HD-009.3: Recency Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyPruning` with type `boolean`, default `false`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.recencyPruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: false`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Recency pruning is opt-in by default; this setting allows users to enable it.

### REQ-HD-009.4: Recency Retention Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyRetention` with type `number`, default `3`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.recencyRetention'`
- THEN: A spec is found with `type: 'number'`, `default: 3`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Controls how many recent results per tool type are retained during recency pruning.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: The `AgentRuntimeContext` ephemerals interface shall provide accessors: `densityReadWritePruning(): boolean`, `densityFileDedupe(): boolean`, `densityRecencyPruning(): boolean`, `densityRecencyRetention(): number`.

**Behavior**:
- GIVEN: An `AgentRuntimeContext` instance with default settings
- WHEN: `ephemerals.densityReadWritePruning()` is called
- THEN: It returns `true` (the default)
- AND WHEN: `ephemerals.densityFileDedupe()` is called
- THEN: It returns `true`
- AND WHEN: `ephemerals.densityRecencyPruning()` is called
- THEN: It returns `false`
- AND WHEN: `ephemerals.densityRecencyRetention()` is called
- THEN: It returns `3`

**Why This Matters**: Runtime accessors bridge the settings system to the density optimization code with proper defaults.

### REQ-HD-009.6: Ephemeral Settings Types

**Full Text**: The `EphemeralSettings` interface (or `ReadonlySettingsSnapshot`) shall include optional fields for `'compression.density.readWritePruning'` (boolean), `'compression.density.fileDedupe'` (boolean), `'compression.density.recencyPruning'` (boolean), and `'compression.density.recencyRetention'` (number).

**Behavior**:
- GIVEN: The `ReadonlySettingsSnapshot` interface
- WHEN: A settings snapshot includes `'compression.density.readWritePruning': false`
- THEN: The type system accepts it without error
- AND: The runtime accessor reflects the overridden value

**Why This Matters**: Type-safe ephemeral settings ensure the compiler catches mismatches between settings and accessors.

## Implementation Tasks

### Files to Modify/Create

- `packages/core/src/settings/settingsRegistry.test.ts` (or create new test file)
  - ADD test: `compression.density.readWritePruning` setting exists with correct spec
  - ADD test: `compression.density.fileDedupe` setting exists with correct spec
  - ADD test: `compression.density.recencyPruning` setting exists with correct spec
  - ADD test: `compression.density.recencyRetention` setting exists with correct spec
  - ADD test: All four settings have `persistToProfile: true`
  - ADD test: All four settings have `category: 'cli-behavior'`
  - ADD test: Defaults are `true`, `true`, `false`, `3` respectively
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P17`
  - Implements: `@requirement REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4`

- `packages/core/src/runtime/AgentRuntimeContext.test.ts` (or create new test file)
  - ADD test: `ephemerals.densityReadWritePruning()` returns `true` by default
  - ADD test: `ephemerals.densityFileDedupe()` returns `true` by default
  - ADD test: `ephemerals.densityRecencyPruning()` returns `false` by default
  - ADD test: `ephemerals.densityRecencyRetention()` returns `3` by default
  - ADD test: Overridden values via settings snapshot are reflected in accessors
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P17`
  - Implements: `@requirement REQ-HD-009.5, REQ-HD-009.6`

### Required Code Markers

```typescript
describe('density settings @plan PLAN-20260211-HIGHDENSITY.P17 @requirement REQ-HD-009.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers in test files
grep -r "@plan PLAN-20260211-HIGHDENSITY.P17" packages/core/src/ | wc -l
# Expected: 4+ occurrences

# Run settings tests (will FAIL — settings not registered yet)
npx vitest run packages/core/src/settings/ --reporter=verbose 2>&1 | tail -30
# Expected: New tests fail (RED)

# Run runtime context tests (will FAIL — accessors not defined yet)
npx vitest run packages/core/src/runtime/ --reporter=verbose 2>&1 | tail -30
# Expected: New tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 16 markers present in compressionStrategyFactory.ts
- [ ] Tests added to settings and runtime context test files
- [ ] Tests cover all 6 requirements (REQ-HD-009.1 through 009.6)
- [ ] Tests verify concrete default values
- [ ] Tests verify type/category/persistToProfile metadata
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 12+ new tests covering all REQ-HD-009 scenarios
- Tests verify both settings registration and runtime accessor behavior
- New tests FAIL because settings/accessors don't exist yet (RED)
- Tests are tagged with P17 marker

## Failure Recovery

If this phase fails:
1. Revert test file changes
2. Re-run Phase 17
3. Cannot proceed to Phase 18 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P17.md`
Contents:
```markdown
Phase: P17
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 18: Settings & Runtime Accessors Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P18`

## Prerequisites

- Required: Phase 17 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P17" packages/core/src/`
- Expected files from previous phase: Updated test files for settings and runtime context
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-009.1: Read-Write Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.readWritePruning` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.readWritePruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Exposes READ→WRITE pruning as a user-configurable setting that persists across sessions.

### REQ-HD-009.2: File Dedupe Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.fileDedupe` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.fileDedupe'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Exposes file deduplication as a user-configurable setting.

### REQ-HD-009.3: Recency Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyPruning` with type `boolean`, default `false`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.recencyPruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: false`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Recency pruning is opt-in by default; this setting allows users to enable it.

### REQ-HD-009.4: Recency Retention Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyRetention` with type `number`, default `3`, category `'cli-behavior'`, and `persistToProfile: true`.

**Behavior**:
- GIVEN: The `SETTINGS_REGISTRY` array
- WHEN: It is searched for a setting with key `'compression.density.recencyRetention'`
- THEN: A spec is found with `type: 'number'`, `default: 3`, `category: 'cli-behavior'`, `persistToProfile: true`

**Why This Matters**: Controls how many recent results per tool type are retained during recency pruning.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: The `AgentRuntimeContext` ephemerals interface shall provide accessors: `densityReadWritePruning(): boolean`, `densityFileDedupe(): boolean`, `densityRecencyPruning(): boolean`, `densityRecencyRetention(): number`.

**Behavior**:
- GIVEN: An `AgentRuntimeContext` instance with default settings
- WHEN: `ephemerals.densityReadWritePruning()` is called
- THEN: It returns `true` (the default)
- AND WHEN: `ephemerals.densityFileDedupe()` is called
- THEN: It returns `true`
- AND WHEN: `ephemerals.densityRecencyPruning()` is called
- THEN: It returns `false`
- AND WHEN: `ephemerals.densityRecencyRetention()` is called
- THEN: It returns `3`

**Why This Matters**: Runtime accessors bridge the settings system to the density optimization code with proper defaults.

### REQ-HD-009.6: Ephemeral Settings Types

**Full Text**: The `EphemeralSettings` interface (or `ReadonlySettingsSnapshot`) shall include optional fields for `'compression.density.readWritePruning'` (boolean), `'compression.density.fileDedupe'` (boolean), `'compression.density.recencyPruning'` (boolean), and `'compression.density.recencyRetention'` (number).

**Behavior**:
- GIVEN: The `ReadonlySettingsSnapshot` interface
- WHEN: A settings snapshot includes `'compression.density.readWritePruning': false`
- THEN: The type system accepts it without error
- AND: The runtime accessor reflects the overridden value

**Why This Matters**: Type-safe ephemeral settings ensure the compiler catches mismatches between settings and accessors.

## Implementation Tasks

### Files to Modify

- `packages/core/src/settings/settingsRegistry.ts`
  - ADD four setting specs after the existing `compression.strategy` and `compression.profile` settings:
    ```typescript
    {
      key: 'compression.density.readWritePruning',
      category: 'cli-behavior',
      description: 'Enable READ→WRITE pair pruning in high-density mode',
      type: 'boolean',
      default: true,
      persistToProfile: true,
    },
    {
      key: 'compression.density.fileDedupe',
      category: 'cli-behavior',
      description: 'Enable duplicate @ file inclusion deduplication in high-density mode',
      type: 'boolean',
      default: true,
      persistToProfile: true,
    },
    {
      key: 'compression.density.recencyPruning',
      category: 'cli-behavior',
      description: 'Enable tool result recency pruning in high-density mode',
      type: 'boolean',
      default: false,
      persistToProfile: true,
    },
    {
      key: 'compression.density.recencyRetention',
      category: 'cli-behavior',
      description: 'Number of recent results per tool type to retain when recency pruning is enabled',
      type: 'number',
      default: 3,
      persistToProfile: true,
    },
    ```
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P18`
  - Implements: `@requirement REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4`

- `packages/core/src/runtime/AgentRuntimeContext.ts`
  - ADD to `ReadonlySettingsSnapshot`:
    ```typescript
    'compression.density.readWritePruning'?: boolean;
    'compression.density.fileDedupe'?: boolean;
    'compression.density.recencyPruning'?: boolean;
    'compression.density.recencyRetention'?: number;
    ```
  - ADD to `ephemerals` interface:
    ```typescript
    densityReadWritePruning(): boolean;
    densityFileDedupe(): boolean;
    densityRecencyPruning(): boolean;
    densityRecencyRetention(): number;
    ```
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P18`
  - Implements: `@requirement REQ-HD-009.5, REQ-HD-009.6`

- `packages/core/src/runtime/` (factory/builder file that constructs ephemerals)
  - WIRE: accessor implementations that read from settings with defaults:
    - `densityReadWritePruning()`: reads `'compression.density.readWritePruning'` from snapshot, defaults to `true`
    - `densityFileDedupe()`: reads `'compression.density.fileDedupe'` from snapshot, defaults to `true`
    - `densityRecencyPruning()`: reads `'compression.density.recencyPruning'` from snapshot, defaults to `false`
    - `densityRecencyRetention()`: reads `'compression.density.recencyRetention'` from snapshot, defaults to `3`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P18`
  - Implements: `@requirement REQ-HD-009.5`

### Required Code Markers

```typescript
/** @plan PLAN-20260211-HIGHDENSITY.P18 @requirement REQ-HD-009.1 */
{
  key: 'compression.density.readWritePruning',
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P18" packages/core/src/ | wc -l
# Expected: 3+ occurrences

# Check settings registered
grep -n "compression.density" packages/core/src/settings/settingsRegistry.ts
# Expected: 4 settings (readWritePruning, fileDedupe, recencyPruning, recencyRetention)

# Check ReadonlySettingsSnapshot fields
grep -n "compression.density" packages/core/src/runtime/AgentRuntimeContext.ts
# Expected: 4 optional fields

# Check ephemerals accessors
grep -n "densityReadWritePruning\|densityFileDedupe\|densityRecencyPruning\|densityRecencyRetention" packages/core/src/runtime/AgentRuntimeContext.ts
# Expected: 4 accessor declarations

# Run P17 tests — should now PASS (GREEN)
npx vitest run packages/core/src/settings/ --reporter=verbose 2>&1 | tail -30
npx vitest run packages/core/src/runtime/ --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/settings/settingsRegistry.ts | grep -i "density"
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/runtime/AgentRuntimeContext.ts | grep -i "density"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/settings/settingsRegistry.ts | grep -i "density"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Four settings registered in `SETTINGS_REGISTRY` with correct keys, types, defaults
   - [ ] `ReadonlySettingsSnapshot` has four new optional fields
   - [ ] `ephemerals` interface has four new accessor methods
   - [ ] Accessor implementations return correct defaults when not overridden
   - [ ] Accessor implementations return overridden values when set

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Accessors actually read from the settings snapshot
   - [ ] Defaults match the setting specs (true, true, false, 3)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify setting existence by key
   - [ ] Tests verify default values
   - [ ] Tests verify accessor return values

4. **Is the feature REACHABLE by users?**
   - [ ] Users can run `/set compression.density.readWritePruning false`
   - [ ] Settings persist to profile
   - [ ] Orchestrator can read via `runtimeContext.ephemerals.densityReadWritePruning()`

5. **What's MISSING?**
   - [ ] Orchestration wiring (Phase 20)

#### Integration Points Verified

- [ ] Settings keys follow existing naming pattern (`compression.` prefix)
- [ ] Accessor implementations follow existing pattern in ephemerals builder
- [ ] All existing settings tests still pass
- [ ] All existing runtime tests still pass

## Success Criteria

- All P17 tests pass (GREEN)
- All existing settings and runtime tests still pass
- Typecheck passes
- Four density settings registered
- Four runtime accessors functional with correct defaults
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/settings/settingsRegistry.ts`
2. `git checkout -- packages/core/src/runtime/AgentRuntimeContext.ts`
3. Revert runtime builder changes
4. Re-run Phase 18
5. Cannot proceed to Phase 19 until P17 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P18.md`
Contents:
```markdown
Phase: P18
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 19: Orchestration TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P19`

## Prerequisites

- Required: Phase 18 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P18" packages/core/src/settings/settingsRegistry.ts`
- Expected files from previous phase: Updated `settingsRegistry.ts`, `AgentRuntimeContext.ts`, runtime builder
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.

**Behavior**:
- GIVEN: `ensureCompressionBeforeSend()` is called
- WHEN: Token updates have been settled via `waitForTokenUpdates()`
- THEN: `ensureDensityOptimized()` runs BEFORE `shouldCompress()` is evaluated

**Why This Matters**: Density optimization reduces token count before the threshold check, potentially avoiding unnecessary LLM-based compression.

### REQ-HD-002.2: Conditional Optimization

**Full Text**: If the resolved strategy does not implement `optimize`, then the density optimization step shall be skipped.

**Behavior**:
- GIVEN: A strategy with `optimize === undefined` (e.g., `MiddleOutStrategy`)
- WHEN: `ensureDensityOptimized()` runs
- THEN: It returns immediately without calling any pruning logic

**Why This Matters**: Existing threshold-only strategies should not be affected by the new optimization path.

### REQ-HD-002.3: No-Op When Clean

**Full Text**: If the density dirty flag is `false` (no new content added since last optimization), then the density optimization step shall be skipped.

**Behavior**:
- GIVEN: `densityDirty` is `false`
- WHEN: `ensureDensityOptimized()` runs
- THEN: It returns immediately without calling `strategy.optimize()`

**Why This Matters**: Avoids redundant re-processing when no new content has been added since the last optimization.

### REQ-HD-002.4: DensityResult Application

**Full Text**: When `optimize()` returns a `DensityResult` with non-empty removals or replacements, the system shall call `historyService.applyDensityResult()` and await token recalculation before proceeding to the threshold check.

**Behavior**:
- GIVEN: `optimize()` returns `{ removals: [1], replacements: new Map(), metadata }`
- WHEN: `ensureDensityOptimized()` processes the result
- THEN: `historyService.applyDensityResult(result)` is called and awaited
- AND: `historyService.waitForTokenUpdates()` is called after application

**Why This Matters**: Token counts must reflect the post-optimization state before the threshold check runs.

### REQ-HD-002.5: Empty Result Short-Circuit

**Full Text**: When `optimize()` returns a `DensityResult` with zero removals and zero replacements, the system shall not call `applyDensityResult()`.

**Behavior**:
- GIVEN: `optimize()` returns `{ removals: [], replacements: new Map(size=0), metadata }`
- WHEN: `ensureDensityOptimized()` processes the result
- THEN: `applyDensityResult` is NOT called

**Why This Matters**: Avoids unnecessary token recalculation when optimization found nothing to change.

### REQ-HD-002.6: Dirty Flag Set On Content Add

**Full Text**: The density dirty flag shall be set to `true` when new content is added to history via the turn loop (user messages, AI responses, tool results). It shall NOT be set by compression or density-internal token recalculation.

**Behavior**:
- GIVEN: `densityDirty` is `false`
- WHEN: A new user message is added to history via the turn loop
- THEN: `densityDirty` is set to `true`
- AND WHEN: `applyDensityResult()` modifies history (density-internal)
- THEN: `densityDirty` remains `false`

**Why This Matters**: Prevents optimization from triggering itself via dirty flag feedback loops.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization

**Full Text**: The density dirty flag shall be set to `false` after `ensureDensityOptimized()` completes, regardless of whether optimization produced changes.

**Behavior**:
- GIVEN: `densityDirty` is `true`
- WHEN: `ensureDensityOptimized()` completes (even if optimization found nothing)
- THEN: `densityDirty` is `false`

**Why This Matters**: Ensures optimization runs exactly once per new content batch, not repeatedly.

### REQ-HD-002.8: Emergency Path Optimization

**Full Text**: The emergency compression path (projected tokens exceed hard context limit) shall also call the density optimization step before attempting compression.

**Behavior**:
- GIVEN: The emergency compression path is triggered (projected tokens > context limit)
- WHEN: Emergency compression runs
- THEN: `ensureDensityOptimized()` is called before `performCompression()`

**Why This Matters**: Density optimization may reduce tokens enough to avoid emergency compression entirely.

### REQ-HD-002.9: Raw History Input

**Full Text**: The `optimize()` method shall receive the raw history array (via `getRawHistory()`), not the curated view. `DensityResult` indices shall refer to positions in the raw array.

**Behavior**:
- GIVEN: History contains empty AI messages that `getCurated()` would filter
- WHEN: `optimize()` is called
- THEN: It receives the full raw history including empty entries
- AND: Returned indices map to positions in the raw array

**Why This Matters**: Index alignment — `applyDensityResult()` operates on the raw array.

### REQ-HD-002.10: Sequential Turn-Loop Safety

**Full Text**: The `ensureDensityOptimized()` method shall only be called from the sequential pre-send window (within `ensureCompressionBeforeSend`), where no concurrent `historyService.add()` calls occur.

**Behavior**:
- GIVEN: `ensureDensityOptimized()` runs within `ensureCompressionBeforeSend()`
- WHEN: It modifies history via `applyDensityResult()`
- THEN: No concurrent `add()` calls are in flight (guaranteed by the turn loop's sequential execution model)

**Why This Matters**: History mutations are safe only in the pre-send window before the model is called.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/geminiChat.density.test.ts`
  - MUST include: `@plan PLAN-20260211-HIGHDENSITY.P19`
  - MUST include: `@requirement REQ-HD-002.1` through `REQ-HD-002.10`
  - Test: `ensureDensityOptimized()` is called before `shouldCompress()` in `ensureCompressionBeforeSend()`
  - Test: Optimization is skipped when strategy has no `optimize` method
  - Test: Optimization is skipped when `densityDirty` is `false`
  - Test: `applyDensityResult()` is called when `optimize()` returns non-empty result
  - Test: `applyDensityResult()` is NOT called when result is empty
  - Test: `densityDirty` is set to `true` when new content is added
  - Test: `densityDirty` is set to `false` after optimization completes
  - Test: `densityDirty` is NOT set to `true` by density-internal history mutations
  - Test: Emergency path calls `ensureDensityOptimized()` before compression
  - Test: `optimize()` receives `getRawHistory()` output (not `getCurated()`)
  - Test: `waitForTokenUpdates()` called after `applyDensityResult()`
  - Test: DensityConfig is built from runtime context ephemerals
  - Test: Dirty flag cleared in finally block — GIVEN: `optimize()` throws an error; WHEN: `ensureDensityOptimized()` catches/propagates the error; THEN: `densityDirty` is still set to `false` (cleared in finally block, preventing infinite retry loops)

  NOTE: These tests may use targeted spying on specific methods (e.g., spy on `historyService.applyDensityResult` to verify call order) but must exercise real `GeminiChat` behavior where possible. Where `GeminiChat` cannot be instantiated in isolation, use the most realistic test harness available in the project.

### Required Code Markers

```typescript
describe('ensureDensityOptimized @plan PLAN-20260211-HIGHDENSITY.P19 @requirement REQ-HD-002.1', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P19" packages/core/src/ | wc -l
# Expected: 4+ occurrences

# Check test file exists
ls packages/core/src/core/geminiChat.density.test.ts
# Expected: exists

# Run tests (will FAIL — method doesn't exist yet)
npx vitest run packages/core/src/core/geminiChat.density.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: Tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 18 markers present in settingsRegistry.ts and AgentRuntimeContext.ts
- [ ] Test file created at expected path
- [ ] Tests cover all 10 requirements (REQ-HD-002.1 through 002.10)
- [ ] Tests verify call ordering (density optimization before threshold check)
- [ ] Tests verify dirty flag transitions
- [ ] Tests verify conditional skipping (no optimize, not dirty)
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 12+ tests covering all REQ-HD-002 scenarios
- Tests exercise realistic call flows through `ensureCompressionBeforeSend`
- All tests FAIL because `ensureDensityOptimized()` doesn't exist yet (RED)
- Tests are tagged with P19 marker

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/core/geminiChat.density.test.ts`
2. Re-run Phase 19
3. Cannot proceed to Phase 20 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P19.md`
Contents:
```markdown
Phase: P19
Completed: YYYY-MM-DD HH:MM
Files Created: [geminiChat.density.test.ts — line count]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 20: Orchestration Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P20`

## Prerequisites

- Required: Phase 19 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P19" packages/core/src/core/geminiChat.density.test.ts`
- Expected files from previous phase: `packages/core/src/core/geminiChat.density.test.ts`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.

**Behavior**:
- GIVEN: `ensureCompressionBeforeSend()` is called
- WHEN: Token updates have been settled via `waitForTokenUpdates()`
- THEN: `ensureDensityOptimized()` runs BEFORE `shouldCompress()` is evaluated

**Why This Matters**: Density optimization reduces token count before the threshold check, potentially avoiding unnecessary LLM-based compression.

### REQ-HD-002.2: Conditional Optimization

**Full Text**: If the resolved strategy does not implement `optimize`, then the density optimization step shall be skipped.

**Behavior**:
- GIVEN: A strategy with `optimize === undefined` (e.g., `MiddleOutStrategy`)
- WHEN: `ensureDensityOptimized()` runs
- THEN: It returns immediately without calling any pruning logic

**Why This Matters**: Existing threshold-only strategies should not be affected by the new optimization path.

### REQ-HD-002.3: No-Op When Clean

**Full Text**: If the density dirty flag is `false` (no new content added since last optimization), then the density optimization step shall be skipped.

**Behavior**:
- GIVEN: `densityDirty` is `false`
- WHEN: `ensureDensityOptimized()` runs
- THEN: It returns immediately without calling `strategy.optimize()`

**Why This Matters**: Avoids redundant re-processing when no new content has been added since the last optimization.

### REQ-HD-002.4: DensityResult Application

**Full Text**: When `optimize()` returns a `DensityResult` with non-empty removals or replacements, the system shall call `historyService.applyDensityResult()` and await token recalculation before proceeding to the threshold check.

**Behavior**:
- GIVEN: `optimize()` returns `{ removals: [1], replacements: new Map(), metadata }`
- WHEN: `ensureDensityOptimized()` processes the result
- THEN: `historyService.applyDensityResult(result)` is called and awaited
- AND: `historyService.waitForTokenUpdates()` is called after application

**Why This Matters**: Token counts must reflect the post-optimization state before the threshold check runs.

### REQ-HD-002.5: Empty Result Short-Circuit

**Full Text**: When `optimize()` returns a `DensityResult` with zero removals and zero replacements, the system shall not call `applyDensityResult()`.

**Behavior**:
- GIVEN: `optimize()` returns `{ removals: [], replacements: new Map(size=0), metadata }`
- WHEN: `ensureDensityOptimized()` processes the result
- THEN: `applyDensityResult` is NOT called

**Why This Matters**: Avoids unnecessary token recalculation when optimization found nothing to change.

### REQ-HD-002.6: Dirty Flag Set On Content Add

**Full Text**: The density dirty flag shall be set to `true` when new content is added to history via the turn loop (user messages, AI responses, tool results). It shall NOT be set by compression or density-internal token recalculation.

**Behavior**:
- GIVEN: `densityDirty` is `false`
- WHEN: A new user message is added to history via the turn loop
- THEN: `densityDirty` is set to `true`
- AND WHEN: `applyDensityResult()` modifies history (density-internal)
- THEN: `densityDirty` remains `false`

**Why This Matters**: Prevents optimization from triggering itself via dirty flag feedback loops.

### REQ-HD-002.7: Dirty Flag Cleared After Optimization

**Full Text**: The density dirty flag shall be set to `false` after `ensureDensityOptimized()` completes, regardless of whether optimization produced changes.

**Behavior**:
- GIVEN: `densityDirty` is `true`
- WHEN: `ensureDensityOptimized()` completes (even if optimization found nothing)
- THEN: `densityDirty` is `false`

**Why This Matters**: Ensures optimization runs exactly once per new content batch, not repeatedly.

### REQ-HD-002.8: Emergency Path Optimization

**Full Text**: The emergency compression path (projected tokens exceed hard context limit) shall also call the density optimization step before attempting compression.

**Behavior**:
- GIVEN: The emergency compression path is triggered (projected tokens > context limit)
- WHEN: Emergency compression runs
- THEN: `ensureDensityOptimized()` is called before `performCompression()`

**Why This Matters**: Density optimization may reduce tokens enough to avoid emergency compression entirely.

### REQ-HD-002.9: Raw History Input

**Full Text**: The `optimize()` method shall receive the raw history array (via `getRawHistory()`), not the curated view. `DensityResult` indices shall refer to positions in the raw array.

**Behavior**:
- GIVEN: History contains empty AI messages that `getCurated()` would filter
- WHEN: `optimize()` is called
- THEN: It receives the full raw history including empty entries
- AND: Returned indices map to positions in the raw array

**Why This Matters**: Index alignment — `applyDensityResult()` operates on the raw array.

### REQ-HD-002.10: Sequential Turn-Loop Safety

**Full Text**: The `ensureDensityOptimized()` method shall only be called from the sequential pre-send window (within `ensureCompressionBeforeSend`), where no concurrent `historyService.add()` calls occur.

**Behavior**:
- GIVEN: `ensureDensityOptimized()` runs within `ensureCompressionBeforeSend()`
- WHEN: It modifies history via `applyDensityResult()`
- THEN: No concurrent `add()` calls are in flight (guaranteed by the turn loop's sequential execution model)

**Why This Matters**: History mutations are safe only in the pre-send window before the model is called.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/geminiChat.ts`
  - ADD private field: `private densityDirty: boolean = true;`
  - ADD private method: `private async ensureDensityOptimized(): Promise<void>`
    - Resolve strategy from `runtimeContext.ephemerals.compressionStrategy()`
    - If `!strategy.optimize` → return
    - If `!this.densityDirty` → return
    - Build `DensityConfig` from ephemerals: `{ readWritePruning, fileDedupe, recencyPruning, recencyRetention, workspaceRoot }`
    - Call `strategy.optimize(this.historyService.getRawHistory(), config)`
    - If result has non-empty removals or replacements → `await this.historyService.applyDensityResult(result)`; `await this.historyService.waitForTokenUpdates()`
    - Set `this.densityDirty = false` in a `finally` block (ensures the flag is cleared even if `optimize()` or `applyDensityResult()` throws, preventing infinite retry loops on persistent errors)
  - MODIFY `ensureCompressionBeforeSend()`:
    - After `await this.historyService.waitForTokenUpdates()` and before `if (this.shouldCompress(pendingTokens))`:
    - INSERT: `await this.ensureDensityOptimized();`
  - MODIFY emergency compression path:
    - Before calling `performCompression()` in the emergency path:
    - INSERT: `await this.ensureDensityOptimized();`
  - MODIFY content addition paths (where `historyService.add()` is called for user messages, AI responses, tool results):
    - INSERT: `this.densityDirty = true;` after each `add()` call in the turn loop
    - Do NOT set dirty in `performCompression()` or `applyDensityResult()` paths
  - ADD imports: `import { parseCompressionStrategyName, getCompressionStrategy } from './compression/compressionStrategyFactory.js'` (if not already imported)
  - ADD import: `import type { DensityConfig } from './compression/types.js'`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P20`
  - Implements: `@requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4, REQ-HD-002.5, REQ-HD-002.6, REQ-HD-002.7, REQ-HD-002.8, REQ-HD-002.9, REQ-HD-002.10`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P20
 * @requirement REQ-HD-002.1, REQ-HD-002.2, REQ-HD-002.3, REQ-HD-002.4
 * @requirement REQ-HD-002.5, REQ-HD-002.6, REQ-HD-002.7, REQ-HD-002.8
 * @requirement REQ-HD-002.9, REQ-HD-002.10
 */
private async ensureDensityOptimized(): Promise<void> {
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P20" packages/core/src/core/geminiChat.ts | wc -l
# Expected: 2+ occurrences

# Check new method exists
grep -n 'ensureDensityOptimized' packages/core/src/core/geminiChat.ts
# Expected: method definition + call sites in ensureCompressionBeforeSend and emergency path

# Check dirty flag field
grep -n 'densityDirty' packages/core/src/core/geminiChat.ts
# Expected: field declaration + set true (on add) + set false (after optimization) + check

# Check DensityConfig construction
grep -n 'DensityConfig' packages/core/src/core/geminiChat.ts
# Expected: type import + config construction in ensureDensityOptimized

# Run P19 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/geminiChat.density.test.ts --reporter=verbose 2>&1 | tail -30
# Expected: All pass

# Run ALL geminiChat tests
npx vitest run packages/core/src/core/geminiChat --reporter=verbose 2>&1 | tail -40
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in new code
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/geminiChat.ts | grep -i "density\|ensureDensity"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/geminiChat.ts | grep -i "density\|ensureDensity"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `ensureDensityOptimized()` called after `waitForTokenUpdates()` in `ensureCompressionBeforeSend()`
   - [ ] `ensureDensityOptimized()` called before `shouldCompress()` check
   - [ ] Returns early when strategy has no `optimize` method
   - [ ] Returns early when `densityDirty` is `false`
   - [ ] Calls `strategy.optimize(getRawHistory(), config)` with correct DensityConfig
   - [ ] Calls `applyDensityResult()` only when result is non-empty
   - [ ] Calls `waitForTokenUpdates()` after `applyDensityResult()`
   - [ ] Sets `densityDirty = false` after optimization
   - [ ] Sets `densityDirty = true` on content addition (user messages, AI responses, tool results)
   - [ ] Does NOT set `densityDirty = true` in compression/density paths
   - [ ] Emergency path also calls `ensureDensityOptimized()`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] `ensureDensityOptimized()` actually resolves strategy and calls `optimize()`
   - [ ] DensityConfig reads from real ephemeral accessors

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify `applyDensityResult` is called when optimize returns non-empty
   - [ ] Tests verify dirty flag transitions
   - [ ] Tests verify call ordering

4. **Is the feature REACHABLE by users?**
   - [ ] Setting `compression.strategy` to `high-density` activates the full flow
   - [ ] Density optimization runs automatically before every send
   - [ ] No user action needed beyond strategy selection

5. **What's MISSING?**
   - [ ] Enriched prompts (Phase 21)
   - [ ] Todo-aware summarization (Phase 23)

#### Integration Points Verified

- [ ] `getCompressionStrategy` import works
- [ ] `getRawHistory()` method available on `historyService`
- [ ] `applyDensityResult()` method available on `historyService`
- [ ] Ephemeral accessors for density settings available
- [ ] `getWorkspaceRoot()` available on `runtimeContext.config`
- [ ] Existing `ensureCompressionBeforeSend` flow unbroken

## Success Criteria

- All P19 tests pass (GREEN)
- All existing geminiChat tests still pass
- Typecheck passes
- `ensureDensityOptimized()` is wired into `ensureCompressionBeforeSend()`
- Dirty flag management is correct
- Emergency path includes density optimization
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/geminiChat.ts`
2. Re-run Phase 20
3. Cannot proceed to Phase 21 until P19 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P20.md`
Contents:
```markdown
Phase: P20
Completed: YYYY-MM-DD HH:MM
Files Modified: [geminiChat.ts — diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 21: Enriched Prompts

## Phase ID

`PLAN-20260211-HIGHDENSITY.P21`

## Prerequisites

- Required: Phase 20 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P20" packages/core/src/core/geminiChat.ts`
- Expected files from previous phase: Updated `geminiChat.ts` with `ensureDensityOptimized()`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-010.1: Task Context Section

**Full Text**: The compression prompt template shall include a `<task_context>` section instructing the LLM to capture, for each active task or todo item: why it exists, what user request originated it, what constraints apply, what approach was chosen, and what has been tried.

**Behavior**:
- GIVEN: The compression prompt template (in `prompts.ts` and `compression.md`)
- WHEN: The prompt text is examined
- THEN: It contains a `<task_context>` section with instructions to capture task origins, constraints, approaches, and attempts

**Why This Matters**: Ensures LLM-based compression preserves the reasoning behind active tasks, not just their existence.

### REQ-HD-010.2: User Directives Section

**Full Text**: The compression prompt template shall include a `<user_directives>` section instructing the LLM to capture specific user feedback, corrections, and preferences, using exact quotes where possible.

**Behavior**:
- GIVEN: The compression prompt template
- WHEN: The prompt text is examined
- THEN: It contains a `<user_directives>` section with instructions to preserve user feedback with exact quotes

**Why This Matters**: User corrections and preferences are high-value context that must survive compression.

### REQ-HD-010.3: Errors Encountered Section

**Full Text**: The compression prompt template shall include an `<errors_encountered>` section instructing the LLM to record errors hit, exact messages, root causes, and resolutions.

**Behavior**:
- GIVEN: The compression prompt template
- WHEN: The prompt text is examined
- THEN: It contains an `<errors_encountered>` section with instructions to capture error details and resolutions

**Why This Matters**: Error context prevents the agent from repeating failed approaches after compression.

### REQ-HD-010.4: Code References Section

**Full Text**: The compression prompt template shall include a `<code_references>` section instructing the LLM to preserve important code snippets, exact file paths, and function signatures.

**Behavior**:
- GIVEN: The compression prompt template
- WHEN: The prompt text is examined
- THEN: It contains a `<code_references>` section with instructions to preserve code snippets and file paths

**Why This Matters**: Exact file paths and signatures are essential for the agent to continue modifying code after compression.

### REQ-HD-010.5: Prompt File Update

**Full Text**: The updated prompt sections shall be reflected in both `prompts.ts` (`getCompressionPrompt()`) and the default prompt markdown file (`compression.md` in `prompt-config/defaults/`).

**Behavior**:
- GIVEN: The new prompt sections
- WHEN: Both `prompts.ts` and `compression.md` are examined
- THEN: Both contain the same `<task_context>`, `<user_directives>`, `<errors_encountered>`, and `<code_references>` sections

**Why This Matters**: The two sources of compression prompts must stay in sync.

### REQ-HD-012.2: Transcript Pointer in Summary

**Full Text**: Where `transcriptPath` is present, LLM-based strategies shall include a note in the summary referencing the full pre-compression transcript path.

**Behavior**:
- GIVEN: A `CompressionContext` with `transcriptPath: '/path/to/transcript.log'`
- WHEN: An LLM-based strategy (MiddleOut, OneShot) builds the compression request
- THEN: The summary includes a line: `"Full pre-compression transcript available at: /path/to/transcript.log"`
- AND GIVEN: `transcriptPath` is `undefined`
- THEN: No transcript reference line is included

**Why This Matters**: After compression, the full conversation history is lost from context. A pointer to the transcript file lets the AI or user recover the complete pre-compression record if needed.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/prompts.ts`
  - MODIFY `getCompressionPrompt()`: Add four new XML sections to the `<state_snapshot>` structure:
    - `<task_context>` — instructions to capture per active task: origin, constraints, approach, attempts
    - `<user_directives>` — instructions to preserve user feedback, corrections, preferences with exact quotes
    - `<errors_encountered>` — instructions to record errors, messages, root causes, resolutions
    - `<code_references>` — instructions to preserve code snippets, file paths, function signatures
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P21`
  - Implements: `@requirement REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5`

- `packages/core/src/prompt-config/defaults/compression.md`
  - MODIFY: Add the same four XML sections to the `<state_snapshot>` structure
  - ADD comment (HTML comment at top): `<!-- @plan PLAN-20260211-HIGHDENSITY.P21 -->`
  - Implements: `@requirement REQ-HD-010.5`

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - MODIFY: In the compression request building logic, when `context.transcriptPath` is present, append a line to the summary/request: `"Full pre-compression transcript available at: <path>"`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P21`
  - Implements: `@requirement REQ-HD-012.2`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - MODIFY: In the compression request building logic, when `context.transcriptPath` is present, append a line to the summary/request: `"Full pre-compression transcript available at: <path>"`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P21`
  - Implements: `@requirement REQ-HD-012.2`

### Required Code Markers

```typescript
// In prompts.ts:
/**
 * @plan PLAN-20260211-HIGHDENSITY.P21
 * @requirement REQ-HD-010.1, REQ-HD-010.2, REQ-HD-010.3, REQ-HD-010.4, REQ-HD-010.5
 * @requirement REQ-HD-012.2
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P21" packages/core/src/core/prompts.ts | wc -l
# Expected: 1+ occurrences

# Check new sections in prompts.ts
grep -c "task_context\|user_directives\|errors_encountered\|code_references" packages/core/src/core/prompts.ts
# Expected: 4+ matches (opening + closing tags)

# Check new sections in compression.md
grep -c "task_context\|user_directives\|errors_encountered\|code_references" packages/core/src/prompt-config/defaults/compression.md
# Expected: 4+ matches

# Verify both files have matching sections
diff <(grep -o "<[a-z_]*>" packages/core/src/core/prompts.ts | sort) <(grep -o "<[a-z_]*>" packages/core/src/prompt-config/defaults/compression.md | sort)
# Expected: Sections match (or prompts.ts is a superset)

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors

# Run existing prompt tests
npx vitest run packages/core/src/core/prompts --reporter=verbose 2>&1 | tail -20
# Expected: All pass (if any exist)
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK in modified prompt sections
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/prompts.ts | grep -i "task_context\|user_directives\|errors_encountered\|code_references"
# Expected: No matches

# Check for placeholder content in prompt sections
grep -rn -E "(placeholder|fill in|add here|TBD)" packages/core/src/core/prompts.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `<task_context>` section instructs capture of: origin, constraints, approach, attempts
   - [ ] `<user_directives>` section instructs: exact quotes, feedback, corrections, preferences
   - [ ] `<errors_encountered>` section instructs: errors, messages, root causes, resolutions
   - [ ] `<code_references>` section instructs: snippets, file paths, function signatures
   - [ ] Both `prompts.ts` and `compression.md` updated with same sections
   - [ ] LLM strategies (MiddleOut, OneShot) append transcript pointer when `transcriptPath` is present

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Prompt sections contain meaningful, actionable instructions for the LLM
   - [ ] Instructions are specific enough to produce useful compression output

3. **Would the test FAIL if implementation was removed?**
   - [ ] Not applicable for prompt text (manual/structural verification)
   - [ ] Section existence is verified by grep commands

4. **Is the feature REACHABLE by users?**
   - [ ] LLM-based strategies (MiddleOut, OneShot) use `getCompressionPrompt()` or resolve from `compression.md`
   - [ ] New sections are part of the `<state_snapshot>` template that LLMs fill in

5. **What's MISSING?**
   - [ ] Todo-aware context population (Phase 23)

## Success Criteria

- `prompts.ts` `getCompressionPrompt()` includes all four new XML sections
- `compression.md` includes all four new XML sections
- Both files are in sync on section structure
- LLM strategies (MiddleOut, OneShot) append transcript pointer line when `transcriptPath` is present in context
- Typecheck passes
- No placeholder content in prompt sections
- Existing tests still pass

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/prompts.ts`
2. `git checkout -- packages/core/src/prompt-config/defaults/compression.md`
3. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
4. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
5. Re-run Phase 21

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P21.md`
Contents:
```markdown
Phase: P21
Completed: YYYY-MM-DD HH:MM
Files Modified: [prompts.ts — diff stats, compression.md — diff stats]
Sections Added: task_context, user_directives, errors_encountered, code_references
Verification: [paste of grep outputs]
```

---

# Phase 22: Todo-Aware Summarization TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P22`

## Prerequisites

- Required: Phase 21 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P21" packages/core/src/core/prompts.ts`
- Expected files from previous phase: Updated `prompts.ts` and `compression.md` with enriched prompt sections
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-011.2: Todo Population

**Full Text**: When `buildCompressionContext()` assembles the context for compression, it shall populate `activeTodos` from the current todo state if available.

**Behavior**:
- GIVEN: An active todo list with items `[{ id: '1', content: 'Fix bug', status: 'in_progress' }]`
- WHEN: `buildCompressionContext()` is called
- THEN: The returned `CompressionContext` has `activeTodos` populated with the current todo items

**Why This Matters**: LLM-based strategies need todo context to explain the reasoning behind active tasks in compression summaries.

### REQ-HD-011.3: Todo Inclusion in LLM Request

**Full Text**: When an LLM-based strategy has `activeTodos` in its context, it shall append the todo list to the compression request so the LLM can explain the context behind each active todo in the summary.

**Behavior**:
- GIVEN: A `CompressionContext` with `activeTodos: [{ id: '1', content: 'Fix bug', status: 'in_progress' }]`
- WHEN: An LLM-based strategy (e.g., `MiddleOutStrategy`) processes the context
- THEN: The todo list is included in the LLM request alongside the history to compress

**Why This Matters**: The LLM can produce better summaries when it knows which tasks are active and why.

### REQ-HD-011.4: Non-LLM Strategies Unaffected

**Full Text**: Strategies where `requiresLLM` is `false` (including `HighDensityStrategy`) shall ignore the `activeTodos` field.

**Behavior**:
- GIVEN: A `CompressionContext` with `activeTodos` populated
- WHEN: `HighDensityStrategy.compress(context)` is called
- THEN: It does not access or use `activeTodos` — its behavior is unchanged

**Why This Matters**: Non-LLM strategies have no use for todo context; they compress deterministically.

## Implementation Tasks

### Files to Create/Modify

- `packages/core/src/core/geminiChat.compression.test.ts` (or add to existing test file)
  - ADD test: `buildCompressionContext()` includes `activeTodos` when todo state is available
  - ADD test: `buildCompressionContext()` has `activeTodos: undefined` when no todo state is available
  - ADD test: `activeTodos` reflects current todo items (not stale data)
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P22`
  - Implements: `@requirement REQ-HD-011.2`

- `packages/core/src/core/compression/MiddleOutStrategy.test.ts`
  - ADD test: When `activeTodos` is present in context, todo list is included in LLM compression request
  - ADD test: When `activeTodos` is undefined, LLM request does not reference todos
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P22`
  - Implements: `@requirement REQ-HD-011.3`

- `packages/core/src/core/compression/OneShotStrategy.test.ts`
  - ADD test: When `activeTodos` is present in context, todo list is included in LLM compression request
  - ADD test: When `activeTodos` is undefined, LLM request does not reference todos
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P22`
  - Implements: `@requirement REQ-HD-011.3`

- `packages/core/src/core/compression/HighDensityStrategy.test.ts`
  - ADD test: `compress()` behavior is identical with and without `activeTodos`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P22`
  - Implements: `@requirement REQ-HD-011.4`

### Required Code Markers

```typescript
describe('todo-aware summarization @plan PLAN-20260211-HIGHDENSITY.P22 @requirement REQ-HD-011.2', () => {
  // tests
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P22" packages/core/src/ | wc -l
# Expected: 3+ occurrences

# Run tests (will FAIL — buildCompressionContext doesn't populate activeTodos yet)
npx vitest run packages/core/src/core/geminiChat.compression --reporter=verbose 2>&1 | tail -20
# Expected: New tests fail (RED)

npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: New tests fail (RED)
```

### Structural Verification Checklist

- [ ] Phase 21 markers present in prompts.ts
- [ ] Tests cover REQ-HD-011.2, 011.3, 011.4
- [ ] Tests verify `activeTodos` population in `buildCompressionContext()`
- [ ] Tests verify LLM strategy includes todos in request
- [ ] Tests verify non-LLM strategy ignores todos
- [ ] All tests tagged with plan and requirement IDs
- [ ] Tests will fail naturally until implementation

## Success Criteria

- 6+ tests covering REQ-HD-011.2, 011.3, 011.4
- Tests verify todo population, LLM inclusion, and non-LLM indifference
- New tests FAIL because todo population isn't implemented yet (RED)
- Tests are tagged with P22 marker

## Failure Recovery

If this phase fails:
1. Revert test file changes
2. Re-run Phase 22
3. Cannot proceed to Phase 23 until tests exist and fail correctly

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P22.md`
Contents:
```markdown
Phase: P22
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Added: [count]
Verification: [paste showing tests FAIL as expected]
```

---

# Phase 23: Todo-Aware Summarization Impl

## Phase ID

`PLAN-20260211-HIGHDENSITY.P23`

## Prerequisites

- Required: Phase 22 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P22" packages/core/src/`
- Expected files from previous phase: Updated test files with todo-aware tests
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-011.2: Todo Population

**Full Text**: When `buildCompressionContext()` assembles the context for compression, it shall populate `activeTodos` from the current todo state if available.

**Behavior**:
- GIVEN: An active todo list with items `[{ id: '1', content: 'Fix bug', status: 'in_progress' }]`
- WHEN: `buildCompressionContext()` is called
- THEN: The returned `CompressionContext` has `activeTodos` populated with the current todo items

**Why This Matters**: LLM-based strategies need todo context to explain the reasoning behind active tasks in compression summaries.

### REQ-HD-011.3: Todo Inclusion in LLM Request

**Full Text**: When an LLM-based strategy has `activeTodos` in its context, it shall append the todo list to the compression request so the LLM can explain the context behind each active todo in the summary.

**Behavior**:
- GIVEN: A `CompressionContext` with `activeTodos: [{ id: '1', content: 'Fix bug', status: 'in_progress' }]`
- WHEN: An LLM-based strategy (e.g., `MiddleOutStrategy`) processes the context
- THEN: The todo list is included in the LLM request alongside the history to compress

**Why This Matters**: The LLM can produce better summaries when it knows which tasks are active and why.

### REQ-HD-011.4: Non-LLM Strategies Unaffected

**Full Text**: Strategies where `requiresLLM` is `false` (including `HighDensityStrategy`) shall ignore the `activeTodos` field.

**Behavior**:
- GIVEN: A `CompressionContext` with `activeTodos` populated
- WHEN: `HighDensityStrategy.compress(context)` is called
- THEN: It does not access or use `activeTodos` — its behavior is unchanged

**Why This Matters**: Non-LLM strategies have no use for todo context; they compress deterministically.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/geminiChat.ts`
  - MODIFY `buildCompressionContext()`:
    - Obtain the current todo list from `TodoContextTracker` or the session's todo state
    - Add `activeTodos: currentTodos` to the returned `CompressionContext`
    - If todo state is unavailable (no active session, no tracker), set `activeTodos: undefined`
  - ADD import: `import { TodoContextTracker } from '../services/todo-context-tracker.js'` (or appropriate source)
  - ADD import: `import type { Todo } from '../tools/todo-schemas.js'` (if needed for type)
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P23`
  - Implements: `@requirement REQ-HD-011.2`

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - MODIFY: When building the LLM compression request, check for `context.activeTodos`
  - If present and non-empty: append a formatted todo list section to the compression prompt
  - Format: `"\n\nActive tasks:\n"` followed by each todo formatted as `"- [status] content"`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P23`
  - Implements: `@requirement REQ-HD-011.3`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - MODIFY: When building the LLM compression request, check for `context.activeTodos`
  - If present and non-empty: append a formatted todo list section to the compression prompt
  - Format: `"\n\nActive tasks:\n"` followed by each todo formatted as `"- [status] content"`
  - ADD comment: `@plan PLAN-20260211-HIGHDENSITY.P23`
  - Implements: `@requirement REQ-HD-011.3`

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - VERIFY: `compress()` does not access `context.activeTodos` (already true from P14)
  - No changes needed if `compress()` already ignores unknown context fields
  - ADD comment if verification added: `@plan PLAN-20260211-HIGHDENSITY.P23`
  - Implements: `@requirement REQ-HD-011.4`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P23
 * @requirement REQ-HD-011.2
 */
// In buildCompressionContext():
activeTodos: this.getActiveTodos(),
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan PLAN-20260211-HIGHDENSITY.P23" packages/core/src/ | wc -l
# Expected: 2+ occurrences

# Check activeTodos in buildCompressionContext
grep -n 'activeTodos' packages/core/src/core/geminiChat.ts
# Expected: Assignment in buildCompressionContext

# Check LLM strategy todo inclusion (MiddleOut)
grep -n 'activeTodos' packages/core/src/core/compression/MiddleOutStrategy.ts
# Expected: Check and append in compress method

# Check LLM strategy todo inclusion (OneShot)
grep -n 'activeTodos' packages/core/src/core/compression/OneShotStrategy.ts
# Expected: Check and append in compress method

# Run P22 tests — should now PASS (GREEN)
npx vitest run packages/core/src/core/geminiChat.compression --reporter=verbose 2>&1 | tail -20
npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts --reporter=verbose 2>&1 | tail -20
npx vitest run packages/core/src/core/compression/OneShotStrategy.test.ts --reporter=verbose 2>&1 | tail -20
npx vitest run packages/core/src/core/compression/HighDensityStrategy.test.ts --reporter=verbose 2>&1 | tail -20
# Expected: All pass

# Run ALL compression tests
npx vitest run packages/core/src/core/compression/ --reporter=verbose 2>&1 | tail -40
# Expected: All pass

# Typecheck
npx tsc --noEmit -p packages/core/tsconfig.json
# Expected: No errors
```

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for TODO/FIXME/HACK
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/geminiChat.ts | grep -i "todo\|activeTodo"
# Expected: No matches related to todo population

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/geminiChat.ts | grep -i "todo\|activeTodo"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] `buildCompressionContext()` populates `activeTodos` from todo state
   - [ ] `activeTodos` is `undefined` when no todo state is available
   - [ ] LLM-based strategy includes todo list in compression request when present
   - [ ] LLM request omits todos when `activeTodos` is undefined or empty
   - [ ] `HighDensityStrategy.compress()` ignores `activeTodos`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] `buildCompressionContext()` actually retrieves todo data
   - [ ] LLM strategy actually formats and appends todo list to prompt

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify `activeTodos` is present in context when todos exist
   - [ ] Tests verify LLM request includes todo text
   - [ ] Tests verify non-LLM strategy output is unchanged

4. **Is the feature REACHABLE by users?**
   - [ ] When users have active todos and compression triggers, todo context is preserved
   - [ ] Works with all LLM-based strategies (MiddleOut, OneShot)

5. **What's MISSING?**
   - [ ] `transcriptPath` population (REQ-HD-012 — low priority, deferred)

#### Integration Points Verified

- [ ] `TodoContextTracker` or todo state accessible from `GeminiChat`
- [ ] `Todo` type compatible with `CompressionContext.activeTodos`
- [ ] LLM strategy's prompt building supports dynamic sections
- [ ] All existing compression tests still pass

## Success Criteria

- All P22 tests pass (GREEN)
- All existing compression and geminiChat tests still pass
- Typecheck passes
- `buildCompressionContext()` populates `activeTodos`
- LLM-based strategies include todos in compression request
- `HighDensityStrategy` ignores `activeTodos`
- Deferred implementation detection passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/geminiChat.ts`
2. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
3. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
4. Re-run Phase 23
5. Cannot proceed to Phase 24 until P22 tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P23.md`
Contents:
```markdown
Phase: P23
Completed: YYYY-MM-DD HH:MM
Files Modified: [list with diff stats]
Tests Passing: [count]
Verification: [paste of test output + typecheck]
```

---

# Phase 24: Full Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P24`

## Prerequisites

- Required: Phase 23 completed
- Verification: `grep -r "@plan PLAN-20260211-HIGHDENSITY.P23" packages/core/src/`
- Expected files from previous phase: Updated `geminiChat.ts`, `MiddleOutStrategy.ts` with todo-aware summarization
- Preflight verification: ALL phases P01–P23 MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-013.1: Optimize Exception Propagation

**Full Text**: If `strategy.optimize()` throws, the system shall propagate the error. The density optimization step shall not silently swallow exceptions.

**Behavior**:
- GIVEN: `strategy.optimize()` throws an error
- WHEN: `ensureDensityOptimized()` calls it
- THEN: The error propagates up through `ensureCompressionBeforeSend()` to the caller

**Why This Matters**: Silent failures would leave the system in an inconsistent state with no debugging information.

### REQ-HD-013.2: Apply Exception Propagation

**Full Text**: If `historyService.applyDensityResult()` throws (due to conflict invariant violation or bounds check), the system shall propagate the error.

**Behavior**:
- GIVEN: `applyDensityResult()` throws due to an invalid `DensityResult`
- WHEN: `ensureDensityOptimized()` calls it
- THEN: The error propagates to the caller

**Why This Matters**: Conflict invariant and bounds violations indicate bugs in the strategy; they must be surfaced.

### REQ-HD-013.3: Token Recalculation Failure

**Full Text**: If token recalculation fails after density application, the system shall propagate the error.

**Behavior**:
- GIVEN: `recalculateTotalTokens()` throws
- WHEN: Called as part of `applyDensityResult()`
- THEN: The error propagates

**Why This Matters**: Token count accuracy is critical for compression decisions.

### REQ-HD-013.4: Compress Fallback Unchanged

**Full Text**: The `HighDensityStrategy.compress()` failure behavior shall follow the same pattern as existing strategies: propagate the error, no silent fallback to a different strategy.

**Behavior**:
- GIVEN: `HighDensityStrategy.compress()` encounters an error
- WHEN: The error occurs
- THEN: It propagates (no catch-and-fallback)

**Why This Matters**: Consistent error handling across all strategies.

### REQ-HD-013.5: Malformed Tool Parameters

**Full Text**: Where a tool call's `parameters` field is not an object or does not contain a recognizable file path key, the strategy shall skip that tool call for pruning purposes. It shall not throw.

**Behavior**:
- GIVEN: A tool call with `parameters: "invalid"` or `parameters: { unknown_key: 'value' }`
- WHEN: The pruning logic processes it
- THEN: It skips the tool call gracefully (no error thrown)
- AND: Other valid tool calls in the same history are still processed

**Why This Matters**: Real histories may contain tool calls with unexpected parameter shapes; the system must be resilient.

### REQ-HD-013.6: Invalid Recency Retention

**Full Text**: Where `recencyRetention` in `DensityConfig` is less than 1, the system shall treat it as 1 (retain at least the most recent result per tool type).

**Behavior**:
- GIVEN: `DensityConfig` with `recencyRetention: 0` or `recencyRetention: -1`
- WHEN: Recency pruning runs
- THEN: It behaves as if `recencyRetention` were 1

**Why This Matters**: Prevents accidental removal of all tool results for a given type.

### REQ-HD-013.7: Metadata Accuracy

**Full Text**: The counts in `DensityResultMetadata` (`readWritePairsPruned`, `fileDeduplicationsPruned`, `recencyPruned`) shall accurately reflect the number of entries actually marked for removal or replacement by each optimization pass.

**Behavior**:
- GIVEN: An optimization pass that removes 3 stale reads, deduplicates 2 file inclusions, and prunes 5 tool results
- WHEN: The `DensityResult.metadata` is examined
- THEN: `readWritePairsPruned === 3`, `fileDeduplicationsPruned === 2`, `recencyPruned === 5`

**Why This Matters**: Accurate metadata enables meaningful logging and debugging.

## Implementation Tasks

### Full Verification Suite

This phase does NOT create new code. It runs the full verification pipeline across ALL phases to ensure everything works together end-to-end.

### Verification Steps

1. **Run all tests**
2. **Run linting**
3. **Run typecheck**
4. **Run formatting**
5. **Run build**
6. **Run smoke test**
7. **Verify all phase completion markers**
8. **Verify all requirements are covered**

## Verification Commands

### Automated Checks (Full Pipeline)

```bash
# === Step 1: Run ALL tests ===
npm run test
# Expected: All pass

# === Step 2: Run linting ===
npm run lint
# Expected: No errors

# === Step 3: Run typecheck ===
npm run typecheck
# Expected: No errors

# === Step 4: Run formatting ===
npm run format
# Expected: No changes (already formatted)

# === Step 5: Run build ===
npm run build
# Expected: Clean build

# === Step 6: Run smoke test ===
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: Successful output without errors

# === Step 7: Run high-density specific tests ===
npx vitest run packages/core/src/core/compression/HighDensityStrategy.test.ts --reporter=verbose 2>&1 | tail -40
npx vitest run packages/core/src/core/compression/readWritePruning.test.ts --reporter=verbose 2>&1 | tail -40
npx vitest run packages/core/src/core/compression/fileDedup.test.ts --reporter=verbose 2>&1 | tail -40
npx vitest run packages/core/src/core/compression/recencyPruning.test.ts --reporter=verbose 2>&1 | tail -40
npx vitest run packages/core/src/services/history/HistoryService.density.test.ts --reporter=verbose 2>&1 | tail -40
npx vitest run packages/core/src/core/geminiChat.density.test.ts --reporter=verbose 2>&1 | tail -40
# Expected: All pass

# === Step 8: Run ALL compression tests ===
npx vitest run packages/core/src/core/compression/ --reporter=verbose 2>&1 | tail -60
# Expected: All pass (including MiddleOut, TopDown, OneShot, factory)

# === Step 9: Verify no deferred implementations across ALL new files ===
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" \
  packages/core/src/core/compression/HighDensityStrategy.ts \
  packages/core/src/core/compression/readWritePruning.ts \
  packages/core/src/core/compression/fileDedup.ts \
  packages/core/src/core/compression/recencyPruning.ts
# Expected: No matches

# === Step 10: Verify plan markers across all phases ===
for phase in P02 P03 P04 P05 P06 P07 P08 P09 P10 P11 P12 P13 P14 P15 P16 P17 P18 P19 P20 P21 P22 P23; do
  count=$(grep -r "@plan PLAN-20260211-HIGHDENSITY.$phase" packages/core/src/ | wc -l)
  echo "Phase $phase markers: $count"
done
# Expected: Each phase has 1+ markers

# === Step 11: Verify requirement coverage ===
echo "=== REQ-HD-001 (Types) ==="
grep -r "REQ-HD-001" packages/core/src/ | wc -l

echo "=== REQ-HD-002 (Orchestration) ==="
grep -r "REQ-HD-002" packages/core/src/ | wc -l

echo "=== REQ-HD-003 (HistoryService) ==="
grep -r "REQ-HD-003" packages/core/src/ | wc -l

echo "=== REQ-HD-004 (Registration) ==="
grep -r "REQ-HD-004" packages/core/src/ | wc -l

echo "=== REQ-HD-005 (ReadWrite) ==="
grep -r "REQ-HD-005" packages/core/src/ | wc -l

echo "=== REQ-HD-006 (FileDedup) ==="
grep -r "REQ-HD-006" packages/core/src/ | wc -l

echo "=== REQ-HD-007 (Recency) ==="
grep -r "REQ-HD-007" packages/core/src/ | wc -l

echo "=== REQ-HD-008 (Compress) ==="
grep -r "REQ-HD-008" packages/core/src/ | wc -l

echo "=== REQ-HD-009 (Settings) ==="
grep -r "REQ-HD-009" packages/core/src/ | wc -l

echo "=== REQ-HD-010 (Prompts) ==="
grep -r "REQ-HD-010" packages/core/src/ | wc -l

echo "=== REQ-HD-011 (Todo-Aware) ==="
grep -r "REQ-HD-011" packages/core/src/ | wc -l

echo "=== REQ-HD-013 (Failure Modes) ==="
grep -r "REQ-HD-013" packages/core/src/ | wc -l
# Expected: All non-zero

# === Step 12: Verify phase completion markers ===
ls -la project-plans/issue236hdcompression/.completed/
# Expected: P01.md through P23.md all present
```

### REQ-HD-013 Coverage Verification

The failure mode requirements (REQ-HD-013.1–013.7) are covered across multiple phases:

| Requirement | Covered In | How |
|-------------|-----------|-----|
| REQ-HD-013.1 (optimize exception) | P19/P20 | `ensureDensityOptimized()` does not catch — errors propagate |
| REQ-HD-013.2 (apply exception) | P05/P06 | `applyDensityResult()` throws on conflict/bounds |
| REQ-HD-013.3 (token recalc failure) | P05/P06 | `recalculateTotalTokens()` errors propagate through tokenizerLock |
| REQ-HD-013.4 (compress fallback) | P13/P14 | `compress()` has no try/catch fallback |
| REQ-HD-013.5 (malformed params) | P07/P08 | `extractFilePath` returns undefined for non-object params |
| REQ-HD-013.6 (invalid retention) | P11/P12 | `pruneByRecency` clamps to `Math.max(1, retention)` |
| REQ-HD-013.7 (metadata accuracy) | P07/P08, P09/P10, P11/P12 | Each pruning module returns accurate counts |

### Full Requirements Traceability

| Requirement Group | Phases | Status |
|-------------------|--------|--------|
| REQ-HD-001 (Types & Interface) | P02, P03, P04 | Types, triggers, interface |
| REQ-HD-002 (Orchestration) | P19, P20 | ensureDensityOptimized, dirty flag |
| REQ-HD-003 (HistoryService) | P05, P06 | applyDensityResult, getRawHistory, recalculateTotalTokens |
| REQ-HD-004 (Registration) | P02, P15, P16 | COMPRESSION_STRATEGIES, factory, settings enum |
| REQ-HD-005 (ReadWrite Pruning) | P07, P08 | pruneReadWritePairs |
| REQ-HD-006 (File Dedup) | P09, P10 | deduplicateFileInclusions |
| REQ-HD-007 (Recency Pruning) | P11, P12 | pruneByRecency |
| REQ-HD-008 (Threshold Compression) | P13, P14 | HighDensityStrategy.compress() |
| REQ-HD-009 (Settings) | P17, P18 | 4 density settings, 4 runtime accessors |
| REQ-HD-010 (Enriched Prompts) | P21 | task_context, user_directives, errors_encountered, code_references |
| REQ-HD-011 (Todo-Aware) | P02, P22, P23 | activeTodos in CompressionContext, buildCompressionContext population |
| REQ-HD-012 (Transcript) | P02, P21 | transcriptPath in CompressionContext, transcript pointer in LLM strategies |
| REQ-HD-013 (Failure Modes) | P05/P06, P07/P08, P11/P12, P13/P14, P19/P20 | Distributed across phases |

## Success Criteria

- ALL tests pass (`npm run test`)
- Linting passes (`npm run lint`)
- Typecheck passes (`npm run typecheck`)
- Formatting is clean (`npm run format`)
- Build succeeds (`npm run build`)
- Smoke test passes (`node scripts/start.js --profile-load syntheticglm47 "write me a haiku"`)
- All phase completion markers present (P01–P23)
- All requirement groups have non-zero code markers
- No deferred implementations in any new file
- All 13 requirement groups are traceable to implementation phases

## Failure Recovery

If this phase fails:
1. Identify which specific verification step failed
2. Trace failure to the responsible phase
3. Re-run that phase's implementation (re-execute with the typescriptexpert subagent)
4. Re-run Phase 24 verification
5. Loop until all checks pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P24.md`
Contents:
```markdown
Phase: P24
Completed: YYYY-MM-DD HH:MM
Full Test Suite: [pass count / total]
Lint: PASS
Typecheck: PASS
Format: CLEAN
Build: PASS
Smoke Test: PASS
Phase Markers: P01–P23 all present
Requirement Coverage: All 13 groups verified
Deferred Implementation Check: CLEAN
```

