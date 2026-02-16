# Phase 35a: Migration — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P35a`

## Prerequisites
- Required: Phase 35 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P35" packages/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P35` markers present
- [ ] All tests pass (including migration completeness tests)
- [ ] TypeScript compiles

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/token-merge.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/auth/token-merge.ts | grep -v ".test.ts"
```

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was migrated?
- Verify: ZERO remaining `new KeyringTokenStore()` at consumer sites (run the grep, paste output)
- Verify: ZERO remaining `getProviderKeyStorage()` calls at consumer sites (run the grep, paste output)
- Verify: `mergeRefreshedToken` is exported from `packages/core/src/auth/token-merge.ts`
- Verify: `OAuthManager` imports `mergeRefreshedToken` from `token-merge.ts` (not internal definition)
- Verify: `CredentialProxyServer` (or `RefreshCoordinator`) imports `mergeRefreshedToken` from `token-merge.ts`
- Verify: the extracted `mergeRefreshedToken` operates on `OAuthTokenWithExtras` (preserves provider-specific fields)
- Verify: token merge contract matches R12.1–R12.4 (access_token/expiry always new, refresh_token preserved if new is empty, scope/token_type/provider fields use new-if-present)
- Trace: non-sandbox `OAuthManager.refreshToken()` → calls `mergeRefreshedToken(stored, new)` → saves merged → behavior identical to pre-migration
- Trace: proxy `RefreshCoordinator.refresh()` → calls `mergeRefreshedToken(stored, new)` → saves merged → same merge contract
- Non-regression: run full test suite, paste test count/pass summary
- Verdict: PASS/FAIL


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
Create: `project-plans/issue1358_1359_1360/.completed/P35a.md`
