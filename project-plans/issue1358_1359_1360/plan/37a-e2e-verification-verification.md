# Phase 37a: E2E Verification — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P37a`

## Prerequisites
- Required: Phase 37 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P37" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/e2e-credential-flow.test.ts` exists
- [ ] `@plan:PLAN-20250214-CREDPROXY.P37` markers present
- [ ] All E2E tests pass
- [ ] TypeScript compiles

## Semantic Verification — E2E Completeness
- [ ] **Token lifecycle tested**: save → get (sanitized) → remove → verify empty
- [ ] **PKCE redirect login tested**: initiate → exchange → sanitized token returned, host has refresh_token
- [ ] **Device code login tested**: initiate → poll pending → poll complete → sanitized token
- [ ] **Token refresh tested**: expired token → refresh request → new sanitized token
- [ ] **Proactive renewal tested**: near-expiry token → scheduled renewal fires → new token
- [ ] **Profile scoping tested**: allowed provider succeeds, disallowed provider rejected
- [ ] **Connection loss tested**: proxy killed → hard error surfaces to inner
- [ ] **Concurrent operations tested**: multiple requests handled correctly
- [ ] **Non-sandbox mode tested**: env var absent → KeyringTokenStore, normal behavior

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- Do the E2E tests exercise REAL components? (Not mocked proxies or mocked sockets)
- Do tests verify the FULL data path from inner API call through socket to host store and back?
- Is the sanitization invariant tested in EVERY scenario? (No response ever contains `refresh_token`)
- Are error paths tested? (connection loss, unauthorized provider, rate limiting)
- Would these tests catch a regression if a component was broken?
- Coverage gap analysis: are there any acceptance criteria from issues #1358, #1359, #1360 NOT covered by these E2E tests?
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
Create: `project-plans/issue1358_1359_1360/.completed/P37a.md`
