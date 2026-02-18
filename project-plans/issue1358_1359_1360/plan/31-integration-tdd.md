# Phase 31: Integration TDD — End-to-End Proxy Tests

## Phase ID
`PLAN-20250214-CREDPROXY.P31`

## Prerequisites
- Required: Phase 30a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P30" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/credential-store-factory.ts`, `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts` (stubs)

## Requirements Implemented (Expanded)

### R2.1–R2.3: Proxy Mode Detection End-to-End
**Behavior**:
- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is set to a valid socket path
- WHEN: `createTokenStore()` is called
- THEN: Returns a `ProxyTokenStore` that communicates via the socket
- AND: `getToken()` returns sanitized tokens (no `refresh_token`)

- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is NOT set
- WHEN: `createTokenStore()` is called
- THEN: Returns a `KeyringTokenStore` (direct access)

### R2.4: Singleton Instances
**Behavior**:
- GIVEN: Multiple call sites invoke `createTokenStore()`
- WHEN: Each invocation completes
- THEN: All return the same instance (referential equality)

### R25.1–R25.3: Proxy Lifecycle End-to-End
**Behavior**:
- GIVEN: `createAndStartProxy(config)` is called with valid config
- WHEN: The proxy starts successfully
- THEN: A Unix socket is created and listening at the returned path
- AND: The socket path contains a cryptographic nonce
- AND: `stopProxy()` removes the socket file and cleans up resources

### R10.1: Token Sanitization End-to-End
**Behavior**:
- GIVEN: A token with `refresh_token` is stored in `KeyringTokenStore` on the host side
- WHEN: `ProxyTokenStore.getToken()` retrieves it via the proxy
- THEN: The returned token has `access_token`, `expiry`, `token_type` but NO `refresh_token`

### R8.1–R8.6: Full TokenStore Interface via Proxy
**Behavior**:
- GIVEN: Proxy is running, inner process has `ProxyTokenStore`
- WHEN: `saveToken`, `getToken`, `removeToken`, `listProviders`, `listBuckets` are called
- THEN: Each operation round-trips through the socket and produces correct results

### R9.1–R9.4: Full ProviderKeyStorage Interface via Proxy
**Behavior**:
- GIVEN: Proxy is running, inner process has `ProxyProviderKeyStorage`
- WHEN: `getKey`, `listKeys`, `hasKey` are called
- THEN: Operations round-trip through the socket correctly
- WHEN: `saveKey` or `deleteKey` is called
- THEN: Throws "API key management is not available in sandbox mode"

### R17.4: Login via Proxy End-to-End
**Behavior**:
- GIVEN: Proxy is running with a configured provider
- WHEN: `ProxyOAuthAdapter.login("anthropic")` is called
- THEN: `oauth_initiate` → flow-type dispatch → exchange/poll → sanitized token returned
- AND: Token stored in host-side `KeyringTokenStore` with `refresh_token`
- AND: Inner side receives token WITHOUT `refresh_token`

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/integration.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P31`
  - 20–25 behavioral integration tests covering:
    - **Factory detection — proxy mode**: `createTokenStore()` returns `ProxyTokenStore` when env var set
    - **Factory detection — direct mode**: `createTokenStore()` returns `KeyringTokenStore` when env var unset
    - **Factory singleton**: repeated calls return same instance
    - **Factory key storage — proxy mode**: `createProviderKeyStorage()` returns `ProxyProviderKeyStorage`
    - **Proxy lifecycle — start**: `createAndStartProxy()` creates listening socket
    - **Proxy lifecycle — stop**: `stopProxy()` removes socket and cleans up
    - **Proxy lifecycle — stale socket cleanup**: removes pre-existing socket file
    - **Token round-trip — getToken**: host stores token with refresh_token, inner receives sanitized
    - **Token round-trip — saveToken**: inner saves token, host stores (refresh_token stripped)
    - **Token round-trip — removeToken**: inner removes, host deletes
    - **Token round-trip — listProviders**: returns provider list from host store
    - **Token round-trip — listBuckets**: returns bucket list from host store
    - **Token round-trip — getBucketStats**: returns placeholder stats or null
    - **API key round-trip — getKey**: inner reads key from host storage
    - **API key round-trip — listKeys**: inner lists keys from host storage
    - **API key round-trip — hasKey**: returns true/false based on host storage
    - **API key round-trip — saveKey throws**: throws in proxy mode
    - **API key round-trip — deleteKey throws**: throws in proxy mode
    - **Login end-to-end — PKCE redirect**: initiate → exchange → sanitized token
    - **Login end-to-end — device code**: initiate → poll pending → poll complete → sanitized token
    - **Refresh end-to-end**: refresh request → host refreshes → sanitized token returned
    - **Profile scoping**: request for unauthorized provider returns UNAUTHORIZED
    - **Connection loss**: socket close surfaces hard error to inner
    - **Sanitization invariant**: no response from proxy ever contains refresh_token

### Test Architecture
- Tests create a REAL `CredentialProxyServer` and REAL `ProxyTokenStore`/`ProxyProviderKeyStorage` connected via a local Unix socket
- The host-side `KeyringTokenStore` can be a test double at the storage level (in-memory `TokenStore`)
- Provider OAuth flows are test-doubled at the HTTP/provider boundary, NOT at the service level
- Tests verify the FULL data path: inner API → socket → proxy server → host store → response → socket → inner result
- `vi.useFakeTimers()` for proactive renewal timing tests

### Test Rules
- NO testing for NotYetImplemented
- NO reverse tests
- Each test has `@requirement` and `@scenario` comments
- Tests exercise REAL components across REAL socket connections
- Only test doubles are at the outermost boundaries (storage backend, HTTP calls)

## Verification Commands

```bash
test -f packages/cli/src/auth/proxy/__tests__/integration.test.ts || echo "FAIL"

grep -r "toHaveBeenCalled\b" packages/cli/src/auth/proxy/__tests__/integration.test.ts && echo "FAIL: Mock theater"

grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/cli/src/auth/proxy/__tests__/integration.test.ts && echo "FAIL: Reverse testing"

grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/cli/src/auth/proxy/__tests__/integration.test.ts
# Expected: 20+ assertions
```

## Success Criteria
- 20–25 behavioral integration tests
- Tests fail naturally (stubs not implemented)
- Tests exercise real socket connections end-to-end
- Zero mock theater or reverse testing
- Coverage spans R2, R8, R9, R10, R17, R25

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/__tests__/integration.test.ts`
2. Re-read overview.md Integration Analysis section and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P31.md`
