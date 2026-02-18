# Phase 10a: ProxyTokenStore TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P10a`

## Prerequisites
- Required: Phase 10 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P10" packages/core/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] Test file exists with 15+ tests
- [ ] Plan markers present
- [ ] Requirement markers present

## Semantic Verification — Anti-Fraud Checks
- [ ] No mock theater
- [ ] No reverse testing
- [ ] Behavioral assertions present
- [ ] Tests fail naturally when run
- [ ] R8.1-R8.9 covered (all TokenStore methods)
- [ ] R23.3 covered (error translation)
- [ ] R29.1-R29.4 covered (connection management)


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
Create: `project-plans/issue1358_1359_1360/.completed/P10a.md`
