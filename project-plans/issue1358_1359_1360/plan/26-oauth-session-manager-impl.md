# Phase 26: OAuthSessionManager — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P26`

## Prerequisites
- Required: Phase 25a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P25" packages/cli/src/auth/proxy/__tests__/`

## Requirements Implemented (Expanded)

### R17.1–R17.3, R18.1, R19.1, R20.1–R20.9
(See Phase 24 and 25 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/cli/src/auth/proxy/oauth-session-manager.ts` — UPDATE stub
  - MUST follow pseudocode `analysis/pseudocode/008-oauth-session-manager.md`
  - Line 15–20: Constructor — parse `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS` env var, initialize `sessions` Map
  - Line 22–23: `startGC()` — start 60-second interval calling `sweepExpired()`
  - Line 25–31: `sweepExpired()` — iterate sessions, remove expired (createdAt + timeout) and used, abort controllers
  - Line 33–40: `createSession()` — generate `crypto.randomBytes(16).toString('hex')`, store session with all fields, return sessionId
  - Line 42–54: `getSession()` — validate exists → not used → not expired → peer identity match → return session
  - Line 56–59: `markUsed()` — set `session.used = true`
  - Line 61–65: `removeSession()` — abort controller if present, delete from map
  - Line 67–73: `clearAll()` — abort all controllers, clear map, clear GC interval

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P26
 * @requirement R17.1-R17.3, R18.1, R19.1, R20.1-R20.9
 * @pseudocode analysis/pseudocode/008-oauth-session-manager.md
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/oauth-session-manager.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/oauth-session-manager.ts
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode lines 10–73

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/oauth-session-manager.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P26.md`
