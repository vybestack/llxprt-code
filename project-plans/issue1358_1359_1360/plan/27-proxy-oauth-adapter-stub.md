# Phase 27: ProxyOAuthAdapter — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P27`

## Prerequisites
- Required: Phase 26a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P26" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/oauth-session-manager.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R17.4: ProxyOAuthAdapter Drives Login via Proxy
**Full Text**: While `LLXPRT_CREDENTIAL_SOCKET` is set (proxy mode), the inner process's `/auth login` command shall use a `ProxyOAuthAdapter` class to drive the login flow via `oauth_initiate`/`oauth_exchange`/`oauth_poll`/`oauth_cancel` proxy operations instead of calling `OAuthManager.login()` directly.
**Behavior**:
- GIVEN: The inner process is running in proxy mode
- WHEN: The user runs `/auth login anthropic`
- THEN: `ProxyOAuthAdapter.login("anthropic")` sends `oauth_initiate` via the socket, displays the auth URL, prompts for the code, sends `oauth_exchange`, returns sanitized token
**Why This Matters**: Login UX works transparently in sandbox; PKCE secrets and refresh tokens stay on the host.

### R17.5: On-Demand Refresh via Proxy
**Full Text**: While `LLXPRT_CREDENTIAL_SOCKET` is set, the inner process shall use `ProxyOAuthAdapter.refresh(provider, bucket)` to trigger on-demand token refresh via the `refresh_token` proxy operation.
**Behavior**:
- GIVEN: The inner process encounters an expired token
- WHEN: `ProxyOAuthAdapter.refresh("anthropic", "default")` is called
- THEN: Sends `refresh_token` operation over the socket; host performs actual refresh; sanitized token returned
**Why This Matters**: Fallback when proactive renewal hasn't fired yet; inner process has no refresh_token to refresh directly.

### R18.3–R18.5: Device Code Polling (Inner Side)
**Full Text**: Inner process polls `oauth_poll` for device code flow completion. Returns pending/complete/error status.
**Behavior**:
- GIVEN: A device code flow is in progress (Qwen)
- WHEN: `handleDeviceCode()` polls via `oauth_poll`
- THEN: Displays verification URL + user code, polls at `pollIntervalMs`, returns sanitized token on completion
**Why This Matters**: Device code flows require a poll loop on the inner side to detect user authorization.

### R19.2: Browser Redirect Polling (Inner Side)
**Full Text**: Inner process polls `oauth_poll` for browser redirect flow completion.
**Behavior**:
- GIVEN: A browser redirect flow is in progress (Codex)
- WHEN: `handleBrowserRedirect()` polls via `oauth_poll`
- THEN: Displays auth URL, polls at 2s intervals, returns sanitized token on completion
**Why This Matters**: Browser redirect callback happens on host; inner process polls to detect when user has authorized.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P27`
  - Exports: `ProxyOAuthAdapter` class
  - Constructor accepts `socketClient: ProxySocketClient`
  - Methods: `login(provider, bucket?)`, `handlePkceRedirect(sessionId, data)`, `handleDeviceCode(sessionId, data)`, `handleBrowserRedirect(sessionId, data)`, `refresh(provider, bucket?)`, `cancel(sessionId)`
  - All methods throw `new Error('NotYetImplemented')`
  - Maximum 50 lines (stub)

### Files to Modify
None — this is a new file.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P27
 * @requirement R17.4, R17.5, R18.3-R18.5, R19.2
 * @pseudocode analysis/pseudocode/009-proxy-oauth-adapter.md
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/proxy-oauth-adapter.ts || echo "FAIL: proxy-oauth-adapter.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P27" packages/cli/src/auth/proxy/ | wc -l
# Expected: 1+ occurrences

find packages/ -name "*proxy-oauth-adapter*V2*" -o -name "*proxy-oauth-adapter*New*"
# Expected: no results

npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/auth/proxy/proxy-oauth-adapter.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `ProxyOAuthAdapter` class exported with correct constructor signature
3. **No parallel versions?** No `proxy-oauth-adapterV2.ts` or similar

## Success Criteria
- File created with proper plan markers
- TypeScript compiles cleanly
- Constructor accepts `ProxySocketClient`
- All public methods exist as stubs
- `login()` accepts `provider: string` and optional `bucket?: string`

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/`
2. Re-read pseudocode 009 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P27.md`
