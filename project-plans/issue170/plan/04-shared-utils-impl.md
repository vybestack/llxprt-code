# Phase 04: Shared Utilities Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P04`

## Prerequisites

- Required: Phase 03 completed (tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P03" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/utils.test.ts`

## Requirements Implemented (Expanded)

Same as Phase 03: REQ-CS-004.1–004.4 (now making those tests GREEN).

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

# No TODO/FIXME in implementation
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/core/compression/utils.ts
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

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
