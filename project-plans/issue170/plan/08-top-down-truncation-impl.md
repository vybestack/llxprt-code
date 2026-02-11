# Phase 08: Top-Down Truncation Strategy Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P08`

## Prerequisites

- Required: Phase 07 completed (tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P07" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/TopDownTruncationStrategy.test.ts` (failing tests)

## Requirements Implemented

- **REQ-CS-003.1**: Oldest-First Removal — drops messages from the front of history
- **REQ-CS-003.2**: Tool-Call Boundary Respect — uses `adjustForToolCallBoundary()` to avoid orphaning tool response/call pairs
- **REQ-CS-003.3**: Minimum Preservation — preserves `min(2, history.length)` messages; never synthesizes messages. When 2+ messages exist, preserves one human + one AI from the end. When fewer than 2 exist, returns history unchanged
- **REQ-CS-003.4**: No LLM Call — pure mechanical truncation, `requiresLLM: false`
- **REQ-CS-003.5**: Token Target — truncates until token count is under the computed target

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
     1. Calculate target token count: `compressionThreshold * contextLimit * 0.6`
        where `compressionThreshold` = `context.runtimeContext.ephemerals.compressionThreshold()` (e.g. 0.85) and `contextLimit` is the model's context window size.
        This means: if compression triggers at 85% of context limit, the target after truncation is ~51% (0.85 × 0.6), giving headroom before the next trigger. This matches the middle-out strategy's behavior of reducing by roughly 50%. The 0.6 factor is a defined starting point — not left as a vague placeholder.
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

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/compression/TopDownTruncationStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/TopDownTruncationStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/TopDownTruncationStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-003.1–003.5)
   - [ ] Read the implementation code in `TopDownTruncationStrategy.ts`
   - [ ] Can explain HOW oldest-first removal, boundary respect, and minimum preservation are fulfilled

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual truncated history output, not just that code ran
   - [ ] Tests would catch incorrect truncation point or missing minimum preservation

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths (or will be once dispatcher is wired in P14)
   - [ ] There is a path from runtime to this code (factory returns this strategy)

### Integration Points Verified

- [ ] `CompressionContext` fields used correctly by strategy (verified by reading both files)
- [ ] `CompressionResult` returned correctly (verified by checking dispatcher usage in P14)
- [ ] `estimateTokens()` called with correct arguments
- [ ] Error handling works at component boundaries (estimateTokens failure)

### Edge Cases Verified

- [ ] Empty/null input handled (empty history)
- [ ] Invalid input rejected with clear error
- [ ] Boundary values work correctly (single message, already-under-target, all tool responses)

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

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P08.md`
Contents:
```
Phase: P08
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
