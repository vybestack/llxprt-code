# Phase 09: ProxyTokenStore — Stub

## Phase ID
`PLAN-20250214-CREDPROXY.P09`

## Prerequisites
- Required: Phase 08a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P08" packages/core/src/auth/`
- Expected files from previous phase: `token-sanitization.ts`, `token-merge.ts` (fully implemented)
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R2.1: Proxy Mode Detection
**Full Text**: While `LLXPRT_CREDENTIAL_SOCKET` is set, the system shall use `ProxyTokenStore` and `ProxyProviderKeyStorage` for all credential operations, routing them through the Unix socket.
**Behavior**:
- GIVEN: Environment variable `LLXPRT_CREDENTIAL_SOCKET` is set to a socket path
- WHEN: `createTokenStore()` is called
- THEN: Returns a `ProxyTokenStore` instance connected to the specified socket
**Why This Matters**: The detection mechanism is the entry point that routes all credential operations through the proxy vs direct keyring access.

### R8.1–R8.9: Token Operations via Proxy
**Full Text**: `ProxyTokenStore` implements `TokenStore` interface. `getToken` sends `get_token`, `saveToken` sends `save_token`, `removeToken` sends `remove_token`, `listProviders`/`listBuckets` send list operations, `getBucketStats` uses `get_token` round-trip, `acquireRefreshLock`/`releaseRefreshLock` are no-ops.
**Behavior**:
- GIVEN: A `ProxyTokenStore` connected to the proxy socket
- WHEN: `getToken("anthropic", "default")` is called
- THEN: Sends `{op: "get_token", payload: {provider: "anthropic", bucket: "default"}}` and returns sanitized token
**Why This Matters**: The inner process programs against the same `TokenStore` interface — transparent proxying.

### R23.3: Error Translation
**Full Text**: `ProxyTokenStore` shall translate proxy error codes to match `KeyringTokenStore` error semantics.
**Behavior**:
- GIVEN: Proxy returns `NOT_FOUND` for `get_token`
- WHEN: `ProxyTokenStore.getToken()` processes the response
- THEN: Returns `null` (matching `KeyringTokenStore` semantics)
**Why This Matters**: Callers should not need to know whether they're using a proxy or direct store.

### R29.1–R29.4: Connection Management
**Full Text**: Lazy connection, single persistent connection, no auto-reconnect on error, idle timeout reconnect.
**Behavior**:
- GIVEN: A `ProxyTokenStore` that has not yet connected
- WHEN: The first operation is called
- THEN: Connection and handshake occur lazily before the operation
**Why This Matters**: Avoids connecting to the socket at startup when it may not be needed.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/proxy-token-store.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P09`
  - Implements: `TokenStore` interface
  - Methods: `saveToken`, `getToken`, `removeToken`, `listProviders`, `listBuckets`, `getBucketStats`, `acquireRefreshLock`, `releaseRefreshLock`
  - All methods throw `new Error('NotYetImplemented')` except `acquireRefreshLock` (returns `true`) and `releaseRefreshLock` (no-op)
  - Maximum 50 lines

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P09
 * @requirement R2.1, R8.1-R8.9, R23.3, R29.1-R29.4
 * @pseudocode analysis/pseudocode/003-proxy-token-store.md
 */
```

## Verification Commands

```bash
test -f packages/core/src/auth/proxy/proxy-token-store.ts || echo "FAIL"
grep -r "@plan:PLAN-20250214-CREDPROXY.P09" packages/core/src/auth/proxy/ | wc -l
npm run typecheck
```

## Success Criteria
- File created with proper plan markers
- Implements `TokenStore` interface
- TypeScript compiles cleanly
- Lock methods return correct stub values

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/proxy-token-store.ts`
2. Re-read pseudocode 003 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P09.md`
