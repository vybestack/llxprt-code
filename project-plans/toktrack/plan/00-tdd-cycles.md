# TDD Cycles for Token Tracking Enhancement

## Plan ID: PLAN-20250909-TOKTRACK

This document defines the explicit stub/TDD/implementation cycles for the token tracking feature.

## Cycle 1: Core Types and Interfaces

### P05.1: Stub Phase - ProviderPerformanceMetrics Enhancement
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P05.1
 * @requirement REQ-001, REQ-002, REQ-003
 * @pseudocode lines 10-29 from component-001.md
 */
```
- Add new fields to ProviderPerformanceMetrics interface
- Fields initialized with empty/zero values
- Must compile with strict TypeScript

### P05.2: TDD Phase - ProviderPerformanceMetrics Tests
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P05.2
 * @requirement REQ-001, REQ-002, REQ-003
 */
```
- Test that new fields exist and have correct types
- Test default initialization values
- Test serialization/deserialization
- Property-based tests for field ranges

### P05.3: Implementation Phase - ProviderPerformanceMetrics
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P05.3
 * @pseudocode lines 10-29 from component-001.md
 */
```
- Implement according to pseudocode line-by-line
- All tests must pass
- No test modifications allowed

## Cycle 2: ProviderPerformanceTracker Enhancement

### P06.1: Stub Phase - ProviderPerformanceTracker
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P06.1
 * @requirement REQ-001, REQ-002
 * @pseudocode lines 10-78 from component-002.md
 */
```
- Add tokenTimestamps array (line 12)
- Add calculateTokensPerMinute method returning 0 (lines 44-50)
- Add addThrottleWaitTime method as no-op (lines 75-77)
- Methods can throw new Error('NotYetImplemented') OR return empty values

### P06.2: TDD Phase - ProviderPerformanceTracker Tests
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P06.2
 * @requirement REQ-001, REQ-002
 */
```
Behavioral tests:
- Test TPM calculation with various token sequences
- Test throttle wait time accumulation
- Test metrics reset functionality

Property-based tests (30% minimum):
```typescript
test.prop([fc.array(fc.record({
  timestamp: fc.integer({min: Date.now() - 120000, max: Date.now()}),
  tokenCount: fc.integer({min: 0, max: 10000})
}))])('TPM calculation handles any valid token sequence', (tokenData) => {
  // Test properties of TPM calculation
  const tpm = tracker.calculateTokensPerMinute(tokenData);
  expect(tpm).toBeGreaterThanOrEqual(0);
  // More assertions...
});
```

### P06.3: Implementation Phase - ProviderPerformanceTracker
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P06.3
 * @pseudocode lines 10-78 from component-002.md
 */
```
Following pseudocode exactly:
- Line 12: Initialize tokenTimestamps as empty array
- Lines 44-50: Implement calculateTokensPerMinute
  - Line 45: GET current timestamp
  - Line 46: FILTER tokenTimestamps for last 60 seconds
  - Line 47: UPDATE tokenTimestamps with filtered array
  - Line 48: SUM tokenCount from all entries
  - Line 49: RETURN sum as TPM
- Lines 75-77: Implement addThrottleWaitTime
  - Line 76: INCREMENT throttleWaitTimeMs by waitTimeMs

## Cycle 3: ProviderManager Session Token Accumulation

### P07.1: Stub Phase - ProviderManager
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P07.1
 * @requirement REQ-003
 * @pseudocode lines 10-37 from component-003.md
 */
```
- Add sessionTokenUsage object (lines 12-18)
- Add accumulateSessionTokens method as stub (lines 21-28)
- Add resetSessionTokenUsage method as stub (lines 30-32)
- Add getSessionTokenUsage method returning empty object (lines 34-36)

### P07.2: TDD Phase - ProviderManager Tests
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P07.2
 * @requirement REQ-003
 */
```
Behavioral tests:
- Test token accumulation from multiple providers
- Test reset functionality
- Test get functionality returns correct totals

Property-based tests:
```typescript
test.prop([fc.array(fc.record({
  input: fc.nat(10000),
  output: fc.nat(10000),
  cache: fc.nat(10000),
  tool: fc.nat(10000),
  thought: fc.nat(10000)
}))])('Session token accumulation is always positive', (tokenUsages) => {
  tokenUsages.forEach(usage => manager.accumulateSessionTokens('test', usage));
  const total = manager.getSessionTokenUsage();
  expect(total.total).toBeGreaterThanOrEqual(0);
  expect(total.input).toBeGreaterThanOrEqual(0);
  // More assertions...
});
```

### P07.3: Implementation Phase - ProviderManager
```typescript
/**
 * @plan PLAN-20250909-TOKTRACK.P07.3
 * @pseudocode lines 10-37 from component-003.md
 */
```
Following pseudocode exactly:
- Lines 12-18: Initialize sessionTokenUsage object
- Lines 21-28: Implement accumulateSessionTokens
  - Line 22: INCREMENT input by usage.input
  - Line 23: INCREMENT output by usage.output
  - Line 24: INCREMENT cache by usage.cache
  - Line 25: INCREMENT tool by usage.tool
  - Line 26: INCREMENT thought by usage.thought
  - Line 27: INCREMENT total by sum
- Lines 30-32: Implement resetSessionTokenUsage
- Lines 34-36: Implement getSessionTokenUsage

## Cycle 4: Integration with Existing System

### P10.1: Integration Stub Phase
- Wire token tracking into existing providers
- Connect to telemetry system
- Add UI component placeholders

### P10.2: Integration TDD Phase
- End-to-end tests for token tracking flow
- Tests for UI display of metrics
- Tests for diagnostics command output
- 77% property-based test coverage maintained

### P10.3: Integration Implementation Phase
- Connect all components following integration plan
- Reference pseudocode for each integration point
- Ensure metrics flow from API → tracking → telemetry → UI

## Verification Requirements

After each implementation phase:

### Mutation Testing
```bash
npx stryker run --mutate src/providers/
MUTATION_SCORE=$(jq -r '.metrics.mutationScore' .stryker-tmp/reports/mutation-report.json)
[ $MUTATION_SCORE -lt 80 ] && echo "FAIL: Score $MUTATION_SCORE% < 80%"
```

### Property-Based Test Coverage
```bash
TOTAL=$(grep -c "test(" test/*.spec.ts)
PROPERTY=$(grep -c "test.prop(" test/*.spec.ts)
PERCENTAGE=$((PROPERTY * 100 / TOTAL))
[ $PERCENTAGE -lt 30 ] && echo "FAIL: Only $PERCENTAGE% property tests"
```

### Behavioral Test Verification
```bash
# No reverse testing
grep -r "toThrow('NotYetImplemented')" test/ && echo "FAIL: Reverse testing found"

# No mock theater
grep -r "toHaveBeenCalled" test/ && echo "FAIL: Mock verification found"

# Real behavioral assertions
grep -E "toBe\(|toEqual\(|toMatch\(" test/*.spec.ts || echo "FAIL: No behavioral assertions"
```

## Success Criteria

Each cycle must complete with:
- ✅ All tests passing
- ✅ 80% mutation score minimum
- ✅ 30% property-based tests minimum (77% achieved overall)
- ✅ No test modifications between phases
- ✅ Pseudocode followed line-by-line
- ✅ All phase markers present in code