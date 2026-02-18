# Phase 20: RefreshCoordinator — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P20`

## Prerequisites
- Required: Phase 19a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P19" packages/cli/src/auth/proxy/__tests__/`

## Requirements Implemented (Expanded)

### R11.1–R11.5, R12.1–R12.5, R13.1–R13.3, R14.1–R14.4
(See Phase 18 and 19 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/cli/src/auth/proxy/refresh-coordinator.ts` — UPDATE stub
  - MUST follow pseudocode `analysis/pseudocode/006-refresh-coordinator.md`
  - Line 22–89: `handleRefreshToken()` — rate limit check → read token → verify refresh_token → acquire lock → double-check → refresh → merge → save → release → return sanitized
  - Line 91–102: `refreshWithRetry()` — up to 2 retries with [1s, 3s] backoff; auth errors throw immediately
  - Line 104–122: `refreshGeminiToken()` — OAuth2Client path: setCredentials → getAccessToken → convert Credentials → OAuthToken
  - Line 124–127: `isAuthError()` — 401 or invalid_grant
  - Line 129–132: `isTransientError()` — ECONNREFUSED, ETIMEDOUT, status >= 500

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P20
 * @requirement R11.1-R11.5, R12.1-R12.5, R13.1-R13.3, R14.1-R14.4
 * @pseudocode analysis/pseudocode/006-refresh-coordinator.md
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/refresh-coordinator.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/refresh-coordinator.ts
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode lines 10–132

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/refresh-coordinator.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P20.md`
