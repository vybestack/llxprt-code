# Phase 36a: Deprecation — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P36a`

## Prerequisites
- Required: Phase 36 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P36" packages/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P36` markers present
- [ ] All tests pass (including deprecation guard tests)
- [ ] TypeScript compiles
- [ ] Lint passes

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/cli/src/auth/proxy/ packages/core/src/auth/ | grep -v ".test.ts" | grep -v node_modules
```

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was deprecated/removed?
- Verify: FINAL grep for `new KeyringTokenStore` at consumer sites — paste output showing zero matches
- Verify: FINAL grep for direct `getProviderKeyStorage` at consumer sites — paste output showing zero matches
- Verify: `mergeRefreshedToken` has exactly ONE definition (in `token-merge.ts`)
- Verify: `OAuthManager` no longer has its own `mergeRefreshedToken` definition (imports from `token-merge.ts`)
- Verify: factory module has documentation noting it is the single entry point for credential stores
- Verify: deprecation guard tests exist and pass
- Non-regression: full test suite passes (paste summary)
- Non-regression: `npm run lint` passes
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
Create: `project-plans/issue1358_1359_1360/.completed/P36a.md`
