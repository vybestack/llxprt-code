# Phase 11: Foreground Reauth Implementation

## Phase ID

`PLAN-20260223-ISSUE1598.P11`

## Prerequisites

- Phase 10a completed
- Pass 2 and Pass 3 tests exist and fail

## Requirements Implemented (Expanded)

### REQ-1598-FL01: Three Sequential Passes

**Full Text**: The system shall execute three sequential passes in `tryFailover()`: classification, candidate search, and foreground reauth.

**Behavior**:
- GIVEN: tryFailover() is called
- WHEN: Failover logic executes
- THEN: Pass 1 (classification), Pass 2 (candidate search), and Pass 3 (reauth) execute sequentially

**Why This Matters**: Structured approach maximizes recovery opportunities while minimizing user friction. Classification identifies problems, candidate search finds automatic solutions, and reauth provides last-resort interactive recovery.

### REQ-1598-FL03: Valid Token Bucket Switch

**Full Text**: When Pass 2 finds a bucket with a valid unexpired token, the system shall call `setSessionBucket(provider, bucket)` and return `true`.

**Behavior**:
- GIVEN: Pass 2 iterates through buckets in profile order
- WHEN: A bucket with valid unexpired token (expiry > now) is found
- THEN: setSessionBucket() is called and tryFailover() returns true

**Why This Matters**: Prioritizes buckets with immediately usable credentials, enabling fast recovery without refresh or reauth.

### REQ-1598-FL04: Expired Token Refresh Attempt

**Full Text**: When Pass 2 finds a bucket with an expired token, the system shall attempt refresh.

**Behavior**:
- GIVEN: Pass 2 finds a bucket with expired token (expiry <= now)
- WHEN: Token expiry check fails
- THEN: System calls refreshOAuthToken() for that bucket

**Why This Matters**: Enables recovery via automatic refresh without user interaction, avoiding unnecessary reauth prompts.

### REQ-1598-FL05: Successful Refresh Recovery

**Full Text**: When Pass 2 refresh succeeds, the system shall call `setSessionBucket(provider, bucket)` and return `true`.

**Behavior**:
- GIVEN: Pass 2 attempts refresh for expired token
- WHEN: refreshOAuthToken() succeeds
- THEN: setSessionBucket() is called and tryFailover() returns true

**Why This Matters**: Successful refresh enables request to proceed with recovered credentials, completing failover without user involvement.

### REQ-1598-FL06: Pass 2 to Pass 3 Transition

**Full Text**: When Pass 2 completes without finding a valid or refreshable bucket, the system shall proceed to Pass 3.

**Behavior**:
- GIVEN: Pass 2 iterates through all buckets
- WHEN: No bucket has valid token and no refresh succeeds
- THEN: Pass 3 (foreground reauth) is initiated

**Why This Matters**: Ensures all recovery mechanisms are attempted before giving up, providing maximum resilience.

### REQ-1598-FL07: Single Reauth Attempt

**Full Text**: When Pass 3 finds ONE bucket classified as `expired-refresh-failed` or `no-token` not in `triedBucketsThisSession`, the system shall attempt `oauthManager.authenticate(provider, bucket)` with a 5-minute timeout for that single bucket only.

**Behavior**:
- GIVEN: Pass 3 identifies reauth-eligible buckets (expired-refresh-failed or no-token)
- WHEN: At least one eligible bucket exists not in triedBucketsThisSession
- THEN: authenticate() is called for ONE bucket only with 5-minute timeout

**Why This Matters**: Foreground reauth is the last resort for buckets that cannot be automatically recovered. Limit to one attempt to avoid user fatigue from multiple authentication prompts.

### REQ-1598-FL08: Post-Reauth Token Validation

**Full Text**: When Pass 3 foreground reauth succeeds, the system shall call `getOAuthToken` to verify the token exists, and if non-null, call `setSessionBucket(provider, bucket)` and return `true`.

**Behavior**:
- GIVEN: authenticate() completes successfully
- WHEN: Post-reauth validation occurs
- THEN: getOAuthToken() is called; if token exists, setSessionBucket() is called and true is returned

**Why This Matters**: Post-reauth validation ensures the token is actually usable before proceeding with the request, preventing false positives from authentication without token acquisition.

### REQ-1598-FL09: Post-Reauth Null Token Classification

**Full Text**: When Pass 3 foreground reauth succeeds but `getOAuthToken` returns `null`, the system shall classify the bucket as `reauth-failed`.

**Behavior**:
- GIVEN: authenticate() succeeds but getOAuthToken() returns null
- WHEN: Post-reauth validation fails
- THEN: Bucket is classified as `reauth-failed`

**Why This Matters**: Authentication without usable token is treated as a failure condition, enabling proper error reporting.

### REQ-1598-FL10: Failed Reauth Tracking

**Full Text**: When Pass 3 foreground reauth fails, the system shall classify the bucket as `reauth-failed` and add it to `triedBucketsThisSession`.

**Behavior**:
- GIVEN: authenticate() throws error or times out
- WHEN: Reauth fails
- THEN: Bucket classified as `reauth-failed` and added to triedBucketsThisSession

**Why This Matters**: Prevents redundant reauth attempts for failed buckets within the same request.

### REQ-1598-FL13: Profile Order Iteration

**Full Text**: When Pass 2 evaluates buckets, the system shall iterate in profile order.

**Behavior**:
- GIVEN: Profile defines buckets as ["default", "claudius", "vybestack"]
- WHEN: Pass 2 iterates through buckets
- THEN: Buckets are evaluated in array order: default, then claudius, then vybestack

**Why This Matters**: Maintains predictable and stable bucket selection behavior. Profile order is defined as the array index order from the profile configuration.

### REQ-1598-FL14: setSessionBucket Error Handling

**Full Text**: If `setSessionBucket()` throws an exception during pass-2 or pass-3 bucket switch, the system shall log the error and continue with failover.

**Behavior**:
- GIVEN: setSessionBucket() throws an exception during Pass 2 or Pass 3
- WHEN: Exception is caught
- THEN: Error is logged and failover continues to next bucket or pass

**Why This Matters**: Session bucket persistence failure should not block recovery attempts or abort the entire failover process.

### REQ-1598-FL17: Pass 2 Expired Token Handling

**Full Text**: When a token is retrieved in Pass 2 with `expiry - now <= 0` (expired), the system shall attempt refresh; if refresh succeeds, call `setSessionBucket()` and return `true`; if refresh fails, classify the bucket as `expired-refresh-failed` and continue to the next bucket.

**Behavior**:
- GIVEN: Pass 2 finds bucket with expired token (expiry - now <= 0)
- WHEN: Refresh is attempted
- THEN: On success: setSessionBucket() called, return true; On failure: classify as `expired-refresh-failed`, continue to next bucket

**Why This Matters**: Consolidates Pass 2 expired token handling — attempt refresh, succeed or fail, and continue failover appropriately. Avoids redundant requirements for the same logical flow.

### REQ-1598-FL18: Near-Expiry Token Acceptance

**Full Text**: If a token is retrieved with `remainingSec <= 30` but `remainingSec > 0`, the system shall accept it without refresh.

**Behavior**:
- GIVEN: Token has 20 seconds remaining (0 < remainingSec <= 30)
- WHEN: Pass 2 evaluates the token
- THEN: Token is accepted and used without refresh attempt

**Why This Matters**: The 30-second threshold is only for classifying NULL results, not rejecting returned tokens. Near-expiry tokens are still usable.

### REQ-1598-CL05: Skipped Bucket Classification

**Full Text**: When `tryFailover(context?)` evaluates a bucket already present in `triedBucketsThisSession`, the system shall classify it as `skipped`.

**Behavior**:
- GIVEN: A bucket exists in triedBucketsThisSession set
- WHEN: Pass 2 evaluates that bucket
- THEN: Bucket is classified as `skipped` and evaluation continues to next bucket

**Why This Matters**: Prevents redundant reauth attempts and infinite loops within a single request by tracking which buckets have already been tried.

## Implementation Tasks

### Files to Create

(None — this phase modifies existing files only)

### Files to Modify

- `packages/cli/src/auth/BucketFailoverHandlerImpl.ts`
  - IMPLEMENT: Pass 2 (lines 60-121 from failover-handler.md pseudocode)
  - IMPLEMENT: Pass 3 (lines 123-170 from failover-handler.md pseudocode)
  - REPLACE: Placeholder `return false` with full three-pass logic
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P11`
  - MUST include: `@requirement:REQ-1598-FL01` (and others)
  - MUST include: `@pseudocode failover-handler.md lines 60-170`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P11
 * @requirement REQ-1598-FL01, FL03-FL11, FL13-FL18, CL05
 * @pseudocode failover-handler.md lines 1-172 (complete)
 */
async tryFailover(context?: FailoverContext): Promise<boolean> {
  // Pass 1: ALREADY IMPLEMENTED (Phase 05)
  // ...
  
  // PASS 2: FIND NEXT CANDIDATE (Phase 11)
  // Implementation matching pseudocode lines 60-121
  
  // PASS 3: FOREGROUND REAUTH (Phase 11)
  // Implementation matching pseudocode lines 123-170
  
  // All passes exhausted
  return false;
}
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P11" packages/cli/src/auth/ | wc -l
# Expected: 1+

# Run Pass 2 and Pass 3 tests - should pass now
npm test -- BucketFailoverHandlerImpl.test.ts --grep "Pass 2\|Pass 3"
# Expected: All 12+ tests pass

# Run full suite
npm test
# Expected: All pass
```

### Deferred Implementation Detection

```bash
# Verify no TODOs left in tryFailover (except comments)
grep -n "TODO\|FIXME" packages/cli/src/auth/BucketFailoverHandlerImpl.ts | grep -v "^\s*//"
# Expected: No matches (or only in comments)
```

### Semantic Verification Checklist

1. **Pass 2 implementation correct**:
   - [ ] Read tryFailover() Pass 2 section
   - [ ] Verified profile-order iteration (line 64)
   - [ ] Verified skipped bucket classification (line 65-68)
   - [ ] Verified expired token refresh attempt (line 89-109)
   - [ ] Verified valid token bucket switch (line 111-120)
   - [ ] Verified setSessionBucket error handling (line 95-100, 113-118)

2. **Pass 3 implementation correct**:
   - [ ] Read tryFailover() Pass 3 section
   - [ ] Verified single candidate selection (line 128-136)
   - [ ] Verified reauth-eligible bucket types (line 131-132)
   - [ ] Verified authenticate() call (line 141)
   - [ ] Verified post-reauth token validation (line 144)
   - [ ] Verified setSessionBucket error handling (line 152-157)

3. **Tests pass**:
   - [ ] All Pass 2 tests pass (5/5)
   - [ ] All Pass 3 tests pass (7/7)
   - [ ] Full suite passes

4. **State management correct**:
   - [ ] triedBucketsThisSession updated in Pass 3 (line 148, 164)
   - [ ] lastFailoverReasons populated throughout
   - [ ] sessionBucket updated correctly

## Success Criteria

- Pass 2 and Pass 3 implemented matching pseudocode
- All 12+ reauth tests pass
- Full test suite passes
- Three-pass algorithm complete
- No placeholder returns remaining

## Failure Recovery

If tests fail:

1. Review pseudocode failover-handler.md lines 60-170
2. Compare implementation line-by-line
3. Fix discrepancies
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P11.md`

```markdown
Phase: P11
Completed: [timestamp]
Tests: 12/12 pass (5 Pass 2, 7 Pass 3)
Implementation:
  - Pass 1: COMPLETE (P05)
  - Pass 2: COMPLETE (P11)
  - Pass 3: COMPLETE (P11)
Full Suite: PASS
Ready for P12: YES
```
