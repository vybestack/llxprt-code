# Phase 04: Shared Utilities Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P04`

## Prerequisites

- Required: Phase 03 completed (tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P03" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/utils.test.ts`

## Requirements Implemented

- **REQ-CS-004.1**: Boundary Adjustment — `adjustForToolCallBoundary()` extracted as pure function
- **REQ-CS-004.2**: Forward Search — `findForwardValidSplitPoint()` extracted as pure function
- **REQ-CS-004.3**: Backward Search — `findBackwardValidSplitPoint()` extracted as pure function
- **REQ-CS-004.4**: Behavioral Equivalence — identical logic to current geminiChat.ts

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/utils.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P04`
  - MUST include: `@requirement REQ-CS-004.1, REQ-CS-004.2, REQ-CS-004.3, REQ-CS-004.4`
  - Extract from `geminiChat.ts`:
    - `adjustForToolCallBoundary(history: IContent[], index: number): number`
    - `findForwardValidSplitPoint(history: IContent[], index: number): number`
    - `findBackwardValidSplitPoint(history: IContent[], startIndex: number): number`
  - These are PURE functions (no `this` context) — extract the logic, adapt from `this.logger` to a logger parameter or remove debug logging for now
  - Import types: `IContent`, `ToolCallBlock`, `ToolResponseBlock` from the existing history types

### Files to Modify

- `packages/core/src/core/compression/index.ts` — add exports for utility functions

### CRITICAL: Behavioral Equivalence

The extracted functions MUST produce identical results to the current `geminiChat.ts` implementations for the same inputs. Read the current implementations carefully:

- `geminiChat.ts` lines ~2102–2201: `adjustForToolCallBoundary`, `findForwardValidSplitPoint`, `findBackwardValidSplitPoint`
- The functions reference `history[index].speaker === 'tool'`, `blocks.filter(b => b.type === 'tool_call')`, and `ToolResponseBlock.callId` matching

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-COMPRESSION.P04
 * @requirement REQ-CS-004.1
 */
export function adjustForToolCallBoundary(
  history: IContent[],
  index: number,
): number {
  // ...
}
```

## Verification Commands

```bash
# All Phase 03 tests pass
npx vitest run packages/core/src/core/compression/utils.test.ts
# Expected: all pass

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P04" packages/core/src/core/compression/utils.ts | wc -l
# Expected: 3+ occurrences

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/compression/utils.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/utils.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/utils.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-004.1–004.4)
   - [ ] Read the implementation code in `utils.ts`
   - [ ] Can explain HOW each boundary adjustment function fulfills the requirement

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual split-point outputs, not just that code ran
   - [ ] Tests would catch a broken boundary adjustment

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths (or will be once dispatcher is wired in P14)
   - [ ] There is a path from runtime to this code (used by strategies in P06, P08)

### Integration Points Verified

- [ ] Caller passes correct data type to callee (verified by reading both files)
- [ ] Return value used correctly by caller (verified by checking usage site)
- [ ] Error handling works at component boundaries

### Edge Cases Verified

- [ ] Empty/null input handled (empty history, index 0)
- [ ] Invalid input rejected with clear error
- [ ] Boundary values work correctly (index at end of array, all-tool-response history)

## Success Criteria

- All Phase 03 tests pass
- Functions are pure (no `this` binding, no class)
- Identical logic to current geminiChat.ts implementations
- TypeScript strict mode compiles
- Full test suite still passes (no regressions)

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/utils.ts packages/core/src/core/compression/index.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P04.md`
Contents:
```
Phase: P04
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
