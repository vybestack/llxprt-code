# Phase 29: ProxyOAuthAdapter — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P29`

## Prerequisites
- Required: Phase 28a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P28" packages/cli/src/auth/proxy/__tests__/`

## Requirements Implemented (Expanded)

### R17.4, R17.5, R18.3–R18.5, R19.2
(See Phase 27 and 28 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts` — UPDATE stub
  - MUST follow pseudocode `analysis/pseudocode/009-proxy-oauth-adapter.md`
  - Line 16–40: `login()` — send `oauth_initiate`, switch on `flow_type` to dispatch handler; catch errors and send `oauth_cancel` (best-effort) before re-throwing
  - Line 42–58: `handlePkceRedirect()` — display auth URL, prompt for authorization code, trim, send `oauth_exchange`, return sanitized token
  - Line 60–87: `handleDeviceCode()` — display verification URL + user code, poll loop with `oauth_poll` at `pollIntervalMs`, handle pending/complete/error statuses, update interval if server suggests different
  - Line 88–113: `handleBrowserRedirect()` — display auth URL, poll loop with `oauth_poll` at 2000ms default interval, handle pending/complete/error statuses
  - Line 115–118: `refresh()` — send `refresh_token` request via socket, return `response.data`
  - Line 120–121: `cancel()` — send `oauth_cancel` with `{session_id}`

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P29
 * @requirement R17.4, R17.5, R18.3-R18.5, R19.2
 * @pseudocode analysis/pseudocode/009-proxy-oauth-adapter.md
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/proxy-oauth-adapter.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/proxy-oauth-adapter.ts
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode lines 10–121

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/proxy-oauth-adapter.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P29.md`
