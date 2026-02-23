# Phase 14: Proactive Renewal Implementation

## Phase ID

`PLAN-20260223-ISSUE1598.P14`

## Prerequisites

- Phase 13a completed
- Proactive renewal tests exist and fail

## Requirements Implemented (Expanded)

### REQ-1598-PR01: Schedule Renewal at 80% Lifetime

**Full Text**: When a token is acquired or refreshed successfully, the system shall schedule proactive renewal at 80% of the token's lifetime if the lifetime exceeds 5 minutes.

**Behavior**:
- GIVEN: Token acquired with expiry timestamp
- WHEN: Token lifetime (expiry - now) exceeds 5 minutes (300 seconds)
- THEN: Renewal timer scheduled at 80% of lifetime

**Why This Matters**: Prevents tokens from expiring mid-request by renewing before expiration, reducing user-visible authentication failures. 5-minute threshold avoids scheduling for short-lived tokens.

### REQ-1598-PR02: Execute Refresh on Timer

**Full Text**: When a proactive renewal timer fires, the system shall call `oauthManager.refreshOAuthToken(provider, bucket)` for the associated bucket.

**Behavior**:
- GIVEN: Renewal timer scheduled for bucket
- WHEN: Timer fires at 80% lifetime
- THEN: refreshOAuthToken() is called with provider and bucket

**Why This Matters**: Implements the actual refresh mechanism triggered by the timer, renewing credentials before expiration.

### REQ-1598-PR03: Reschedule on Success

**Full Text**: When a proactive renewal succeeds, the system shall reschedule the next renewal timer at 80% of the new token's lifetime.

**Behavior**:
- GIVEN: refreshOAuthToken() succeeds and returns new token
- WHEN: Renewal callback processes success
- THEN: New timer scheduled at 80% of new token's lifetime

**Why This Matters**: Maintains continuous coverage by chaining renewal timers, ensuring tokens remain valid indefinitely.

### REQ-1598-PR04: Log Failures

**Full Text**: When a proactive renewal fails, the system shall log the failure and increment a failure counter for the bucket.

**Behavior**:
- GIVEN: refreshOAuthToken() throws error
- WHEN: Renewal callback processes failure
- THEN: Error logged and bucket failure counter incremented

**Why This Matters**: Enables diagnostics without blocking the retry loop. Failures are handled during actual API calls, not background renewals.

### REQ-1598-PR05: Stop After 3 Consecutive Failures

**Full Text**: When a proactive renewal fails 3 consecutive times for a bucket, the system shall stop scheduling further proactive renewals for that bucket until a successful manual refresh occurs.

**Behavior**:
- GIVEN: Bucket has failed proactive renewal 3 times consecutively
- WHEN: Next renewal would be scheduled
- THEN: No timer scheduled until manual refresh succeeds

**Why This Matters**: Prevents infinite retry loops for buckets with permanent auth issues, conserving resources.

### REQ-1598-PR06: Cancel Timers on Reset

**Full Text**: When the session resets via `resetSession()` or `reset()`, the system shall cancel all active proactive renewal timers managed by OAuthManager.

**Behavior**:
- GIVEN: Active proactive renewal timers exist
- WHEN: resetSession() or reset() is called
- THEN: All timers are cancelled and state maps cleared

**Why This Matters**: Prevents stale timers from executing after session state has been cleared, avoiding unexpected refresh attempts.

## Implementation Tasks

### Files to Create

(None — this phase modifies existing files only)

### Files to Modify

- `packages/cli/src/auth/oauth-manager.ts`
  - FIX: scheduleProactiveRenewal() — add `remainingSec > 0` check (line 27 of pseudocode)
  - IMPLEMENT: handleProactiveRenewal() callback (lines 51-91)
  - UPDATE: reset() to cancel timers (lines 92-104)
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P14`
  - MUST include: `@requirement:REQ-1598-PR01-PR06`
  - MUST include: `@pseudocode proactive-renewal.md lines 1-104`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260223-ISSUE1598.P14
 * @requirement REQ-1598-PR01
 * @pseudocode proactive-renewal.md lines 3-50
 */
function scheduleProactiveRenewal(provider: string, bucket: string, token: OAuthToken): void {
  const nowSec = Math.floor(Date.now() / 1000);
  const remainingSec = token.expiry - nowSec;
  
  // BUG FIX: Check remainingSec > 0 before comparing to 300
  if (remainingSec > 0 && remainingSec >= 300) {
    // Schedule at 80% lifetime...
  }
}
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P14" packages/cli/src/auth/ | wc -l
# Expected: 1+

# Run proactive renewal tests - should pass now
npm test -- oauth-manager.test.ts --grep "Proactive renewal"
# Expected: 8/8 tests pass

# Run full suite
npm test
# Expected: All pass
```

### Deferred Implementation Detection

```bash
# No TODOs in proactive renewal code
grep -n "TODO\|FIXME" packages/cli/src/auth/oauth-manager.ts | grep -i "proactive\|renewal"
# Expected: No matches
```

### Semantic Verification Checklist

1. **BUG FIX verified**:
   - [ ] Opened oauth-manager.ts
   - [ ] Found scheduleProactiveRenewal()
   - [ ] Verified line contains: `if (remainingSec > 0 && remainingSec >= 300)`
   - [ ] Verified expired tokens (remainingSec <= 0) rejected

2. **Renewal scheduling works**:
   - [ ] Timer scheduled at 80% lifetime for tokens > 5min
   - [ ] No timer for tokens <= 5min
   - [ ] No timer for expired tokens (THE FIX)

3. **Renewal callback works**:
   - [ ] handleProactiveRenewal() implemented
   - [ ] Success → reset counter, reschedule
   - [ ] Failure → increment counter
   - [ ] 3 failures → stop scheduling

4. **Timer cancellation works**:
   - [ ] reset() cancels all timers
   - [ ] Maps cleared (proactiveRenewalTimers, proactiveRenewalFailures)

5. **Tests pass**:
   - [ ] All 8 proactive renewal tests pass
   - [ ] Full suite passes

## Success Criteria

- scheduleProactiveRenewal() fixed (remainingSec > 0 check)
- handleProactiveRenewal() implemented
- reset() cancels timers
- All 8 proactive renewal tests pass
- Full test suite passes

## Failure Recovery

If tests fail:

1. Review pseudocode proactive-renewal.md
2. Compare implementation line-by-line
3. Fix discrepancies (especially line 27 FIX)
4. Re-run tests

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P14.md`

```markdown
Phase: P14
Completed: [timestamp]
Tests: 8/8 pass
BUG FIX Applied: YES (line 27 check)
Full Suite: PASS
Ready for P15: YES
```
