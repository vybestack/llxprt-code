# Phase 28: ProxyOAuthAdapter — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P28`

## Prerequisites
- Required: Phase 27a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P27" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts` (stub)

## Requirements Implemented (Expanded)

### R17.4: Login Dispatches by Flow Type
**Behavior**:
- GIVEN: `oauth_initiate` returns `{flow_type: "pkce_redirect", auth_url, session_id}`
- WHEN: `login("anthropic")` is called
- THEN: Dispatches to `handlePkceRedirect()` which prompts for code and calls `oauth_exchange`

- GIVEN: `oauth_initiate` returns `{flow_type: "device_code", verification_url, user_code, session_id, pollIntervalMs}`
- WHEN: `login("qwen")` is called
- THEN: Dispatches to `handleDeviceCode()` which polls `oauth_poll` until complete

- GIVEN: `oauth_initiate` returns `{flow_type: "browser_redirect", auth_url, session_id}`
- WHEN: `login("codex")` is called
- THEN: Dispatches to `handleBrowserRedirect()` which polls `oauth_poll` until complete

### R17.4 (error): Login Cancels on Failure
**Behavior**:
- GIVEN: `handlePkceRedirect()` throws an error during exchange
- WHEN: The error propagates up through `login()`
- THEN: `oauth_cancel` is sent (best-effort) before the error is re-thrown

### R17.5: On-Demand Refresh
**Behavior**:
- GIVEN: The inner process needs a refreshed token
- WHEN: `refresh("anthropic", "default")` is called
- THEN: Sends `refresh_token` request via socket and returns sanitized response data

### R18.3: Device Code Poll — Pending
**Behavior**:
- GIVEN: Device code flow is waiting for user authorization
- WHEN: `oauth_poll` returns `{status: "pending", pollIntervalMs: 5000}`
- THEN: Waits `pollIntervalMs` and polls again

### R18.4: Device Code Poll — Complete
**Behavior**:
- GIVEN: User has authorized the device code
- WHEN: `oauth_poll` returns `{status: "complete", access_token, expiry, token_type}`
- THEN: Returns the sanitized token data

### R18.5: Device Code Poll — Error
**Behavior**:
- GIVEN: Device code flow fails (expired, denied)
- WHEN: `oauth_poll` returns `{status: "error", error: "Token expired"}`
- THEN: Throws "Authentication failed: Token expired"

### R19.2: Browser Redirect Poll
**Behavior**:
- GIVEN: Browser redirect flow is waiting for user to authorize in browser
- WHEN: `oauth_poll` returns `{status: "pending"}`
- THEN: Waits 2000ms (default browser redirect interval) and polls again
- WHEN: `oauth_poll` returns `{status: "complete", ...token}`
- THEN: Returns the sanitized token data

### Cancel
**Behavior**:
- GIVEN: A session exists
- WHEN: `cancel(sessionId)` is called
- THEN: Sends `oauth_cancel` with `{session_id}` via socket

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P28`
  - 15–20 behavioral tests covering:
    - **Login — PKCE redirect flow**: initiates, prompts for code, exchanges, returns token
    - **Login — device code flow**: initiates, polls until complete, returns token
    - **Login — browser redirect flow**: initiates, polls until complete, returns token
    - **Login — unknown flow type**: throws error for unsupported flow type
    - **Login — cancel on error**: sends oauth_cancel when handler throws
    - **Login — cancel best-effort**: does not throw if oauth_cancel itself fails
    - **PKCE redirect — empty code**: throws when user provides no code
    - **PKCE redirect — exchange sends trimmed code**: whitespace trimmed before exchange
    - **Device code — pending then complete**: handles multiple pending polls before completion
    - **Device code — poll interval update**: updates pollIntervalMs when server returns new value
    - **Device code — error status**: throws on error status from poll
    - **Browser redirect — pending then complete**: polls at 2s default interval
    - **Browser redirect — poll interval update**: respects server-suggested interval
    - **Browser redirect — error status**: throws on error status from poll
    - **Refresh — success**: sends refresh_token request, returns sanitized data
    - **Cancel — sends cancel request**: sends oauth_cancel with correct session_id

### Test Rules
- Use a test double for `ProxySocketClient` at the `sendRequest()` boundary (transport-level, not service-level)
- Use `vi.useFakeTimers()` for poll interval timing
- Tests expect REAL BEHAVIOR (actual ProxyOAuthAdapter, controlled socket responses)
- NO testing for NotYetImplemented
- NO reverse tests
- Each test has `@requirement` and `@scenario` comments
- For PKCE redirect tests, mock the user input prompt at the I/O boundary

## Verification Commands

```bash
test -f packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts || echo "FAIL"

grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts && echo "FAIL: Mock theater"

grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts && echo "FAIL: Reverse testing"

grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts
# Expected: 15+ assertions
```

## Success Criteria
- 15–20 behavioral tests
- Tests fail naturally (stub not implemented)
- Zero mock theater or reverse testing
- Coverage spans R17.4, R17.5, R18.3–R18.5, R19.2

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts`
2. Re-read pseudocode 009 and specification R17–R19

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P28.md`
