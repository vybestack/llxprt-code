# Phase 17: Integration Implementation

## Phase ID

`PLAN-20260223-ISSUE1598.P17`

## Prerequisites

- Phase 16a completed
- Integration tests exist and fail

## Requirements Implemented (Expanded)

### REQ-1598-IC03: Reset Session at Request Start

**Full Requirement Text**: When `RetryOrchestrator` begins processing a new request, the system shall call `failoverHandler.resetSession()` before the first retry attempt.

**Rationale**: Allows all buckets to be retried in a new request. Reset happens at request boundaries, not only on success.

**Traceability**: overview.md "Session State" section

**Behavior**:
- GIVEN: New API request arrives
- WHEN: RetryOrchestrator begins retry loop
- THEN: failoverHandler.resetSession() is called before first attempt

**Why This Matters**: Clears triedBucketsThisSession from previous requests, ensuring each request starts with a fresh failover state. Prevents buckets from being permanently marked as unavailable across requests.

### REQ-1598-IC04: Pass Triggering Status to Failover

**Full Requirement Text**: When `RetryOrchestrator` invokes `tryFailover()`, the system shall pass a `FailoverContext` object containing `triggeringStatus` from the failed response.

**Rationale**: Ensures classification logic has access to status code information. This is a NEW requirement for RetryOrchestrator.

**Traceability**: technical.md "Modified: RetryOrchestrator" section

**Behavior**:
- GIVEN: API request failed with status code (e.g., 429)
- WHEN: RetryOrchestrator calls tryFailover()
- THEN: FailoverContext with triggeringStatus is passed as parameter

**Why This Matters**: Enables classification logic in Pass 1 to distinguish between 429 (quota-exhausted) and other failures. Critical for correct bucket classification.

### REQ-1598-IC11: Collect Reasons After Exhaustion

**Full Requirement Text**: When `tryFailover()` returns `false`, the system shall call `getLastFailoverReasons()` and pass the result to `AllBucketsExhaustedError` constructor.

**Rationale**: Propagates detailed classification results to error object, enabling rich diagnostics in error messages and logs.

**Traceability**: technical.md "Modified: RetryOrchestrator" section

**Behavior**:
- GIVEN: tryFailover() returns false (all buckets exhausted)
- WHEN: RetryOrchestrator constructs error
- THEN: getLastFailoverReasons() is called and result passed to AllBucketsExhaustedError constructor

**Why This Matters**: Propagates detailed classification results to error object, enabling rich diagnostics in error messages and logs.

### REQ-1598-SM03: Clear Session State on Request Start

**Full Requirement Text**: When a new API request begins in `RetryOrchestrator`, the system shall call `bucketFailoverHandler.resetSession()` at the request boundary.

**Rationale**: Ensures each request starts with a fresh failover state.

**Traceability**: technical.md "Modified: RetryOrchestrator" section

**Behavior**:
- GIVEN: triedBucketsThisSession contains buckets from previous request
- WHEN: resetSession() is called
- THEN: triedBucketsThisSession is cleared to empty set

**Why This Matters**: Ensures each request has independent failover state. Without this, buckets marked unavailable in one request would remain unavailable for all subsequent requests.

### REQ-1598-ER01: Construct Error with Reasons

**Full Requirement Text**: When `tryFailover()` returns `false`, the system shall construct `AllBucketsExhaustedError` with `bucketFailureReasons` from `getLastFailoverReasons()`.

**Rationale**: Provides detailed diagnostics to aid debugging when all buckets fail.

**Traceability**: technical.md "Modified: RetryOrchestrator" section

**Behavior**:
- GIVEN: tryFailover() has attempted all buckets and returns false
- WHEN: RetryOrchestrator handles the exhaustion case
- THEN: AllBucketsExhaustedError is constructed with bucketFailureReasons from getLastFailoverReasons()

**Why This Matters**: Provides detailed diagnostics to aid debugging when all buckets fail. Users and operators can see exactly why each bucket was unavailable, enabling faster resolution of credential and quota issues.

## Implementation Tasks

### Files to Create

(None — this phase modifies existing files only)

### Files to Modify

- `packages/core/src/providers/RetryOrchestrator.ts`
  - ADD: resetSession() call at request start
  - UPDATE: tryFailover() call to pass FailoverContext
  - ADD: getLastFailoverReasons() call after tryFailover returns false
  - UPDATE: AllBucketsExhaustedError construction with reasons
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P17`
  - MUST include: `@requirement:REQ-1598-IC03, IC04, IC11, SM03, ER01`
  - MUST include: `@pseudocode error-reporting.md usage section`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P17
 * @requirement REQ-1598-SM03
 */
// At request boundary
const failoverHandler = config.getBucketFailoverHandler?.();
if (failoverHandler) {
  failoverHandler.resetSession();
}

/**
 * @plan PLAN-20260223-ISSUE1598.P17
 * @requirement REQ-1598-IC11, ER01
 * @pseudocode error-reporting.md usage lines 5-21
 */
const context: FailoverContext = { triggeringStatus: lastStatus };
const failoverSuccess = await failoverHandler.tryFailover(context);

if (!failoverSuccess) {
  const bucketFailureReasons = failoverHandler.getLastFailoverReasons?.() ?? {};
  const attemptedBuckets = failoverHandler.getBuckets?.() ?? [];
  
  throw new AllBucketsExhaustedError(
    providerName,
    attemptedBuckets,
    lastError,
    bucketFailureReasons
  );
}
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P17" packages/core/src/providers/ | wc -l
# Expected: 4+

# Run integration tests - should pass now
npm test -- RetryOrchestrator.test.ts --grep "Bucket failover integration"
# Expected: 7/7 tests pass

# Run full suite
npm test
# Expected: All pass
```

### Deferred Implementation Detection

```bash
# No TODOs in RetryOrchestrator failover code
grep -n "TODO\|FIXME" packages/core/src/providers/RetryOrchestrator.ts | grep -i "failover\|bucket"
# Expected: No matches
```

### Semantic Verification Checklist

1. **RetryOrchestrator integration correct**:
   - [ ] Read RetryOrchestrator retry loop
   - [ ] Verified resetSession() called at request start
   - [ ] Verified FailoverContext passed with triggeringStatus
   - [ ] Verified getLastFailoverReasons() called with optional chaining
   - [ ] Verified AllBucketsExhaustedError constructed with 4 params

2. **End-to-end scenarios work**:
   - [ ] Tested: 429 on bucket A → switch to bucket B → request succeeds
   - [ ] Tested: All buckets quota-exhausted → error with reasons
   - [ ] Tested: Expired bucket → reauth → request succeeds
   - [ ] Tested: Handler without getLastFailoverReasons → no crash

3. **Tests pass**:
   - [ ] All 7 integration tests pass
   - [ ] Full suite passes

## Success Criteria

- RetryOrchestrator calls resetSession() at request start
- FailoverContext passed with triggeringStatus
- getLastFailoverReasons() called with optional chaining
- AllBucketsExhaustedError constructed with reasons
- All 7 integration tests pass
- Full test suite passes

## Failure Recovery

If tests fail:

1. Review pseudocode error-reporting.md usage section
2. Compare implementation with usage pseudocode
3. Fix discrepancies
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P17.md`

```markdown
Phase: P17
Completed: [timestamp]
Tests: 7/7 pass
Integration: Complete
Full Suite: PASS
Ready for P18: YES
```
