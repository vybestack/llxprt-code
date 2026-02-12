# Phase 13: Dispatcher Integration TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P13`

## Prerequisites

- Required: Phase 12 completed (settings pass)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P12" packages/core/src/`
- Expected files from previous phase:
  - Settings registry entries, type updates, runtime accessors all passing

## Requirements Implemented (Expanded)

### REQ-CS-006.1: Strategy Delegation

**Full Text**: When compression is triggered, `performCompression()` shall read the `compression.strategy` setting, obtain the corresponding strategy from the factory, and delegate to `strategy.compress()`.
**Behavior**:
- GIVEN: `compression.strategy` is set to `'top-down-truncation'`
- WHEN: `performCompression()` is called
- THEN: It reads the setting, gets `TopDownTruncationStrategy` from factory, and calls `compress()` on it
**Why This Matters**: This is THE integration point — the dispatcher is what makes strategies actually work.

### REQ-CS-006.2: Result Application

**Full Text**: After a strategy returns a `CompressionResult`, `performCompression()` shall clear the history service and add each entry from `newHistory`.
**Behavior**:
- GIVEN: Strategy returns `newHistory` with 8 messages
- WHEN: Dispatcher applies the result
- THEN: History service is cleared and the 8 messages are added in order
**Why This Matters**: Strategies return data; the dispatcher owns the mutation. This is the boundary.

### REQ-CS-006.3: Fail Fast

**Full Text**: If the strategy throws, `performCompression()` shall propagate the error.
**Behavior**:
- GIVEN: Strategy's `compress()` throws an error
- WHEN: `performCompression()` catches it
- THEN: It re-throws (after unlocking history via `endCompression()`)

### REQ-CS-006.4: Atomicity

**Full Text**: The clear-and-rebuild shall execute within the existing compression lock.
**Behavior**:
- GIVEN: `startCompression()` is called before strategy execution
- WHEN: Strategy returns and history is rebuilt
- THEN: `endCompression()` is called only AFTER the rebuild is complete

### REQ-CS-006A.3: Prompt Resolution Failure

**Full Text**: If prompt resolution fails, the strategy throws and the dispatcher propagates.
**Behavior**:
- GIVEN: `PromptResolver` cannot find the compression prompt file
- WHEN: Middle-out strategy tries to load it
- THEN: Error propagates through `performCompression()`

### REQ-CS-006A.4: Token Estimation Failure

**Full Text**: If token estimation throws, the strategy propagates.
**Behavior**:
- GIVEN: `estimateTokens()` throws
- WHEN: Top-down truncation tries to estimate
- THEN: Error propagates through `performCompression()`

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/client.test.ts` (MODIFY — add compression dispatcher tests)
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P13`
  - MUST include: `@requirement REQ-CS-006.1, REQ-CS-006.2, REQ-CS-006.3, REQ-CS-006.4`
  - Tests focus on the DISPATCHER behavior, not on strategy internals (strategies already tested):
    - `performCompression()` reads `compressionStrategy()` setting to pick strategy
    - `performCompression()` calls `strategy.compress()` with correct context
    - After `compress()` returns, history service is cleared and rebuilt from `newHistory`
    - If `compress()` throws, error propagates and `endCompression()` is still called
    - History rebuild happens inside compression lock (between `startCompression` / `endCompression`)
    - Context passed to strategy does NOT include `historyService` (REQ-CS-001.6)
    - Context includes `estimateTokens` function, `currentTokenCount`, `promptResolver`, `resolveProvider`
   - NOTE: These tests may need to work with the existing `client.test.ts` test infrastructure. Read the file to understand the mocking patterns already in use.

### Required Code Markers

```typescript
// In client.test.ts, new describe block:
/**
 * @plan PLAN-20260211-COMPRESSION.P13
 * @requirement REQ-CS-006.1, REQ-CS-006.2, REQ-CS-006.3, REQ-CS-006.4
 */
describe('performCompression dispatcher', () => {
  // ...
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P13" packages/core/src/ | wc -l
# Expected: 6+ occurrences

# Tests fail (dispatcher not rewritten yet)
npx vitest run packages/core/src/core/client.test.ts 2>&1 | tail -30
```

## Success Criteria

- 6+ behavioral tests covering dispatcher delegation, result application, error propagation, atomicity
- Tests verify the integration CONTRACT between dispatcher and strategy, not strategy internals
- Tests fail because `performCompression` still uses old inline logic

## Failure Recovery

```bash
git checkout -- packages/core/src/core/client.test.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P13.md`
Contents:
```
Phase: P13
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
