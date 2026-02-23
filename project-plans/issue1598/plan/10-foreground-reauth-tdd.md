# Phase 10: Foreground Reauth TDD

## Phase ID

`PLAN-20260223-ISSUE1598.P10`

## Prerequisites

- Phase 09a completed

## Requirements Implemented (Expanded)

### REQ-1598-FL03: Valid Token Bucket Switch

**Full Text**: When Pass 2 finds a bucket with a valid unexpired token, the system shall call `setSessionBucket(provider, bucket)` and return `true`.

**Behavior**:
- GIVEN: Pass 2 evaluates bucket with valid token (expiry > now)
- WHEN: Token retrieved successfully
- THEN: sessionBucket set to that bucket AND return true

**Why This Matters**: Prioritizes buckets with immediately usable credentials.

### REQ-1598-FL17: Expired Token Handling in Pass 2

**Full Text**: When a token is retrieved in Pass 2 with `expiry - now <= 0` (expired), the system shall attempt refresh; if refresh succeeds, call `setSessionBucket()` and return `true`; if refresh fails, classify the bucket as `expired-refresh-failed` and continue to the next bucket.

**Behavior**:
- GIVEN: Pass 2 evaluates bucket with expired token
- WHEN: Refresh attempted
- THEN: Success → switch bucket, return true | Failure → classify, continue iteration

**Why This Matters**: Enables automatic recovery via refresh without user interaction.

### REQ-1598-FL07: Single Reauth Candidate

**Full Text**: When Pass 3 finds ONE bucket classified as `expired-refresh-failed` or `no-token` not in `triedBucketsThisSession`, the system shall attempt `oauthManager.authenticate(provider, bucket)` with a 5-minute timeout for that single bucket only.

**Behavior**:
- GIVEN: Pass 3 identifies reauth-eligible bucket
- WHEN: First eligible bucket found
- THEN: Attempt authenticate() for THAT bucket only (not iterative)

**Why This Matters**: Limits reauth prompts to one per request — prevents user fatigue.

### REQ-1598-FL08: Post-Reauth Token Validation

**Full Text**: When Pass 3 foreground reauth succeeds, the system shall call `getOAuthToken` to verify the token exists, and if non-null, call `setSessionBucket(provider, bucket)` and return `true`.

**Behavior**:
- GIVEN: authenticate() completes without error
- WHEN: Post-reauth validation runs
- THEN: If token exists → switch bucket, return true | If token null → classify as reauth-failed

**Why This Matters**: Authentication success doesn't guarantee usable token — validation prevents false positives.

## Implementation Tasks

### Files to Create/Update

- `packages/cli/src/auth/BucketFailoverHandlerImpl.test.ts` (UPDATE)
  - ADD test suite: "Pass 2: Candidate search"
  - Tests:
    - `should switch to bucket with valid token`
    - `should refresh expired token and switch on success`
    - `should classify expired-refresh-failed and continue on refresh failure`
    - `should skip buckets already in triedBucketsThisSession`
    - `should iterate in profile order`
  - ADD test suite: "Pass 3: Foreground reauth"
  - Tests:
    - `should attempt reauth for first no-token bucket`
    - `should attempt reauth for first expired-refresh-failed bucket`
    - `should validate token after reauth success`
    - `should classify reauth-failed if token null after reauth`
    - `should classify reauth-failed if authenticate throws`
    - `should not attempt reauth for quota-exhausted buckets`
    - `should attempt reauth for only ONE candidate`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P10`
  - MUST include: `@requirement:REQ-1598-FL03, FL07, FL08, FL17` (and others)
  - MUST include: `@pseudocode failover-handler.md lines 60-170`

### Required Code Markers

```typescript
describe('Pass 2: Candidate search @plan:PLAN-20260223-ISSUE1598.P10', () => {
  /**
   * @requirement REQ-1598-FL03
   * @pseudocode failover-handler.md lines 111-120
   */
  it('should switch to bucket with valid token', async () => {
    // Arrange: Multiple buckets, second has valid token
    // Act: Call tryFailover()
    // Assert: sessionBucket === secondBucket, returned true
  });
});

describe('Pass 3: Foreground reauth @plan:PLAN-20260223-ISSUE1598.P10', () => {
  /**
   * @requirement REQ-1598-FL07
   * @pseudocode failover-handler.md lines 127-136
   */
  it('should attempt reauth for only ONE candidate', async () => {
    // Arrange: Multiple no-token buckets
    // Act: Call tryFailover()
    // Assert: authenticate() called ONCE, not for every bucket
  });
});
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P10" packages/cli/src/auth/ | wc -l
# Expected: 12+ occurrences

# Run tests (will fail until P11)
npm test -- BucketFailoverHandlerImpl.test.ts --grep "Pass 2\|Pass 3"
# Expected: Tests fail naturally
```

### Checklist

- [ ] 5+ tests for Pass 2
- [ ] 7+ tests for Pass 3
- [ ] Tests fail naturally
- [ ] No NotYetImplemented checks
- [ ] Ready for Phase 11

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P10.md`

```markdown
Phase: P10
Tests Added: 12+
Pass 2 tests: 5
Pass 3 tests: 7
Fail Naturally: YES
Ready: YES
```
