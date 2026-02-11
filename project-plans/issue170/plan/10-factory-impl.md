# Phase 10: Strategy Factory Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P10`

## Prerequisites

- Required: Phase 09 completed (factory tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P09" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/compressionStrategyFactory.test.ts` (failing tests)

## Requirements Implemented (Expanded)

REQ-CS-001.2, REQ-CS-001.3 (making Phase 09 tests GREEN).

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/compressionStrategyFactory.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P10`
  - MUST include: `@requirement REQ-CS-001.2, REQ-CS-001.3`
  - Implementation:
    - Import `COMPRESSION_STRATEGIES`, `CompressionStrategyName`, `CompressionStrategy` from `./types.js`
    - Import `MiddleOutStrategy` and `TopDownTruncationStrategy`
    - `getCompressionStrategy(name: CompressionStrategyName): CompressionStrategy`
    - Validate name against `COMPRESSION_STRATEGIES` — if not found, throw with the name in the error message
    - Return appropriate strategy instance
  - The factory function uses the `COMPRESSION_STRATEGIES` tuple for validation, not a separate hardcoded list

### Files to Modify

- `packages/core/src/core/compression/index.ts` — export `getCompressionStrategy`

## Verification Commands

```bash
# All Phase 09 tests pass
npx vitest run packages/core/src/core/compression/compressionStrategyFactory.test.ts
# Expected: all pass

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P10" packages/core/src/core/compression/ | wc -l

# No deferred implementation
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Success Criteria

- All Phase 09 tests pass
- Factory validates against `COMPRESSION_STRATEGIES` tuple
- Unknown strategy name produces actionable error
- Full test suite passes

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/compressionStrategyFactory.ts packages/core/src/core/compression/index.ts
```
