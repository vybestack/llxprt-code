# Phase 16: Integration TDD

## Phase ID

`PLAN-20260223-ISSUE1598.P16`

## Prerequisites

- Phase 15a completed

## Requirements Implemented (Expanded)

### REQ-1598-IC11: RetryOrchestrator Passes Context

**Full Text**: When `RetryOrchestrator` calls `tryFailover()`, the system shall pass a `FailoverContext` object containing the triggering status.

**Behavior**:
- GIVEN: API error detected with status code
- WHEN: tryFailover() called from retry loop
- THEN: FailoverContext with triggeringStatus passed

**Why This Matters**: Enables accurate classification based on actual error status.

### REQ-1598-SM03: ResetSession at Request Boundary

**Full Text**: When a new API request begins in `RetryOrchestrator`, the system shall call `bucketFailoverHandler.resetSession()` at the request boundary.

**Behavior**:
- GIVEN: New API request starting
- WHEN: Retry loop initializes
- THEN: resetSession() called before first attempt

**Why This Matters**: Ensures each request starts with fresh failover state.

### REQ-1598-IC03: Optional Chaining for getLastFailoverReasons

**Full Text**: When `RetryOrchestrator` calls `getLastFailoverReasons()`, the system shall use optional chaining (`?.()`) to handle implementations that don't provide the method.

**Behavior**:
- GIVEN: BucketFailoverHandler without getLastFailoverReasons()
- WHEN: Method called with optional chaining
- THEN: No crash, returns undefined

**Why This Matters**: Backward compatibility with older implementations.

## Implementation Tasks

### Files to Create/Update

- `packages/core/src/providers/__tests__/RetryOrchestrator.test.ts` (UPDATE)
  - ADD test suite: "Bucket failover integration"
  - Tests:
    - `should call resetSession at request start`
    - `should pass FailoverContext with triggering status to tryFailover`
    - `should call getLastFailoverReasons after tryFailover returns false`
    - `should construct AllBucketsExhaustedError with reasons`
    - `should handle missing getLastFailoverReasons gracefully`
    - `should rotate through all buckets on sequential 429 errors`
    - `should attempt foreground reauth when all buckets expired`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P16`
  - MUST include: `@requirement:REQ-1598-IC11, SM03, IC03, IC04`
  - MUST include: `@pseudocode error-reporting.md (usage section)`

### Required Code Markers

```typescript
describe('Bucket failover integration @plan:PLAN-20260223-ISSUE1598.P16', () => {
  /**
   * @requirement REQ-1598-SM03
   */
  it('should call resetSession at request start', async () => {
    // Arrange: Mock failover handler with resetSession spy
    // Act: Make API request via RetryOrchestrator
    // Assert: resetSession called before first attempt
  });
  
  /**
   * @requirement REQ-1598-IC11
   * @pseudocode error-reporting.md usage lines 7-8
   */
  it('should pass FailoverContext with triggering status', async () => {
    // Arrange: Mock failover handler, API returns 429
    // Act: Retry logic triggers failover
    // Assert: tryFailover called with context.triggeringStatus = 429
  });
});
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P16" packages/core/src/providers/__tests__/ | wc -l
# Expected: 7+ occurrences

# Run tests (will fail until P17)
npm test -- RetryOrchestrator.test.ts --grep "Bucket failover integration"
# Expected: Tests fail naturally
```

### Checklist

- [ ] 7+ integration tests created
- [ ] Tests cover end-to-end scenarios
- [ ] Tests fail naturally
- [ ] No NotYetImplemented checks
- [ ] Ready for Phase 17

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P16.md`

```markdown
Phase: P16
Tests Added: 7+
Fail Naturally: YES
Ready: YES
```
