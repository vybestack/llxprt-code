# Phase 07: Error Reporting TDD

## Phase ID

`PLAN-20260223-ISSUE1598.P07`

## Prerequisites

- Required: Phase 06a completed

## Requirements Implemented (Expanded)

### REQ-1598-ER01: Error Construction with Reasons

**Full Text**: When `tryFailover()` returns `false`, the system shall construct `AllBucketsExhaustedError` with `bucketFailureReasons` from `getLastFailoverReasons()`.

**Behavior**:
- GIVEN: All buckets exhausted, tryFailover() returns false
- WHEN: RetryOrchestrator constructs error
- THEN: Error includes bucketFailureReasons from getLastFailoverReasons()

**Why This Matters**: Provides detailed diagnostics in error reporting.

### REQ-1598-ER04: Human-Readable Message

**Full Text**: The `AllBucketsExhaustedError.message` property shall include the provider name and list of attempted buckets.

**Behavior**:
- GIVEN: AllBucketsExhaustedError constructed
- WHEN: Message accessed
- THEN: Message format: "All API key buckets exhausted for {provider}: {bucket1}, {bucket2}"

**Why This Matters**: Human-readable summary aids debugging.

## Implementation Tasks

### Files to Create

- `packages/core/src/providers/__tests__/errors.test.ts` (CREATE OR UPDATE)
  - ADD: Test suite for AllBucketsExhaustedError
  - Tests:
    - `should construct with 3 parameters (backward compat)`
    - `should construct with 4 parameters (with reasons)`
    - `should default bucketFailureReasons to empty record`
    - `should include provider and buckets in message`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P07`
  - MUST include: `@requirement:REQ-1598-ER01, ER03, ER04`

- `packages/cli/src/auth/BucketFailoverHandlerImpl.test.ts` (UPDATE)
  - ADD: Test for getLastFailoverReasons()
  - Test: `should return shallow copy of lastFailoverReasons`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P07`
  - MUST include: `@requirement:REQ-1598-IC02`

### Required Code Markers

```typescript
describe('AllBucketsExhaustedError @plan:PLAN-20260223-ISSUE1598.P07', () => {
  /**
   * @requirement REQ-1598-ER03
   */
  it('should construct with 3 parameters (backward compat)', () => {
    // Arrange & Act
    const error = new AllBucketsExhaustedError('anthropic', ['default'], lastError);
    
    // Assert
    expect(error.bucketFailureReasons).toEqual({});
  });
});
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P07" packages/ | wc -l
# Expected: 5+ occurrences

# Run tests (will fail until P08)
npm test -- errors.test.ts
# Expected: Tests fail naturally
```

### Checklist

- [ ] 4+ tests for AllBucketsExhaustedError
- [ ] 1+ test for getLastFailoverReasons()
- [ ] Tests fail naturally
- [ ] No NotYetImplemented checks
- [ ] Ready for Phase 08

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P07.md`

```markdown
Phase: P07
Tests Added: 5+
Fail Naturally: YES
Ready: YES
```
