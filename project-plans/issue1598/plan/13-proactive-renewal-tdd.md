# Phase 13: Proactive Renewal TDD

## Phase ID

`PLAN-20260223-ISSUE1598.P13`

## Prerequisites

- Phase 12a completed

## Requirements Implemented (Expanded)

### REQ-1598-PR01: Schedule Renewal at 80% Lifetime

**Full Text**: When a token is acquired or refreshed successfully, the system shall schedule proactive renewal at 80% of the token's lifetime if the lifetime exceeds 5 minutes.

**Behavior**:
- GIVEN: Token acquired with expiry timestamp
- WHEN: Token lifetime calculated (expiry - now)
- THEN: If lifetime > 300s → schedule timer at 80% delay | If <= 300s → no timer

**Why This Matters**: Prevents tokens from expiring mid-request by renewing before expiration.

### REQ-1598-PR03: Reschedule on Success

**Full Text**: When a proactive renewal succeeds, the system shall reschedule the next renewal timer at 80% of the new token's lifetime.

**Behavior**:
- GIVEN: Proactive renewal completes successfully
- WHEN: New token retrieved
- THEN: New timer scheduled at 80% of new token's lifetime

**Why This Matters**: Maintains continuous coverage by chaining renewal timers.

### REQ-1598-PR05: Stop After 3 Failures

**Full Text**: When a proactive renewal fails 3 consecutive times for a bucket, the system shall stop scheduling further proactive renewals for that bucket until a successful manual refresh occurs.

**Behavior**:
- GIVEN: 3 consecutive proactive renewal failures for bucket
- WHEN: Failure threshold reached
- THEN: No more timers scheduled for that bucket

**Why This Matters**: Prevents infinite retry loops for buckets with permanent auth issues.

### REQ-1598-PR06: Cancel Timers on Reset

**Full Text**: When the session resets via `resetSession()` or `reset()`, the system shall cancel all active proactive renewal timers managed by OAuthManager.

**Behavior**:
- GIVEN: Active proactive renewal timers exist
- WHEN: reset() called
- THEN: All timers cancelled, state cleared

**Why This Matters**: Prevents stale timers from executing after session state has been cleared.

## Implementation Tasks

### Files to Create/Update

- `packages/cli/src/auth/oauth-manager.test.ts` (CREATE OR UPDATE)
  - ADD test suite: "Proactive renewal"
  - Tests:
    - `should schedule renewal at 80% lifetime for tokens > 5min`
    - `should not schedule renewal for tokens <= 5min`
    - `should not schedule renewal for expired tokens (BUG FIX TEST)`
    - `should reschedule on successful renewal`
    - `should increment failure counter on renewal failure`
    - `should stop scheduling after 3 failures`
    - `should reset failure counter on manual refresh success`
    - `should cancel all timers on reset()`
  - Use Vitest fake timers: `vi.useFakeTimers()`
  - MUST include: `@plan:PLAN-20260223-ISSUE1598.P13`
  - MUST include: `@requirement:REQ-1598-PR01, PR03, PR05, PR06`
  - MUST include: `@pseudocode proactive-renewal.md lines 1-104`

### Required Code Markers

```typescript
describe('Proactive renewal @plan:PLAN-20260223-ISSUE1598.P13', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  /**
   * @requirement REQ-1598-PR01
   * @pseudocode proactive-renewal.md lines 27-30
   */
  it('should schedule renewal at 80% lifetime for tokens > 5min', () => {
    // Arrange: Token with 10 min lifetime
    // Act: Call scheduleProactiveRenewal()
    // Assert: Timer scheduled at 8 min (80% of 10 min)
  });
  
  /**
   * @requirement REQ-1598-PR01
   * @pseudocode proactive-renewal.md line 27 (THE FIX)
   */
  it('should not schedule renewal for expired tokens', () => {
    // Arrange: Token with expiry < now (expired)
    // Act: Call scheduleProactiveRenewal()
    // Assert: No timer scheduled
  });
});
```

## Verification Commands

```bash
# Check markers
grep -r "@plan:PLAN-20260223-ISSUE1598.P13" packages/cli/src/auth/ | wc -l
# Expected: 8+ occurrences

# Run tests (will fail until P14)
npm test -- oauth-manager.test.ts --grep "Proactive renewal"
# Expected: Tests fail naturally
```

### Checklist

- [ ] 8+ proactive renewal tests created
- [ ] Tests use fake timers
- [ ] BUG FIX test included (expired token rejection)
- [ ] Tests fail naturally
- [ ] No NotYetImplemented checks
- [ ] Ready for Phase 14

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P13.md`

```markdown
Phase: P13
Tests Added: 8+
Uses Fake Timers: YES
Fail Naturally: YES
Ready: YES
```
