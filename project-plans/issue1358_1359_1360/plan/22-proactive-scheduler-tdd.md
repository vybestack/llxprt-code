# Phase 22: ProactiveScheduler — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P22`

## Prerequisites
- Required: Phase 21a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P21" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/proactive-scheduler.ts` (stub)

## Requirements Implemented (Expanded)

### R16.1: Schedule on First Serve
**Behavior**:
- GIVEN: A token with expiry 3600s from now and a refresh_token present
- WHEN: `scheduleIfNeeded("anthropic", "default", token)` is called
- THEN: A timer is scheduled (can verify via timer count or mocked setTimeout)

### R16.2: Lead Time Algorithm
**Behavior**:
- GIVEN: Token expires in 3600s (1 hour)
- WHEN: Lead time is calculated
- THEN: `leadSec = max(300, floor(3600 * 0.1)) = 360`, plus 0–30s jitter. Timer fires ~3240–3270s from now.

### R16.3: Wall-Clock Re-Check on Fire
**Behavior**:
- GIVEN: Timer fires but token was already refreshed by another process (expiry is far in future)
- WHEN: `runProactiveRenewal()` runs
- THEN: Reschedules for new expiry instead of refreshing again

### R16.4: Cancel All on Shutdown
**Behavior**:
- GIVEN: Multiple timers are scheduled
- WHEN: `cancelAll()` is called
- THEN: All timers are cleared, maps are emptied

### R16.6: Reschedule on Success
**Behavior**:
- GIVEN: Proactive renewal succeeds with new token
- WHEN: Refresh completes
- THEN: New timer is scheduled for the new token's expiry

### R16.7: Retry on Failure with Backoff
**Behavior**:
- GIVEN: Proactive renewal fails
- WHEN: First failure
- THEN: Retry scheduled at 30s. After 2nd failure: 60s. After 10th consecutive failure: gives up.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P22`
  - 15–20 behavioral tests covering:
    - **Schedule on first serve**: timer created for token with refresh_token and expiry
    - **No schedule without refresh_token**: skips if token has no refresh_token
    - **No schedule without expiry**: skips if token has no expiry
    - **No duplicate schedule**: second call for same provider:bucket is no-op
    - **Lead time calculation**: correct formula `max(300, floor(remaining * 0.1)) + jitter`
    - **Immediate refresh for expired token**: if token already expired, refreshes immediately
    - **Wall-clock re-check**: skips refresh when re-read token is well within validity
    - **Reschedule after successful refresh**: new timer for new expiry
    - **Retry on failure**: schedules retry with exponential backoff (base 30s)
    - **Backoff cap**: retry delay capped at 1800s (30 minutes)
    - **Max consecutive failures**: gives up after 10 failures
    - **Cancel all**: clears all timers and counters
    - **Cancel for key**: clears timer for specific provider:bucket
    - **Token removed (logout)**: runProactiveRenewal exits early when token is null

### Test Rules
- Use `vi.useFakeTimers()` or equivalent to control timer scheduling
- Tests expect REAL BEHAVIOR (actual ProactiveScheduler, mocked timers)
- NO testing for NotYetImplemented
- NO reverse tests
- Each test has `@requirement` and `@scenario` comments

## Verification Commands

```bash
test -f packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts || echo "FAIL"

grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts && echo "FAIL: Mock theater"

grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts && echo "FAIL: Reverse testing"

grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts
# Expected: 15+ assertions
```

## Success Criteria
- 15–20 behavioral tests
- Tests fail naturally (stub not implemented)
- Zero mock theater or reverse testing
- Coverage spans R16.1–R16.7

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts`
2. Re-read pseudocode 007 and specification R16

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P22.md`
