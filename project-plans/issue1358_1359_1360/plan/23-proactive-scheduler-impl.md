# Phase 23: ProactiveScheduler — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P23`

## Prerequisites
- Required: Phase 22a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P22" packages/cli/src/auth/proxy/__tests__/`

## Requirements Implemented (Expanded)

### R16.1–R16.7
(See Phase 21 and 22 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/cli/src/auth/proxy/proactive-scheduler.ts` — UPDATE stub
  - MUST follow pseudocode `analysis/pseudocode/007-proactive-scheduler.md`
  - Line 23–31: `scheduleIfNeeded()` — skip if already scheduled, no refresh_token, or no expiry
  - Line 33–54: `scheduleTimer()` — calculate lead time `max(300, floor(remaining * 0.1))`, jitter 0–30s, setTimeout
  - Line 56–93: `runProactiveRenewal()` — re-check wall-clock, skip if already refreshed, call refreshCoordinator, reschedule on success, retry with backoff on failure
  - Line 95–100: `cancelAll()` — clear all timers and counters
  - Line 102–108: `cancelForKey()` — clear specific timer and counter

### Constants (from pseudocode)
- `MAX_CONSECUTIVE_FAILURES = 10`
- `RETRY_BASE_SEC = 30`
- `RETRY_CAP_SEC = 1800` (30 minutes)

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P23
 * @requirement R16.1-R16.7
 * @pseudocode analysis/pseudocode/007-proactive-scheduler.md
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/proactive-scheduler.test.ts
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/proactive-scheduler.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/proactive-scheduler.ts
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode lines 10–108

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/proactive-scheduler.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P23.md`
