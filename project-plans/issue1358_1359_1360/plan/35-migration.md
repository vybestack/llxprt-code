# Phase 35: Migration — Instantiation Sites → Factory Functions

## Phase ID
`PLAN-20250214-CREDPROXY.P35`

## Prerequisites
- Required: Phase 34a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P34" packages/cli/src/`
- Expected: `sandbox.ts` wired, factory functions implemented, all consumer sites updated

## Requirements Implemented (Expanded)

### R2.3: All Instantiation Sites Use Factories
**Full Text**: The detection logic shall be centralized in factory functions. Calling code shall not know whether it is using a proxy or a direct store.
**Behavior**:
- GIVEN: The codebase previously had 5+ sites calling `new KeyringTokenStore()` directly
- WHEN: Migration is complete
- THEN: ALL sites use `createTokenStore()` — zero direct `KeyringTokenStore` instantiation at consumer sites
**Why This Matters**: Any site that bypasses the factory creates a proxy-blind code path that fails silently in sandbox mode.

### R12.5: mergeRefreshedToken Extraction
**Full Text**: The merge logic shall be extracted to a shared utility in `packages/core/src/auth/`. Both `OAuthManager` and `CredentialProxyServer` shall import it from there.
**Behavior**:
- GIVEN: `mergeRefreshedToken` currently lives inside `OAuthManager`
- WHEN: Migration is complete
- THEN: It is exported from `packages/core/src/auth/token-merge.ts` and imported by both `OAuthManager` and `CredentialProxyServer`
**Why This Matters**: Token merge contract must be consistent between direct mode and proxy mode.

### R26.1: Non-Sandbox Unaffected
**Full Text**: Non-sandbox mode shall be completely unaffected.
**Behavior**:
- GIVEN: No `LLXPRT_CREDENTIAL_SOCKET` env var set
- WHEN: Any credential operation runs
- THEN: Behavior is identical to pre-Phase-B code
**Why This Matters**: This is a non-regression requirement — existing users must not be affected.

## Implementation Tasks

### Sweep and Verify All Instantiation Sites
Perform a comprehensive grep to find ANY remaining direct instantiation:

```bash
# Find all remaining direct KeyringTokenStore usage at consumer sites
grep -rn "new KeyringTokenStore" packages/cli/src/ --include="*.ts" | grep -v "credential-store-factory" | grep -v "__tests__" | grep -v "node_modules"

# Find all remaining direct getProviderKeyStorage usage at consumer sites
grep -rn "getProviderKeyStorage\b" packages/cli/src/ --include="*.ts" | grep -v "credential-store-factory" | grep -v "__tests__" | grep -v "node_modules"
```

### Files to Modify (UPDATE existing files)
- Any remaining files found by the grep above — migrate to factory pattern
- MUST include: `@plan:PLAN-20250214-CREDPROXY.P35`

- `packages/core/src/auth/token-merge.ts` (if not already extracted in earlier phases)
  - Extract `mergeRefreshedToken()` from `OAuthManager` to shared utility
  - Preserve `OAuthTokenWithExtras` type handling
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P35`
  - MUST include: `@requirement:R12.5`

- `packages/cli/src/auth/oauth-manager.ts`
  - Update to import `mergeRefreshedToken` from `token-merge.ts` instead of internal definition
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P35`

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/migration-completeness.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P35`
  - Tests:
    - **No direct KeyringTokenStore at consumers**: grep-based or import-analysis test
    - **No direct getProviderKeyStorage at consumers**: grep-based or import-analysis test
    - **mergeRefreshedToken shared**: both OAuthManager and CredentialProxyServer import from same source
    - **Non-sandbox mode unchanged**: verify `createTokenStore()` returns `KeyringTokenStore` when env unset
    - **Token merge contract consistent**: same function used in both direct and proxy paths

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P35
 * @requirement R2.3, R12.5, R26.1
 */
```

## Verification Commands

```bash
# CRITICAL: Verify zero direct instantiation at consumer sites
grep -rn "new KeyringTokenStore" packages/cli/src/ --include="*.ts" | grep -v "credential-store-factory" | grep -v "__tests__" | grep -v "node_modules" | grep -v "proxy"
# Expected: ZERO matches

grep -rn "getProviderKeyStorage\b" packages/cli/src/ --include="*.ts" | grep -v "credential-store-factory" | grep -v "__tests__" | grep -v "node_modules" | grep -v "proxy"
# Expected: ZERO matches (at consumer sites)

# Verify mergeRefreshedToken is shared
grep -rn "mergeRefreshedToken" packages/core/src/auth/token-merge.ts packages/cli/src/auth/oauth-manager.ts packages/cli/src/auth/proxy/
# Expected: exported from token-merge.ts, imported in oauth-manager.ts and proxy server

npm test
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/token-merge.ts | grep -v ".test.ts"
```

## Success Criteria
- ZERO direct `new KeyringTokenStore()` at consumer call sites
- ZERO direct `getProviderKeyStorage()` at consumer call sites
- `mergeRefreshedToken` extracted to shared utility and imported by both `OAuthManager` and proxy server
- All existing tests pass (non-regression)
- TypeScript compiles cleanly

## Failure Recovery
1. `git stash`
2. Re-read technical-overview.md §2 (Current Instantiation Sites) and retry

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P35.md`
