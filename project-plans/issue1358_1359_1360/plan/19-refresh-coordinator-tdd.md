# Phase 19: RefreshCoordinator — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P19`

## Prerequisites
- Required: Phase 18a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P18" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/refresh-coordinator.ts` (stub)

## Requirements Implemented (Expanded)

### R11.1–R11.5: Host-Side Refresh Flow
**Behavior**:
- GIVEN: A stored token with a `refresh_token` for provider "anthropic"
- WHEN: `handleRefreshToken("anthropic", "default")` is called
- THEN: Reads token, acquires lock, calls provider.refreshToken(), merges, saves, returns sanitized token (no `refresh_token`)
**Why This Matters**: Core refresh orchestration that keeps refresh_token on the host.

### R11.4: Double-Check Pattern
**Behavior**:
- GIVEN: Another process refreshes between lock acquisition attempts
- WHEN: RefreshCoordinator acquires the lock and re-reads the token
- THEN: If the re-read token is valid (expiry > now + 60s), returns it without refreshing again

### R11.5: Gemini Exception
**Behavior**:
- GIVEN: A refresh for provider "gemini"
- WHEN: `handleRefreshToken("gemini", "default")` is called
- THEN: Uses OAuth2Client path (setCredentials → getAccessToken) instead of provider.refreshToken()

### R12.1–R12.5: Token Merge
**Behavior**:
- GIVEN: Stored token `{access_token: "old", refresh_token: "rt", scope: "read"}` and new token `{access_token: "new", expiry: 9999}`
- WHEN: Tokens are merged
- THEN: Result has `{access_token: "new", expiry: 9999, refresh_token: "rt", scope: "read"}`

### R13.1–R13.3: Retry and Backoff
**Behavior**:
- GIVEN: Provider.refreshToken() fails with a network error
- WHEN: First retry after 1s, second retry after 3s
- THEN: On third failure, returns INTERNAL_ERROR
- GIVEN: Provider.refreshToken() fails with 401 (auth error)
- WHEN: isAuthError detects it
- THEN: No retry — throws immediately

### R14.1–R14.3: Rate Limiting
**Behavior**:
- GIVEN: A refresh succeeded 10 seconds ago for "anthropic:default"
- WHEN: Another refresh is requested and the current token is still valid
- THEN: Returns current token without refreshing
- GIVEN: A refresh succeeded 10 seconds ago and the current token is expired
- WHEN: Another refresh is requested
- THEN: Returns RATE_LIMITED with retryAfter = 20

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P19`
  - 18–25 behavioral tests covering:
    - **Happy path**: refresh reads token, calls provider, merges, saves, returns sanitized
    - **Sanitization**: returned token NEVER contains refresh_token
    - **NOT_FOUND**: returns NOT_FOUND when no token stored
    - **No refresh_token stored**: throws error when stored token has no refresh_token
    - **Double-check pattern**: skips refresh when re-read token is still valid
    - **Lock acquisition**: acquires and releases refresh lock
    - **Merge contract**: access_token/expiry always use new; refresh_token preserved if new is missing
    - **Merge contract**: provider-specific fields (account_id) preserved
    - **Gemini exception**: uses OAuth2Client path, converts Credentials → OAuthToken
    - **Retry on transient error**: retries 2 times with 1s, 3s delays
    - **No retry on auth error**: 401/invalid_grant throws immediately
    - **All retries exhausted**: returns INTERNAL_ERROR
    - **Rate limit — valid token in cooldown**: returns current token
    - **Rate limit — expired token in cooldown**: returns RATE_LIMITED with retryAfter
    - **Rate limit — outside cooldown**: proceeds with refresh
    - **Concurrent deduplication**: second request waits for first (via lock)
    - **PROVIDER_NOT_FOUND**: unknown provider throws PROVIDER_NOT_FOUND
    - **Refresh returns null**: throws INTERNAL_ERROR

### Test Rules
- Tests expect REAL BEHAVIOR (actual RefreshCoordinator with injected dependencies)
- Use real `KeyringTokenStore` (in-memory or test-scoped) or carefully scoped fakes for token store operations
- Provider instances may use test doubles at the provider.refreshToken() boundary (HTTP-level, not service-level)
- NO testing for NotYetImplemented
- NO reverse tests (expect().not.toThrow())
- Each test has `@requirement` and `@scenario` comments
- Tests WILL FAIL naturally until implementation phase

### Required Test Pattern
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P19
 * @requirement R11.1
 * @scenario Refresh reads token, calls provider, merges, saves, returns sanitized
 * @given A stored token with refresh_token for provider "anthropic"
 * @when handleRefreshToken("anthropic", "default") is called
 * @then Returns sanitized token with new access_token, no refresh_token
 */
it('refreshes token and returns sanitized result without refresh_token', async () => {
  // ... test with real RefreshCoordinator
});
```

## Verification Commands

```bash
test -f packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts || echo "FAIL"

grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts && echo "FAIL: Mock theater"

grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts && echo "FAIL: Reverse testing"

grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts
# Expected: 18+ assertions
```

## Success Criteria
- 18–25 behavioral tests
- Tests fail naturally (stub not implemented)
- Zero mock theater or reverse testing
- All tests tagged with plan and requirement IDs
- Coverage spans R11, R12, R13, R14

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts`
2. Re-read pseudocode 006 and specification R11–R14

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P19.md`
