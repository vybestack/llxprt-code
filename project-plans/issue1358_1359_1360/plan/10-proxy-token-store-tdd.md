# Phase 10: ProxyTokenStore — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P10`

## Prerequisites
- Required: Phase 09a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P09" packages/core/src/auth/proxy/`
- Expected files: `packages/core/src/auth/proxy/proxy-token-store.ts`

## Requirements Implemented (Expanded)

### R8.1: getToken Sends get_token
**Behavior**:
- GIVEN: A connected ProxyTokenStore
- WHEN: `getToken("anthropic", "default")` is called
- THEN: Sends framed `{op: "get_token", payload: {provider: "anthropic", bucket: "default"}}` and returns the response token
**Why This Matters**: Transparent proxying of token reads.

### R8.2: saveToken Sends save_token
**Behavior**:
- GIVEN: A token `{ access_token: "at", expiry: 1234 }`
- WHEN: `saveToken("anthropic", token, "default")` is called
- THEN: Sends framed `{op: "save_token", payload: {provider: "anthropic", bucket: "default", token}}` and returns void
**Why This Matters**: Token writes must be forwarded to the host.

### R8.7: getBucketStats Uses get_token Round-Trip
**Behavior**:
- GIVEN: A stored token for provider "anthropic", bucket "default"
- WHEN: `getBucketStats("anthropic", "default")` is called
- THEN: Returns `{ bucket: "default", requestCount: 0, percentage: 0, lastUsed: undefined }` (placeholder)
**Why This Matters**: Maintains interface compatibility with `KeyringTokenStore`.

### R23.3: Error Translation
**Behavior**:
- GIVEN: Proxy returns `{ ok: false, code: "NOT_FOUND" }` for get_token
- WHEN: ProxyTokenStore processes the response
- THEN: Returns `null` (not throws)
**Why This Matters**: Callers expect `null` for missing tokens, not exceptions.

### R29.3: Connection Loss
**Behavior**:
- GIVEN: The proxy socket connection is lost
- WHEN: Any operation is attempted
- THEN: Throws "Credential proxy connection lost. Restart the session."
**Why This Matters**: No silent failures — user must know the proxy is unavailable.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P10`
  - 15–20 behavioral tests covering:
    - getToken sends correct operation and returns token data
    - getToken returns null when proxy returns NOT_FOUND
    - saveToken sends correct operation with token payload
    - removeToken sends correct operation
    - listProviders returns string array from proxy
    - listBuckets returns string array from proxy
    - getBucketStats returns placeholder stats on success
    - getBucketStats returns null on NOT_FOUND
    - acquireRefreshLock always returns true (no-op)
    - releaseRefreshLock is a no-op (returns void)
    - Connection loss throws with correct message
    - UNAUTHORIZED error throws
    - INTERNAL_ERROR throws
    - RATE_LIMITED error includes retryAfter metadata
    - Lazy connection on first operation

## Verification Commands

```bash
test -f packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts || echo "FAIL"
grep -r "toHaveBeenCalled\b" packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts && echo "FAIL: Mock theater"
grep -r "toThrow.*NotYetImplemented" packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts && echo "FAIL: Reverse testing"
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(" packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts
# Expected: 15+ assertions
```

## Success Criteria
- 15–20 behavioral tests
- Tests fail naturally until implementation
- No mock theater or reverse testing

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts`
2. Re-read pseudocode 003

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P10.md`
