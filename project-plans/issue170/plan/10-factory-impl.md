# Phase 10: Strategy Factory Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P10`

## Prerequisites

- Required: Phase 09 completed (factory tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P09" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/compressionStrategyFactory.test.ts` (failing tests)

## Requirements Implemented

- **REQ-CS-001.2**: Factory Lookup — `getCompressionStrategy(name)` returns the correct `CompressionStrategy` instance for each registered name
- **REQ-CS-001.3**: Unknown Strategy Rejection — factory throws `CompressionStrategyError` with the unknown name when given an unregistered strategy

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/compressionStrategyFactory.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P10`
  - MUST include: `@requirement REQ-CS-001.2, REQ-CS-001.3`
  - Implementation:
    - Import `COMPRESSION_STRATEGIES`, `CompressionStrategyName`, `CompressionStrategy` from `./types.js`
    - Import `MiddleOutStrategy` and `TopDownTruncationStrategy`
     - `getCompressionStrategy(name: CompressionStrategyName): CompressionStrategy` — type-safe internal API
    - `parseCompressionStrategyName(name: string): CompressionStrategyName` — runtime boundary validator for untyped inputs (CLI, settings, config). Validates against `COMPRESSION_STRATEGIES` tuple, throws `CompressionStrategyError` with the unknown name if not found
    - `getCompressionStrategy` can trust its typed input; the runtime validation happens at `parseCompressionStrategyName` boundary
    - Return appropriate strategy instance from `getCompressionStrategy`
  - The factory function uses the `COMPRESSION_STRATEGIES` tuple for validation, not a separate hardcoded list
  - Import and use `CompressionStrategyError` from `./types.js` for error handling (defined in P02)

### Files to Modify

- `packages/core/src/core/compression/index.ts` — export `getCompressionStrategy`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-COMPRESSION.P10
 * @requirement REQ-CS-001.2, REQ-CS-001.3
 */
export function parseCompressionStrategyName(name: string): CompressionStrategyName {
  // validate against COMPRESSION_STRATEGIES, throw CompressionStrategyError if unknown
}

export function getCompressionStrategy(name: CompressionStrategyName): CompressionStrategy {
  // type-safe lookup, no redundant validation needed
}
```

## Verification Commands

```bash
# All Phase 09 tests pass
npx vitest run packages/core/src/core/compression/compressionStrategyFactory.test.ts
# Expected: all pass

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P10" packages/core/src/core/compression/ | wc -l

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/compression/compressionStrategyFactory.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/compressionStrategyFactory.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/compressionStrategyFactory.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-001.2, REQ-CS-001.3)
   - [ ] Read the implementation code in `compressionStrategyFactory.ts`
   - [ ] Can explain HOW the factory maps names to strategies and rejects unknowns

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual strategy instances (name, requiresLLM), not just that something was returned
   - [ ] Tests would catch a factory that returns wrong strategy or doesn't throw on unknown

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths (or will be once dispatcher is wired in P14)
   - [ ] There is a path from runtime to this code (dispatcher calls `getCompressionStrategy()`)

### Integration Points Verified

- [ ] Caller passes correct data type to callee (verified by reading both files)
- [ ] Return value used correctly by caller (verified by checking dispatcher usage in P14)
- [ ] Error handling works at component boundaries (unknown strategy → actionable error)

### Edge Cases Verified

- [ ] Empty/null input handled
- [ ] Invalid input rejected with clear error (unknown strategy name in error message)
- [ ] Boundary values work correctly (all valid strategy names)

## Success Criteria

- All Phase 09 tests pass
- Factory validates against `COMPRESSION_STRATEGIES` tuple
- Unknown strategy name produces actionable error
- Full test suite passes

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/compressionStrategyFactory.ts packages/core/src/core/compression/index.ts
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P10.md`
Contents:
```
Phase: P10
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
