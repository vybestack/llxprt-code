# Phase 09: Strategy Factory TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P09`

## Prerequisites

- Required: Phase 08 completed (both strategies pass)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P08" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/TopDownTruncationStrategy.ts` (passing tests)

## Requirements Implemented (Expanded)

### REQ-CS-001.2: Strategy Factory

**Full Text**: The system shall provide a strategy factory that maps strategy names to `CompressionStrategy` instances.
**Behavior**:
- GIVEN: A valid strategy name like `'middle-out'`
- WHEN: The factory is asked for that strategy
- THEN: It returns a `CompressionStrategy` instance with `name === 'middle-out'`
**Why This Matters**: The dispatcher needs a single entry point to get strategies by name.

### REQ-CS-001.3: Unknown Strategy

**Full Text**: If a strategy name is requested that does not exist in the factory, then the system shall throw an error identifying the unknown strategy name.
**Behavior**:
- GIVEN: An invalid strategy name like `'nonexistent'`
- WHEN: The factory is asked for that strategy
- THEN: It throws an error whose message includes `'nonexistent'`
**Why This Matters**: Fail fast — typos or misconfiguration should be caught immediately, not result in undefined behavior.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/compressionStrategyFactory.test.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P09`
  - MUST include: `@requirement REQ-CS-001.2, REQ-CS-001.3`
  - Tests:
    - Returns `MiddleOutStrategy` instance for `'middle-out'`
    - Returns `TopDownTruncationStrategy` instance for `'top-down-truncation'`
    - Returned instances have correct `name` and `requiresLLM` values
    - `parseCompressionStrategyName('middle-out')` returns `'middle-out'` (typed)
    - `parseCompressionStrategyName('top-down-truncation')` returns `'top-down-truncation'` (typed)
    - `parseCompressionStrategyName('nonexistent')` throws `CompressionStrategyError`
    - Error message includes the unknown name (actionable)
    - Supports all names from `COMPRESSION_STRATEGIES` tuple (loop test)
    - **Interface contract test**: Loop over all `COMPRESSION_STRATEGIES`, get each from factory, verify `name` matches the requested name, `requiresLLM` is a boolean, and `compress` is a function — this ensures all strategies satisfy the `CompressionStrategy` contract
    - Factory returns fresh instances (not shared singletons, unless intentional)

### Required Code Markers

```typescript
describe('compressionStrategyFactory @plan PLAN-20260211-COMPRESSION.P09', () => {
  it('returns MiddleOutStrategy for middle-out @requirement REQ-CS-001.2', () => {
    // ...
  });
  it('throws for unknown strategy name @requirement REQ-CS-001.3', () => {
    // ...
  });
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P09" packages/core/src/core/compression/ | wc -l
# Expected: 5+ occurrences

# Tests fail (factory not implemented)
npx vitest run packages/core/src/core/compression/compressionStrategyFactory.test.ts 2>&1 | head -20
```

## Success Criteria

- 5+ behavioral tests
- Tests verify actual strategy instances (name, requiresLLM), not just that something was returned
- Tests fail with import errors, not syntax errors

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/compressionStrategyFactory.test.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P09.md`
Contents:
```
Phase: P09
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
