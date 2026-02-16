# Phase 21: ProactiveScheduler — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P21`

## Prerequisites
- Required: Phase 20a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P20" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/refresh-coordinator.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R16.1: Schedule on First Serve
**Full Text**: When `get_token` first serves a token to the inner process, the host proxy shall schedule a proactive renewal timer.
**Behavior**:
- GIVEN: A token with expiry is served to the inner process via `get_token`
- WHEN: `scheduleIfNeeded(provider, bucket, token)` is called
- THEN: A timer is scheduled to fire before the token expires
**Why This Matters**: Proactive renewal ensures tokens are refreshed before they expire, avoiding request failures.

### R16.2: Lead Time Algorithm
**Full Text**: `leadSec = Math.max(300, Math.floor(remainingSec * 0.1))` with jitter `Math.floor(Math.random() * 30)`.
**Why This Matters**: Matches the existing OAuthManager algorithm; avoids too-early or too-late renewal.

### R16.3: Wall-Clock Re-Check
**Full Text**: When a proactive renewal timer fires, re-check actual wall-clock time against token expiry before deciding to refresh.
**Why This Matters**: Handles sleep/suspend recovery — timer may fire late after system resume.

### R16.4–R16.5: Cancellation and Non-Persistence
**Full Text**: Cancel all timers on sandbox exit. Timers are NOT persisted across restarts.
**Why This Matters**: Clean shutdown; no stale timers.

### R16.6–R16.7: Reschedule on Success, Retry on Failure
**Full Text**: On success, schedule for new token expiry. On failure, retry with exponential backoff (base 30s, cap 30min, max 10 consecutive failures).
**Why This Matters**: Continuous proactive renewal for valid sessions; bounded retry for transient failures.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/proactive-scheduler.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P21`
  - Exports: `ProactiveScheduler` class
  - Constructor accepts `refreshCoordinator: RefreshCoordinator`
  - Methods: `scheduleIfNeeded(provider, bucket, token)`, `scheduleTimer(key, provider, bucket, expirySec)`, `runProactiveRenewal(key, provider, bucket)`, `cancelAll()`, `cancelForKey(provider, bucket)`
  - All methods throw `new Error('NotYetImplemented')` or are no-ops
  - Maximum 50 lines (stub)

### Files to Modify
None — this is a new file.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P21
 * @requirement R16.1-R16.7
 * @pseudocode analysis/pseudocode/007-proactive-scheduler.md
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/proactive-scheduler.ts || echo "FAIL: proactive-scheduler.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P21" packages/cli/src/auth/proxy/ | wc -l
# Expected: 1+ occurrences

find packages/ -name "*proactive-scheduler*V2*" -o -name "*proactive-scheduler*New*"
# Expected: no results

npm run typecheck
```

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Constructor accepts `RefreshCoordinator`
- All public methods exist as stubs
- `timers` and `retryCounters` Maps exist as properties

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/`
2. Re-read pseudocode 007 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P21.md`
