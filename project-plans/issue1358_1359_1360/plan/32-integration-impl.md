# Phase 32: Integration Implementation — Connect to Existing System

## Phase ID
`PLAN-20250214-CREDPROXY.P32`

## Prerequisites
- Required: Phase 31a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P31" packages/cli/src/auth/proxy/__tests__/`
- Expected files: `packages/cli/src/auth/proxy/__tests__/integration.test.ts` (tests written, failing)

## Requirements Implemented (Expanded)

### R2.3, R2.4: Factory Functions
(See Phase 30 for full requirement expansion)

### R9.5: ProviderKeyStorage Interface
(See Phase 30 for full requirement expansion)

### R25.1: Proxy Created Before Container
(See Phase 30 for full requirement expansion)

### R17.4: authCommand Proxy Dispatch
**Full Text**: While `LLXPRT_CREDENTIAL_SOCKET` is set, `/auth login` shall use `ProxyOAuthAdapter` instead of `OAuthManager.login()`.
**Behavior**:
- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is set
- WHEN: User runs `/auth login anthropic` inside the sandbox
- THEN: `authCommand.ts` detects proxy mode and dispatches to `ProxyOAuthAdapter.login()`
**Why This Matters**: Login must work transparently in sandbox mode.

### R16.8: Inner OAuthManager Skips Proactive Renewal
**Full Text**: While in proxy mode, the inner process's `OAuthManager` shall NOT schedule proactive renewal timers.
**Behavior**:
- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is set
- WHEN: `OAuthManager` would normally schedule proactive renewal
- THEN: It skips scheduling (host handles renewal)
**Why This Matters**: Prevents duplicate renewal attempts between host and inner.

## Implementation Tasks

### Files to Modify (UPDATE, not create new)
- `packages/cli/src/auth/proxy/credential-store-factory.ts` — UPDATE stub
  - Implement `createTokenStore()`: check `LLXPRT_CREDENTIAL_SOCKET`, return `ProxyTokenStore` or `KeyringTokenStore`
  - Implement `createProviderKeyStorage()`: check env var, return `ProxyProviderKeyStorage` or direct storage
  - Implement singleton caching (module-level variables)
  - MUST follow the factory pattern from technical-overview.md §2

- `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts` — UPDATE stub
  - Implement `createAndStartProxy(config)`: create `CredentialProxyServer`, generate socket path with nonce, start listening, return socket path
  - Implement `stopProxy()`: close server, remove socket file, cancel timers
  - Handle stale socket cleanup (R25.4)
  - Handle SIGINT/SIGTERM cleanup (R25.3)

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P32
 * @requirement R2.3, R2.4, R9.5, R16.8, R17.4, R25.1
 */
```

## Verification Commands

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/integration.test.ts
git diff packages/cli/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/credential-store-factory.ts packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/auth/proxy/credential-store-factory.ts packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
```

## Success Criteria
- All integration tests pass
- No test modifications
- Factory functions correctly detect proxy mode
- Lifecycle functions create/destroy proxy server and socket
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/credential-store-factory.ts packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`
2. Re-read technical-overview.md §2 and requirements R2, R25

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P32.md`
