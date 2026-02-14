# Phase 03: Types & Strategy Interface — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P03`

## Prerequisites

- Required: Phase 02 completed
- Verification: `test -f project-plans/issue236hdcompression/.completed/P02.md && echo "PASS"`
- Expected files from previous phase:
  - `analysis/pseudocode/strategy-interface.md`
  - `analysis/pseudocode/history-service.md`
  - `analysis/pseudocode/high-density-optimize.md`
- Preflight verification: Phase 01a MUST be completed

## Requirements Implemented (Expanded)

### REQ-HD-001.1: Trigger Declaration

**Full Text**: Every `CompressionStrategy` shall declare a `trigger` property of type `StrategyTrigger`, which is either `{ mode: 'threshold'; defaultThreshold: number }` or `{ mode: 'continuous'; defaultThreshold: number }`.

**Behavior**:
- GIVEN: The CompressionStrategy interface in types.ts
- WHEN: A strategy class implements the interface
- THEN: It must include a `trigger` property of type `StrategyTrigger`

### REQ-HD-001.2: Optional Optimize Method

**Full Text**: The `CompressionStrategy` interface shall include an optional `optimize` method with signature `optimize(history: readonly IContent[], config: DensityConfig): DensityResult`.

**Behavior**:
- GIVEN: The CompressionStrategy interface
- WHEN: A strategy class is defined
- THEN: It MAY optionally implement `optimize()` — threshold-only strategies omit it

### REQ-HD-001.5: DensityResult Structure

**Full Text**: The `DensityResult` interface shall contain `removals` (readonly array of indices), `replacements` (readonly map of index to `IContent`), and `metadata` (of type `DensityResultMetadata`).

### REQ-HD-001.8: DensityResultMetadata

**Full Text**: The `DensityResultMetadata` shall contain `readWritePairsPruned` (number), `fileDeduplicationsPruned` (number), and `recencyPruned` (number).

### REQ-HD-001.9: DensityConfig Structure

**Full Text**: The `DensityConfig` interface shall contain `readWritePruning` (boolean), `fileDedupe` (boolean), `recencyPruning` (boolean), `recencyRetention` (number), and `workspaceRoot` (string). All fields shall be `readonly`.

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: The `MiddleOutStrategy`, `TopDownTruncationStrategy`, and `OneShotStrategy` shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/types.ts`
  - ADD: `StrategyTrigger` type (pseudocode lines 11–13)
  - ADD: `DensityResult` interface (pseudocode lines 16–19)
  - ADD: `DensityResultMetadata` interface (pseudocode lines 22–25)
  - ADD: `DensityConfig` interface (pseudocode lines 28–33)
  - ADD: `'high-density'` to `COMPRESSION_STRATEGIES` tuple (pseudocode lines 36–41)
  - UPDATE: `CompressionStrategy` interface — add `trigger` (required) and `optimize?` (optional) (pseudocode lines 47–59)
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P03`
  - MUST include: `@requirement:REQ-HD-001.1, REQ-HD-001.2, REQ-HD-001.5, REQ-HD-001.8, REQ-HD-001.9, REQ-HD-004.1`

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };` (pseudocode lines 70–74)
  - ADD import for `StrategyTrigger` from `./types.js`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P03`

- `packages/core/src/core/compression/TopDownTruncationStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };` (pseudocode lines 80–84)
  - ADD import for `StrategyTrigger` from `./types.js`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P03`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - ADD: `readonly trigger: StrategyTrigger = { mode: 'threshold', defaultThreshold: 0.85 };` (pseudocode lines 90–94)
  - ADD import for `StrategyTrigger` from `./types.js`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P03`

### Required Code Markers

Every type, interface, and property added in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P03
 * @requirement REQ-HD-001.1
 * @pseudocode strategy-interface.md lines 11-13
 */
```

### Stub Rules

- New types/interfaces are REAL type definitions, not stubs (types don't need stub implementations)
- The `trigger` property on existing strategies is a REAL property with a real value
- The `optimize?` method on the interface is optional — existing strategies do NOT implement it
- `COMPRESSION_STRATEGIES` tuple includes `'high-density'` — this is a real constant change
- NO `HighDensityStrategy` class in this phase (that's P09)
- The factory does NOT need updating yet (no class to instantiate)

## Verification Commands

```bash
# TypeScript must compile
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# Verify new types exist
grep -q "StrategyTrigger" packages/core/src/core/compression/types.ts && echo "PASS: StrategyTrigger" || echo "FAIL"
grep -q "DensityResult" packages/core/src/core/compression/types.ts && echo "PASS: DensityResult" || echo "FAIL"
grep -q "DensityResultMetadata" packages/core/src/core/compression/types.ts && echo "PASS: DensityResultMetadata" || echo "FAIL"
grep -q "DensityConfig" packages/core/src/core/compression/types.ts && echo "PASS: DensityConfig" || echo "FAIL"

# Verify high-density in COMPRESSION_STRATEGIES
grep -q "'high-density'" packages/core/src/core/compression/types.ts && echo "PASS: high-density in tuple" || echo "FAIL"

# Verify trigger on existing strategies
grep -q "trigger" packages/core/src/core/compression/MiddleOutStrategy.ts && echo "PASS: MiddleOut trigger" || echo "FAIL"
grep -q "trigger" packages/core/src/core/compression/TopDownTruncationStrategy.ts && echo "PASS: TopDown trigger" || echo "FAIL"
grep -q "trigger" packages/core/src/core/compression/OneShotStrategy.ts && echo "PASS: OneShot trigger" || echo "FAIL"

# Verify plan markers
grep -r "@plan.*HIGHDENSITY.P03" packages/core/src/core/compression/ | wc -l
# Expected: ≥ 4 (types.ts + 3 strategies)

# Check for forbidden patterns
grep -r "TODO" packages/core/src/core/compression/types.ts | grep -v "test" && echo "FAIL: TODO found" || echo "PASS: no TODOs"

# Existing tests still pass
npm run test -- --run 2>&1 | tail -5
```

## Success Criteria

- `npx tsc --noEmit` passes with 0 errors
- All 4 new types/interfaces exist in types.ts
- `'high-density'` is in the COMPRESSION_STRATEGIES tuple
- All 3 existing strategies have `trigger` property
- `@plan:PLAN-20260211-HIGHDENSITY.P03` markers present in all modified files
- Existing tests pass unchanged
- No TODO comments in modified files

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/types.ts`
2. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
3. `git checkout -- packages/core/src/core/compression/TopDownTruncationStrategy.ts`
4. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
5. Cannot proceed to Phase 04 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P03.md`
Contents:
```markdown
Phase: P03
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/types.ts [+N lines]
  - packages/core/src/core/compression/MiddleOutStrategy.ts [+N lines]
  - packages/core/src/core/compression/TopDownTruncationStrategy.ts [+N lines]
  - packages/core/src/core/compression/OneShotStrategy.ts [+N lines]
Tests Added: 0 (stub phase)
Verification: [paste verification output]
```
