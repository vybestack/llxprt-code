# Phase 30: Integration Stub — Wire into Existing System

## Phase ID
`PLAN-20250214-CREDPROXY.P30`

## Prerequisites
- Required: Phase 29a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P29" packages/cli/src/auth/proxy/`
- Expected files: All component implementations (P03–P29) complete
- Preflight verification: Phase 00a MUST be completed

## Requirements Implemented (Expanded)

### R2.3: Factory Functions for Detection
**Full Text**: The detection logic shall be centralized in factory functions (`createTokenStore`, `createProviderKeyStorage`). Calling code shall not know whether it is using a proxy or a direct store.
**Behavior**:
- GIVEN: The process starts with `LLXPRT_CREDENTIAL_SOCKET` set or unset
- WHEN: `createTokenStore()` is called
- THEN: Returns `ProxyTokenStore` (if set) or `KeyringTokenStore` (if unset)
**Why This Matters**: Consumers don't need to care about proxy mode; detection is centralized.

### R2.4: Singleton Factory Instances
**Full Text**: The factory functions shall be called once per process. The returned instances shall be shared across all callers.
**Behavior**:
- GIVEN: Multiple call sites request a token store
- WHEN: `createTokenStore()` is called from each
- THEN: All callers receive the same instance
**Why This Matters**: Prevents multiple socket connections and inconsistent state.

### R9.5: ProviderKeyStorage Interface Extraction
**Full Text**: A `ProviderKeyStorageInterface` shall be extracted (or TypeScript structural typing used) so `ProxyProviderKeyStorage` is substitutable at instantiation sites.
**Behavior**:
- GIVEN: `keyCommand.ts` calls `createProviderKeyStorage()`
- WHEN: In proxy mode
- THEN: Returns `ProxyProviderKeyStorage` which is structurally compatible with existing usage
**Why This Matters**: `ProxyProviderKeyStorage` must be a drop-in substitute at all call sites.

### R25.1: Proxy Server Created Before Container
**Full Text**: When `start_sandbox()` is called, the `CredentialProxyServer` shall be created and begin listening BEFORE the container is spawned.
**Behavior**:
- GIVEN: User starts a sandbox session
- WHEN: `start_sandbox()` runs
- THEN: `CredentialProxyServer` is created, socket is listening, env var is set in container args
**Why This Matters**: Container must connect to the proxy immediately on startup.

## Implementation Tasks

### Files to Create
- `packages/cli/src/auth/proxy/credential-store-factory.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P30`
  - Exports: `createTokenStore()`, `createProviderKeyStorage()`
  - Detects `LLXPRT_CREDENTIAL_SOCKET` env var
  - Returns proxy implementations or direct implementations
  - Singleton pattern (module-level cache)
  - All methods throw `new Error('NotYetImplemented')`
  - Maximum 40 lines (stub)

- `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P30`
  - Exports: `createAndStartProxy(config)`, `stopProxy()`
  - Encapsulates `CredentialProxyServer` creation, socket setup, and env var generation
  - Integration point for `sandbox.ts` to call
  - All methods throw `new Error('NotYetImplemented')`
  - Maximum 30 lines (stub)

### Files to Modify
None — this is a stub phase. Wiring into existing files happens in P32.

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P30
 * @requirement R2.3, R2.4, R9.5, R25.1
 */
```

## Verification Commands

### Automated Checks
```bash
test -f packages/cli/src/auth/proxy/credential-store-factory.ts || echo "FAIL: credential-store-factory.ts missing"
test -f packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts || echo "FAIL: sandbox-proxy-lifecycle.ts missing"

grep -r "@plan:PLAN-20250214-CREDPROXY.P30" packages/cli/src/auth/proxy/ | wc -l
# Expected: 2+ occurrences

find packages/ -name "*credential-store-factory*V2*" -o -name "*sandbox-proxy-lifecycle*New*"
# Expected: no results

npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/cli/src/auth/proxy/credential-store-factory.ts packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts | grep -v ".test.ts"
# Expected: Only NotYetImplemented throws (acceptable in stub phase)
```

### Semantic Verification Checklist
1. **Do the stubs compile?** `npm run typecheck`
2. **Are exports correct?** `createTokenStore`, `createProviderKeyStorage`, `createAndStartProxy`, `stopProxy` exported
3. **No parallel versions?** No `*V2.ts` or `*New.ts` files

## Success Criteria
- Files created with proper plan markers
- TypeScript compiles cleanly
- Factory functions accept no args (detection is internal)
- Lifecycle functions accept appropriate config types
- All public functions exist as stubs

## Failure Recovery
1. `git checkout -- packages/cli/src/auth/proxy/credential-store-factory.ts packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts`
2. Re-read requirements R2 and R25 and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P30.md`
