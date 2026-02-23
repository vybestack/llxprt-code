# Phase 05: Classification Implementation

## Phase ID

`PLAN-20260223-ISSUE1598.P05`

## Prerequisites

- Required: Phase 04a completed
- Verification: Classification tests exist and fail naturally
- Expected: BucketFailoverHandlerImpl.test.ts has 5+ failing tests

## Requirements Implemented (Expanded)

This phase implements Pass 1 of tryFailover() — classification logic that makes the tests pass.

### REQ-1598-CL01: 429 Status Classification

**Full Requirement Text**: When `tryFailover(context?)` is called and `context.triggeringStatus === 429`, the system shall classify the triggering bucket as `quota-exhausted`.

**Rationale**: 429 responses indicate rate limit exhaustion, which cannot be resolved by refresh.

**Traceability**: overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Behavior**:
- GIVEN: A request failed with 429 status (rate limit)
- WHEN: tryFailover() is called with context.triggeringStatus === 429
- THEN: The triggering bucket is classified as `quota-exhausted`

**Why This Matters**: 429 responses indicate rate limit exhaustion, which cannot be resolved by refresh. This classification prevents futile refresh attempts and guides failover to alternative buckets.

### REQ-1598-CL02: Expired Token with Failed Refresh Classification

**Full Requirement Text**: When `tryFailover(context?)` is called and the triggering bucket's token is expired and refresh fails, the system shall classify the bucket as `expired-refresh-failed` and log the refresh error.

**Rationale**: Distinguishes between tokens that cannot be refreshed vs. quota exhaustion; logging provides diagnostics for refresh failures.

**Traceability**: overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Behavior**:
- GIVEN: A bucket has an expired token (expiry <= now)
- WHEN: tryFailover() attempts to refresh the token and refresh fails
- THEN: The bucket is classified as `expired-refresh-failed` and the error is logged

**Why This Matters**: Distinguishes between tokens that cannot be refreshed vs. quota exhaustion. Logging provides diagnostics for refresh failures, helping operators identify credential issues.

### REQ-1598-CL03: Missing Token Classification

**Full Requirement Text**: When `tryFailover(context?)` is called and `getOAuthToken` returns `null` for the triggering bucket, the system shall classify the bucket as `no-token`.

**Rationale**: Missing tokens require foreground reauth, not just refresh.

**Traceability**: overview.md "Bucket Failure Reasons" section, technical.md "Pass 1" section

**Behavior**:
- GIVEN: A bucket exists in the profile
- WHEN: tryFailover() calls getOAuthToken() and receives null
- THEN: The bucket is classified as `no-token`

**Why This Matters**: Missing tokens require foreground reauth, not just refresh. This classification enables Pass 3 to attempt user-interactive authentication.

### REQ-1598-CL04: Token Store Read Error Classification

**Full Requirement Text**: When `tryFailover(context?)` is called and `getOAuthToken` throws an exception for the triggering bucket, the system shall log the exception and classify the bucket as `no-token`.

**Rationale**: Pragmatic recovery strategy treats read errors as recoverable via reauth while preserving diagnostic information.

**Traceability**: overview.md "Bucket Failure Reasons" section (note about token-store read errors), technical.md "Error Handling" section

**Behavior**:
- GIVEN: Token store read operation throws an exception
- WHEN: tryFailover() calls getOAuthToken() and receives an exception
- THEN: The exception is logged and the bucket is classified as `no-token`

**Why This Matters**: Pragmatic recovery strategy treats read errors as recoverable via reauth while preserving diagnostic information. Prevents complete failover failure due to transient storage issues.

### REQ-1598-CL07: Successful Refresh Returns Immediately

**Full Requirement Text**: When `tryFailover(context?)` is called without a 429 status, refresh is attempted, and refresh succeeds in pass 1, the system shall return `true` immediately without proceeding to pass 2.

**Rationale**: Successful refresh recovers the current bucket, eliminating the need for failover. This combines the condition from CL06 (attempt refresh for non-429 expired tokens) with the outcome (immediate return on success).

**Traceability**: technical.md "Pass 1" section

**Behavior**:
- GIVEN: A bucket has an expired token and context.triggeringStatus is not 429
- WHEN: tryFailover() attempts refresh in Pass 1 and refresh succeeds
- THEN: tryFailover() returns `true` immediately without evaluating other buckets

**Why This Matters**: Successful refresh recovers the current bucket, eliminating the need for failover. This combines the condition (attempt refresh for non-429 expired tokens) with the outcome (immediate return on success), avoiding unnecessary bucket switching.

### REQ-1598-CL09: Clear lastFailoverReasons

**Full Requirement Text**: When `tryFailover(context?)` begins, the system shall clear `lastFailoverReasons` and log the reasons that are now visible to callers after the method returns.

**Rationale**: Ensures classification results reflect only the current failover attempt, not stale data; reasons become visible after tryFailover completes.

**Traceability**: technical.md "Modified: BucketFailoverHandlerImpl" → "New State"

**Behavior**:
- GIVEN: Previous tryFailover() call populated lastFailoverReasons
- WHEN: New tryFailover() call begins
- THEN: lastFailoverReasons cleared to empty record

**Why This Matters**: Prevents stale reasons from previous failover attempts from polluting current error reports. Ensures classification results reflect only the current failover attempt.

### REQ-1598-FL12: Add Triggering Bucket to Session

**Full Requirement Text**: When Pass 1 completes, the system shall add the triggering bucket to `triedBucketsThisSession`.

**Rationale**: Prevents re-evaluation of the triggering bucket in subsequent passes.

**Traceability**: technical.md "Pass 1" section

**Behavior**:
- GIVEN: tryFailover() completes classification
- WHEN: Pass 1 finishes
- THEN: Triggering bucket added to triedBucketsThisSession set

**Why This Matters**: Prevents re-evaluation of the triggering bucket in Pass 2 or Pass 3, avoiding infinite loops and redundant reauth attempts within a single request.

## Implementation Tasks

### Files to Create

(None — this phase modifies existing files only)

### Files to Modify

- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
  - ADD: `private lastFailoverReasons: Record<string, BucketFailureReason> = {}`
  - MODIFY: `tryFailover()` method — implement Pass 1 ONLY
  - Lines 1-58 from failover-handler.md pseudocode
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P05`
  - MUST include: `@requirement:REQ-1598-CL01, CL02, CL03, CL04, CL07, CL09, FL12`
  - MUST include: `@pseudocode failover-handler.md lines 1-58`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P05
 * @requirement REQ-1598-FL01, CL01-CL09, FL12
 * @pseudocode failover-handler.md lines 1-58
 */
async tryFailover(context?: FailoverContext): Promise<boolean> {
  // Clear reasons from previous attempt (REQ-1598-CL09)
  this.lastFailoverReasons = {};
  
  // PASS 1: CLASSIFY TRIGGERING BUCKET
  // ... implementation matching pseudocode lines 6-58 ...
  
  // TODO: Pass 2 and Pass 3 will be implemented in subsequent phases
  return false; // Placeholder until Pass 2/3 implemented
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P05" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | wc -l
# Expected: 1+

# Run classification tests - should pass now
npm test -- BucketFailoverHandlerImpl.test.ts --grep "Classification accuracy"
# Expected: 5/5 tests pass

# Run full test suite
npm test
# Expected: All tests pass
```

### Structural Verification Checklist

- [ ] Phase 04a completion marker exists
- [ ] lastFailoverReasons property added
- [ ] tryFailover() method implements Pass 1 (lines 1-58 from pseudocode)
- [ ] Plan marker present
- [ ] Requirement markers present
- [ ] Pseudocode line references present
- [ ] Classification tests pass (5/5)

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME in implementation
grep -n "TODO\|FIXME\|XXX" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | grep -v "Pass 2\|Pass 3"
# Expected: Only TODOs for Pass 2/3 are acceptable

# Check for empty returns
grep -n "return undefined\|return null" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | grep -v "test"
# Expected: No matches in implementation
```

### Semantic Verification Checklist

**Implementation Correctness**:

1. **Does Pass 1 match pseudocode?**
   - [ ] Opened BucketFailoverHandlerImpl.ts
   - [ ] Read tryFailover() implementation
   - [ ] Compared line-by-line with failover-handler.md lines 1-58
   - [ ] Verified line 4: lastFailoverReasons cleared
   - [ ] Verified line 15-16: 429 classification
   - [ ] Verified line 22-25: token-store error handling
   - [ ] Verified line 31-42: expired token refresh attempt
   - [ ] Verified line 37: immediate return on refresh success
   - [ ] Verified line 57-58: reason recorded, bucket added to session

2. **Do tests actually pass?**
   - [ ] Ran `npm test -- BucketFailoverHandlerImpl.test.ts`
   - [ ] All 5 classification tests pass
   - [ ] No tests skipped or pending

3. **Is state management correct?**
   - [ ] lastFailoverReasons is a class property
   - [ ] lastFailoverReasons cleared at start of tryFailover()
   - [ ] triedBucketsThisSession updated (line 58)

4. **Are error paths handled?**
   - [ ] Token-store exceptions caught and logged
   - [ ] Refresh exceptions caught and logged
   - [ ] No unhandled promise rejections

5. **Is Pass 1 isolated?**
   - [ ] Pass 2 and Pass 3 NOT implemented yet
   - [ ] Appropriate TODO comments for Pass 2/3
   - [ ] Temporary `return false` at end

6. **What's MISSING?**
   - [ ] (list any gaps)

## Success Criteria

- Pass 1 implemented matching pseudocode lines 1-58
- All 5 classification tests pass
- lastFailoverReasons property added and managed correctly
- triedBucketsThisSession updated
- No regressions (full test suite passes)
- Pass 2 and Pass 3 deferred with TODOs

## Failure Recovery

If tests fail:

1. Review pseudocode bucket-classification.md and failover-handler.md lines 1-58
2. Compare implementation line-by-line with pseudocode
3. Fix discrepancies
4. Re-run tests
5. Do NOT proceed to Phase 06 until all tests pass

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P05.md`

```markdown
Phase: P05
Completed: [timestamp]
Files Modified:
  - packages/cli/src/auth/BucketFailoverHandlerImpl.ts (+80 lines Pass 1)
Tests Passing: 5/5 classification tests
Full Suite: PASS
Implementation:
  - Pass 1: COMPLETE
  - Pass 2: TODO
  - Pass 3: TODO
Ready for P06: YES
```
