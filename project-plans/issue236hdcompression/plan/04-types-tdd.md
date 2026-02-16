# Phase 04: Types & Strategy Interface — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P04`

## Prerequisites

- Required: Phase 03 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P03" packages/core/src/core/compression/ | wc -l` → ≥ 4
- Expected files from previous phase:
  - `packages/core/src/core/compression/types.ts` (modified with new types)
  - `packages/core/src/core/compression/MiddleOutStrategy.ts` (modified with trigger)
  - `packages/core/src/core/compression/TopDownTruncationStrategy.ts` (modified with trigger)
  - `packages/core/src/core/compression/OneShotStrategy.ts` (modified with trigger)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-001.1: Trigger Declaration

**Full Text**: Every `CompressionStrategy` shall declare a `trigger` property of type `StrategyTrigger`.
**Behavior**:
- GIVEN: Any strategy implementing CompressionStrategy
- WHEN: The strategy is instantiated
- THEN: `strategy.trigger` is a valid StrategyTrigger with `mode` and `defaultThreshold`

### REQ-HD-001.3: Existing Strategy Trigger

**Full Text**: The MiddleOutStrategy, TopDownTruncationStrategy, and OneShotStrategy shall each declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`.
**Behavior**:
- GIVEN: An instance of MiddleOutStrategy / TopDownTruncationStrategy / OneShotStrategy
- WHEN: `strategy.trigger` is accessed
- THEN: It equals `{ mode: 'threshold', defaultThreshold: 0.85 }`

### REQ-HD-001.4: Existing Strategy Compatibility

**Full Text**: The MiddleOutStrategy, TopDownTruncationStrategy, and OneShotStrategy shall not implement `optimize`. Their `compress` behavior shall remain unchanged.
**Behavior**:
- GIVEN: An instance of any existing strategy
- WHEN: `strategy.optimize` is checked
- THEN: It is `undefined`

### REQ-HD-001.10: Threshold Precedence

**Full Text**: Where an ephemeral or profile `compression-threshold` setting is set, the system shall use that value. Where no setting is set, the system shall use the strategy's `trigger.defaultThreshold`.
**Behavior**:
- GIVEN: A strategy with `trigger.defaultThreshold` of 0.85
- WHEN: No ephemeral/profile override exists
- THEN: The threshold resolves to 0.85

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.
**Behavior**:
- GIVEN: The COMPRESSION_STRATEGIES constant
- WHEN: It is checked for `'high-density'`
- THEN: `'high-density'` is included

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/__tests__/types-highdensity.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P04`
  - MUST include: `@requirement:REQ-HD-001.1, REQ-HD-001.3, REQ-HD-001.4, REQ-HD-001.10, REQ-HD-004.1`

### Test Cases (Behavioral — NOT mock theater)

All tests expect REAL behavior. No mocking strategy instances. Tests import real classes and types.

#### Type Existence & Shape Tests
1. `COMPRESSION_STRATEGIES includes 'high-density'` — verifies the tuple literal
2. `CompressionStrategyName type accepts 'high-density'` — type-level check via assignment
3. `DensityResult can be constructed with valid data` — constructs a value matching the interface, verifies fields
4. `DensityConfig can be constructed with all required fields` — constructs a value, verifies readonly fields

#### Existing Strategy Trigger Tests
5. `MiddleOutStrategy has trigger { mode: 'threshold', defaultThreshold: 0.85 }` — instantiate, check trigger
6. `TopDownTruncationStrategy has trigger { mode: 'threshold', defaultThreshold: 0.85 }` — same
7. `OneShotStrategy has trigger { mode: 'threshold', defaultThreshold: 0.85 }` — same
8. `MiddleOutStrategy does NOT implement optimize` — `strategy.optimize` is `undefined`
9. `TopDownTruncationStrategy does NOT implement optimize` — same
10. `OneShotStrategy does NOT implement optimize` — same

#### Compress Compatibility Tests
11. `MiddleOutStrategy.compress still returns CompressionResult` — call with minimal context, verify return shape (this uses the real strategy but may need a mock provider for LLM — acceptable for integration boundary)
12. `TopDownTruncationStrategy.compress with empty history returns unchanged` — call with empty history, verify no crash
13. `OneShotStrategy.compress still exists and is callable` — verify method is a function

#### Property-Based Tests (≥ 30% of total)
14. `StrategyTrigger defaultThreshold is always a positive number` — property test over constructed triggers
15. `DensityResult removals and replacements accept any non-negative integers` — property test
16. `DensityResultMetadata counts are always non-negative` — property test

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P04
 * @requirement REQ-HD-001.1
 * @pseudocode strategy-interface.md lines 11-13
 */
it('MiddleOutStrategy has trigger { mode: threshold, defaultThreshold: 0.85 }', () => { ... });
```

## Verification Commands

```bash
# Tests exist
test -f packages/core/src/core/compression/__tests__/types-highdensity.test.ts && echo "PASS" || echo "FAIL"

# Plan markers present
grep -c "@plan.*HIGHDENSITY.P04" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: ≥ 1

# Requirement markers present
grep -c "@requirement" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: ≥ 3

# Count test cases
grep -c "it(" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: ≥ 12

# No mock theater
grep -c "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: 0

# No reverse testing
grep -c "toThrow.*NotYetImplemented\|expect.*not.toThrow" packages/core/src/core/compression/__tests__/types-highdensity.test.ts
# Expected: 0

# Tests run (most should pass since types/stubs are already implemented)
npm run test -- --run packages/core/src/core/compression/__tests__/types-highdensity.test.ts 2>&1 | tail -10
```

## Success Criteria

- Test file created with ≥ 12 behavioral test cases
- ≥ 30% of tests are property-based
- No mock theater (toHaveBeenCalled)
- No reverse testing (NotYetImplemented expectations)
- All tests that check existing strategy behavior PASS (stubs are already real)
- Plan and requirement markers present
- No modifications to production code (tests only)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/types-highdensity.test.ts`
2. Re-run Phase 04 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P04.md`
Contents:
```markdown
Phase: P04
Completed: [timestamp]
Files Created: packages/core/src/core/compression/__tests__/types-highdensity.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count]
Tests Failing: [count] (expected to fail: [list which and why])
Verification: [paste verification output]
```
