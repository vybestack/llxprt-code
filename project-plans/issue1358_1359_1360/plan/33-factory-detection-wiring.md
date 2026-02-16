# Phase 33: Factory Function + Detection Wiring

## Phase ID
`PLAN-20250214-CREDPROXY.P33`

## Prerequisites
- Required: Phase 32a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P32" packages/cli/src/auth/proxy/`
- Expected files: `packages/cli/src/auth/proxy/credential-store-factory.ts` (implemented), integration tests passing

## Requirements Implemented (Expanded)

### R2.3: Factory Functions at Instantiation Sites
**Full Text**: Calling code (`OAuthManager`, auth commands, key commands) shall not know whether it is using a proxy or a direct store.
**Behavior**:
- GIVEN: `authCommand.ts` currently calls `new KeyringTokenStore()`
- WHEN: Updated to call `createTokenStore()`
- THEN: Gets the correct implementation transparently (proxy or direct)
**Why This Matters**: Existing consumer code becomes proxy-aware without knowing it.

### R17.4: authCommand Proxy Dispatch
**Full Text**: While `LLXPRT_CREDENTIAL_SOCKET` is set, `/auth login` shall use `ProxyOAuthAdapter`.
**Behavior**:
- GIVEN: User runs `/auth login anthropic` in sandbox
- WHEN: `authCommand.ts` detects `LLXPRT_CREDENTIAL_SOCKET`
- THEN: Dispatches to `ProxyOAuthAdapter.login()` instead of `OAuthManager.login()`
**Why This Matters**: Login flow must work via proxy without changing the user experience.

### R16.8: OAuthManager Skips Proactive Renewal in Proxy Mode
**Full Text**: While in proxy mode, `OAuthManager` shall NOT schedule proactive renewal timers.
**Behavior**:
- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is set
- WHEN: `OAuthManager` would normally call `scheduleProactiveRenewal()`
- THEN: It checks for proxy mode and skips scheduling
**Why This Matters**: Host handles renewal; inner scheduling would generate wasteful RPC.

## Implementation Tasks

### Files to Modify (UPDATE existing files)
- `packages/cli/src/ui/commands/authCommand.ts`
  - Replace `new KeyringTokenStore()` with `createTokenStore()`
  - Add proxy mode detection for `/auth login`: if `LLXPRT_CREDENTIAL_SOCKET` set, use `ProxyOAuthAdapter`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`
  - MUST include: `@requirement:R17.4`

- `packages/cli/src/providers/providerManagerInstance.ts`
  - Replace `new KeyringTokenStore()` with `createTokenStore()`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`

- `packages/cli/src/runtime/runtimeContextFactory.ts`
  - Replace `new KeyringTokenStore()` with `createTokenStore()`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`

- `packages/cli/src/ui/commands/profileCommand.ts`
  - Replace `new KeyringTokenStore()` with `createTokenStore()`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`

- `packages/cli/src/ui/commands/keyCommand.ts`
  - Replace `getProviderKeyStorage()` with `createProviderKeyStorage()`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`

- `packages/cli/src/auth/oauth-manager.ts` (or equivalent)
  - Add proxy mode check before `scheduleProactiveRenewal()`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`
  - MUST include: `@requirement:R16.8`

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/factory-detection-wiring.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P33`
  - Tests that verify wiring correctness:
    - **authCommand uses factory**: imports `createTokenStore`, not `KeyringTokenStore` directly
    - **providerManagerInstance uses factory**: verified via import analysis or runtime check
    - **runtimeContextFactory uses factory**: verified via import analysis or runtime check
    - **profileCommand uses factory**: verified via import analysis or runtime check
    - **keyCommand uses factory**: uses `createProviderKeyStorage`
    - **authCommand dispatches to ProxyOAuthAdapter in proxy mode**: when env var set
    - **authCommand dispatches to OAuthManager in non-proxy mode**: when env var unset
    - **OAuthManager skips proactive renewal in proxy mode**: env var check prevents scheduling

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P33
 * @requirement R2.3, R16.8, R17.4
 */
```

## Verification Commands

```bash
# Verify no direct KeyringTokenStore instantiation in consumer files
grep -n "new KeyringTokenStore" packages/cli/src/ui/commands/authCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/profileCommand.ts
# Expected: NO matches (all replaced with factory)

# Verify factory imports
grep -n "createTokenStore\|createProviderKeyStorage" packages/cli/src/ui/commands/authCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/profileCommand.ts packages/cli/src/ui/commands/keyCommand.ts
# Expected: matches in all files

npm test -- packages/cli/src/auth/proxy/__tests__/factory-detection-wiring.test.ts
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/ui/commands/authCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/profileCommand.ts packages/cli/src/ui/commands/keyCommand.ts | grep -v ".test.ts" | grep -v node_modules
```

## Success Criteria
- Zero direct `new KeyringTokenStore()` at consumer sites (replaced with `createTokenStore()`)
- Zero direct `getProviderKeyStorage()` at consumer sites (replaced with `createProviderKeyStorage()`)
- `authCommand.ts` detects proxy mode and dispatches to `ProxyOAuthAdapter`
- `OAuthManager` skips proactive renewal in proxy mode
- All existing tests continue to pass (non-proxy mode unaffected)
- All new wiring tests pass
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/cli/src/ui/commands/ packages/cli/src/providers/ packages/cli/src/runtime/ packages/cli/src/auth/`
2. Re-read technical-overview.md §2 (Detection and Instantiation) and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P33.md`
