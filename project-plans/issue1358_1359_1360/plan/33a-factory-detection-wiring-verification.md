# Phase 33a: Factory Function + Detection Wiring — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P33a`

## Prerequisites
- Required: Phase 33 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P33" packages/cli/src/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P33` markers present in modified files
- [ ] All tests pass (existing + new wiring tests)
- [ ] TypeScript compiles

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/ui/commands/authCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/profileCommand.ts packages/cli/src/ui/commands/keyCommand.ts | grep -v ".test.ts"
```

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was changed?
- Verify: `authCommand.ts` no longer imports/uses `new KeyringTokenStore()` — uses `createTokenStore()`
- Verify: `providerManagerInstance.ts` no longer imports/uses `new KeyringTokenStore()` — uses `createTokenStore()`
- Verify: `runtimeContextFactory.ts` no longer imports/uses `new KeyringTokenStore()` — uses `createTokenStore()`
- Verify: `profileCommand.ts` no longer imports/uses `new KeyringTokenStore()` — uses `createTokenStore()`
- Verify: `keyCommand.ts` no longer imports/uses `getProviderKeyStorage()` directly — uses `createProviderKeyStorage()`
- Verify: `authCommand.ts` checks `process.env.LLXPRT_CREDENTIAL_SOCKET` and dispatches to `ProxyOAuthAdapter.login()` when set
- Verify: `authCommand.ts` still uses `OAuthManager.login()` when env var is NOT set (non-regression R26.1)
- Verify: `OAuthManager` checks for proxy mode before scheduling proactive renewal (R16.8)
- Verify: all existing tests pass (non-proxy paths unaffected)
- Trace: non-sandbox startup → `createTokenStore()` → env var absent → `KeyringTokenStore` → existing behavior unchanged
- Trace: sandbox startup → `createTokenStore()` → env var present → `ProxyTokenStore` → operations go through socket
- Verdict: PASS/FAIL

## Non-Regression Check
```bash
# Verify existing test suites still pass
npm test -- packages/cli/src/ui/commands/__tests__/
npm test -- packages/cli/src/providers/__tests__/
npm test -- packages/cli/src/runtime/__tests__/
```


## Anti-Fake / Anti-Fraud Verification (MANDATORY)
- [ ] No test-environment branching in production code (for example: NODE_ENV checks, JEST_WORKER_ID, VITEST, process.env.TEST, isTest guards) unless explicitly required by specification.
- [ ] No fixture-hardcoded behavior in production code for known test values, providers, buckets, or session IDs.
- [ ] No mock theater: tests verify semantic outputs, state transitions, or externally visible side effects; not only call counts.
- [ ] No structure-only assertions as sole proof (toHaveProperty/toBeDefined without value-level behavior assertions).
- [ ] No deferred implementation artifacts in non-stub phases (TODO/FIXME/HACK/placeholder/NotYetImplemented/empty return shortcuts).
- [ ] Security invariants are actively checked where relevant: refresh_token and auth artifacts are never returned across proxy boundaries or logged in full.
- [ ] Failure-path assertions exist (invalid request, unauthorized, timeout, rate limit, session errors) to prevent happy-path-only implementations from passing.

### Anti-Fraud Command Checks
- Run: grep -rn -E "(NODE_ENV|JEST_WORKER_ID|VITEST|process\.env\.TEST|isTest\()" packages --include="*.ts" | grep -v ".test.ts"
- Run: grep -rn -E "(toHaveBeenCalled|toHaveBeenCalledWith)" [phase-test-files]
- Run: grep -rn -E "(toHaveProperty|toBeDefined|toBeUndefined)" [phase-test-files]
- Run: grep -rn -E "(TODO|FIXME|HACK|placeholder|NotYetImplemented|return \[\]|return \{\}|return null|return undefined)" [phase-impl-files] | grep -v ".test.ts"
- Run: grep -rn "refresh_token" packages/cli/src/auth/proxy packages/core/src/auth --include="*.ts" | grep -v ".test.ts"

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P33a.md`
