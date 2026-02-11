# Phase 08: Top-Down Truncation Strategy Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P08`

## Prerequisites

- Required: Phase 07 completed (tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P07" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/TopDownTruncationStrategy.test.ts` (failing tests)

## Requirements Implemented (Expanded)

REQ-CS-003.1–003.5 (making Phase 07 tests GREEN).

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/TopDownTruncationStrategy.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P08`
  - MUST include: `@requirement REQ-CS-003.1, REQ-CS-003.2, REQ-CS-003.3, REQ-CS-003.5`
  - Implements `CompressionStrategy` interface
  - `name: 'top-down-truncation' as const`
  - `requiresLLM: false`
  - `compress(context: CompressionContext): Promise<CompressionResult>`
  - Algorithm:
    1. Calculate target token count: `context.runtimeContext.ephemerals.compressionThreshold() * contextLimit * SOME_REDUCTION_FACTOR`
       (The target should be significantly below the threshold that triggered compression — e.g., aim for 50% of context limit)
    2. Start with full history. Incrementally remove from the front.
    3. At each step, use `adjustForToolCallBoundary()` to find the valid truncation point
    4. Use `context.estimateTokens(remainingHistory)` to check if under target
    5. Stop when under target OR when only 2 messages remain (minimum preservation)
    6. Return `CompressionResult` with surviving messages and metadata

  - OPTIMIZATION NOTE: Rather than calling `estimateTokens` repeatedly (expensive), consider:
    - Estimating tokens per-message once, then summing from the kept portion
    - Or using a binary search approach for the truncation point
    - The tests don't care about the algorithm — they care about the behavior (correct truncation, boundaries respected, minimum preserved)

### Files to Modify

- `packages/core/src/core/compression/index.ts` — export `TopDownTruncationStrategy`

## Verification Commands

```bash
# All Phase 07 tests pass
npx vitest run packages/core/src/core/compression/TopDownTruncationStrategy.test.ts
# Expected: all pass

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P08" packages/core/src/core/compression/ | wc -l

# No deferred implementation
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/core/compression/TopDownTruncationStrategy.ts
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Success Criteria

- All Phase 07 tests pass
- No LLM calls in the implementation (no provider usage)
- Uses shared `adjustForToolCallBoundary` from `utils.ts`
- Minimum 2-message preservation enforced
- Full test suite passes

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/TopDownTruncationStrategy.ts packages/core/src/core/compression/index.ts
```
