# Phase 36: Deprecation — Remove Direct KeyringTokenStore Instantiation at Consumer Sites

## Phase ID
`PLAN-20250214-CREDPROXY.P36`

## Prerequisites
- Required: Phase 35a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P35" packages/`
- Expected: All consumer sites migrated to factory functions, mergeRefreshedToken extracted

## Requirements Implemented (Expanded)

### R2.3 (final enforcement): No Bypass of Factory
**Full Text**: Calling code shall not know whether it is using a proxy or a direct store.
**Behavior**:
- GIVEN: All consumer sites now use factory functions
- WHEN: A developer adds a new `new KeyringTokenStore()` call at a consumer site
- THEN: A lint rule, test, or code review catches it
**Why This Matters**: Factory bypass re-introduces the bug — sandbox mode silently fails to use proxy.

### R26.1 (final verification): Non-Sandbox Unchanged
**Full Text**: Non-sandbox mode shall be completely unaffected. All credential operations use direct keyring access exactly as before Phase B.
**Behavior**:
- GIVEN: `LLXPRT_CREDENTIAL_SOCKET` is NOT set
- WHEN: Full application starts and performs auth operations
- THEN: Behavior is byte-for-byte identical to pre-Phase-B
**Why This Matters**: Regression in non-sandbox mode would break all existing users.

## Implementation Tasks

### Deprecation Actions

1. **Add guard against direct instantiation re-introduction**
   - Add a comment/documentation in `KeyringTokenStore` class noting that consumer code should use `createTokenStore()`, not `new KeyringTokenStore()` directly
   - Optionally add a grep-based lint check in CI that fails on direct `new KeyringTokenStore()` at consumer sites
   - MUST include: `@plan:PLAN-20250214-CREDPROXY.P36`

2. **Remove any old helper functions that are now superseded**
   - If `getProviderKeyStorage()` was a standalone helper, evaluate whether it should be deprecated in favor of `createProviderKeyStorage()`
   - Update any imports that referenced the old helper
   - MUST include: `@plan:PLAN-20250214-CREDPROXY.P36`

3. **Update internal documentation / developer notes**
   - Document the factory pattern in code comments at the factory module
   - Note that `KeyringTokenStore` is an implementation detail, not a public consumer API
   - MUST include: `@plan:PLAN-20250214-CREDPROXY.P36`

4. **Clean up old mergeRefreshedToken reference**
   - If the original `mergeRefreshedToken` was a private method in `OAuthManager`, verify the old definition is fully removed (replaced by import)
   - MUST include: `@plan:PLAN-20250214-CREDPROXY.P36`

### Files to Create
- `packages/cli/src/auth/proxy/__tests__/deprecation-guard.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P36`
  - Tests:
    - **No direct KeyringTokenStore at consumers (final sweep)**: file-system scan confirms zero matches
    - **No direct getProviderKeyStorage at consumers (final sweep)**: file-system scan confirms zero matches
    - **mergeRefreshedToken not duplicated**: only one definition exists (in token-merge.ts)
    - **Factory module is the single entry point**: all TokenStore usage goes through factory

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P36
 * @requirement R2.3, R26.1
 */
```

## Verification Commands

```bash
# FINAL SWEEP: absolutely zero direct instantiation at consumer sites
grep -rn "new KeyringTokenStore" packages/cli/src/ --include="*.ts" | grep -v "credential-store-factory" | grep -v "__tests__" | grep -v "node_modules" | grep -v "proxy/"
# Expected: ZERO matches

# Verify old mergeRefreshedToken is not duplicated
grep -rn "function mergeRefreshedToken\|mergeRefreshedToken =" packages/ --include="*.ts" | grep -v "node_modules" | grep -v "__tests__"
# Expected: exactly 1 definition (in token-merge.ts)

npm test
npm run typecheck
npm run lint
```

## Success Criteria
- Zero direct `new KeyringTokenStore()` at consumer sites (absolute — no exceptions)
- Old `mergeRefreshedToken` definition removed from `OAuthManager` (replaced by import)
- Deprecation guard tests pass
- All existing tests pass
- Lint passes
- TypeScript compiles cleanly

## Failure Recovery
1. `git stash`
2. Re-run migration grep to find remaining sites

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P36.md`
