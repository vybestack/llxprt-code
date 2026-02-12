# Phase 05: Types & Strategy Interface — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P05`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P04" packages/core/src/core/compression/__tests__/ | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/types-highdensity.test.ts`
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-001.1: Trigger Declaration

**Full Text**: Every `CompressionStrategy` shall declare a `trigger` property of type `StrategyTrigger`.
**Behavior**:
- GIVEN: The CompressionStrategy interface
- WHEN: Any strategy implements it
- THEN: TypeScript enforces a `trigger` property of type `StrategyTrigger`
**Why This Matters**: The orchestrator uses `trigger.mode` to decide whether to call `optimize()` before threshold checks. Without trigger, the orchestrator can't distinguish continuous from threshold-only strategies.

### REQ-HD-001.2: Optional Optimize Method

**Full Text**: The `CompressionStrategy` interface shall include an optional `optimize` method.
**Why This Matters**: Only continuous strategies implement `optimize()`. Making it optional avoids forcing threshold-only strategies to add dead code.

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: Existing strategies declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.
**Why This Matters**: Backward compatibility — existing strategies behave identically but now carry metadata the orchestrator can inspect.

### REQ-HD-001.4: Existing Strategy Compatibility

**Full Text**: Existing strategies shall not implement `optimize`. Their `compress` behavior shall remain unchanged.
**Why This Matters**: This is a non-breaking change. No existing behavior should be altered.

### REQ-HD-001.5: DensityResult Structure

**Full Text**: `DensityResult` contains removals, replacements, metadata.
**Why This Matters**: The structure drives `applyDensityResult()` — removals are indices to delete, replacements are indices to swap. The structure must be precise for correctness.

### REQ-HD-001.8: DensityResultMetadata

**Full Text**: Metadata contains counts for each pruning category.
**Why This Matters**: Enables logging and debugging of optimization effectiveness.

### REQ-HD-001.9: DensityConfig Structure

**Full Text**: Config contains boolean/number fields controlling each optimization pass.
**Why This Matters**: Users can toggle individual optimizations via settings without changing strategy.

### REQ-HD-001.10: Threshold Precedence

**Full Text**: Ephemeral override → profile setting → strategy `trigger.defaultThreshold`.
**Why This Matters**: Users can override thresholds per-session or per-profile without modifying strategy code.

### REQ-HD-004.1: Strategy Name

**Full Text**: COMPRESSION_STRATEGIES includes 'high-density'.
**Why This Matters**: The settings enum derives from this tuple — adding 'high-density' makes it a valid value for the compression.strategy setting automatically.

## Implementation Tasks

### Files to Modify

Since the types are already real definitions (not stubs) from P03, this phase ensures:

1. **All P04 tests pass** — If any tests fail, the implementation must be adjusted
2. **Exports are correct** — All new types are exported from the module's index.ts
3. **No deferred work** — No TODOs, no placeholders

- `packages/core/src/core/compression/types.ts`
  - Verify all types match pseudocode/strategy-interface.md lines 10–65 EXACTLY
  - Ensure exports include: `StrategyTrigger`, `DensityResult`, `DensityResultMetadata`, `DensityConfig`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P05`
  - MUST include: `@requirement:REQ-HD-001.1, REQ-HD-001.2, REQ-HD-001.5, REQ-HD-001.8, REQ-HD-001.9, REQ-HD-004.1`

- `packages/core/src/core/compression/index.ts`
  - Verify new types are re-exported
  - ADD: export of `StrategyTrigger`, `DensityResult`, `DensityResultMetadata`, `DensityConfig` if not present

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - Verify trigger implementation matches pseudocode lines 70–74
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P05`
  - MUST include: `@pseudocode strategy-interface.md lines 70-74`

- `packages/core/src/core/compression/TopDownTruncationStrategy.ts`
  - Verify trigger implementation matches pseudocode lines 80–84
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P05`
  - MUST include: `@pseudocode strategy-interface.md lines 80-84`

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - Verify trigger implementation matches pseudocode lines 90–94
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P05`
  - MUST include: `@pseudocode strategy-interface.md lines 90-94`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P05
 * @requirement REQ-HD-001.1
 * @pseudocode strategy-interface.md lines 11-13
 */
export type StrategyTrigger = ...
```

## Verification Commands

```bash
# All P04 tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: All pass

# TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# Full test suite passes
npm run test -- --run
# Expected: All pass

# Plan markers updated to P05
grep -r "@plan.*HIGHDENSITY.P05" packages/core/src/core/compression/ | wc -l
# Expected: ≥ 4

# Exports include new types
grep -E "StrategyTrigger|DensityResult|DensityConfig|DensityResultMetadata" packages/core/src/core/compression/index.ts | wc -l
# Expected: ≥ 4
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P04)
- [ ] No skipped phases (P04 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection

```bash
# Check for deferred work in modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/types.ts packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts | grep -v ".test.ts"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/types.ts | grep -v ".test.ts"
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/types.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-001.1: `trigger` is a required property on `CompressionStrategy` — verified by reading interface
   - [ ] REQ-HD-001.2: `optimize?` is optional on `CompressionStrategy` — verified by reading interface
   - [ ] REQ-HD-001.3: Each existing strategy has `{ mode: 'threshold', defaultThreshold: 0.85 }` — verified by reading each file
   - [ ] REQ-HD-001.4: No existing strategy implements `optimize()` — verified by reading each file
   - [ ] REQ-HD-001.5: `DensityResult` has correct 3-field shape — verified by reading types.ts
   - [ ] REQ-HD-001.8: `DensityResultMetadata` has correct 3-field shape — verified by reading types.ts
   - [ ] REQ-HD-001.9: `DensityConfig` has correct 5-field shape, all readonly — verified by reading types.ts
   - [ ] REQ-HD-004.1: `'high-density'` in COMPRESSION_STRATEGIES — verified by reading types.ts

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Types are fully defined (not `any` or `unknown` shortcuts)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing `trigger` from MiddleOutStrategy would fail test #5
   - [ ] Removing `'high-density'` from tuple would fail test #1

4. **Is the feature REACHABLE?**
   - [ ] New types are exported from index.ts
   - [ ] Existing strategies compile with new interface requirements

## Success Criteria

- ALL P04 tests pass
- TypeScript compiles cleanly
- Full test suite passes
- No deferred implementation detected
- All semantic verification items checked
- Plan markers with P05 present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/types.ts`
2. `git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts`
3. `git checkout -- packages/core/src/core/compression/TopDownTruncationStrategy.ts`
4. `git checkout -- packages/core/src/core/compression/OneShotStrategy.ts`
5. `git checkout -- packages/core/src/core/compression/index.ts`
6. Cannot proceed to Phase 06 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P05.md`
Contents:
```markdown
Phase: P05
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/types.ts [+N lines]
  - packages/core/src/core/compression/index.ts [+N lines]
  - packages/core/src/core/compression/MiddleOutStrategy.ts [+N lines]
  - packages/core/src/core/compression/TopDownTruncationStrategy.ts [+N lines]
  - packages/core/src/core/compression/OneShotStrategy.ts [+N lines]
Tests Passing: [all count]
Verification: [paste verification output]

## Holistic Functionality Assessment
[Worker MUST fill this in — see PLAN.md Semantic Verification Checklist]
```
