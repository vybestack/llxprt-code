# Phase 19a: RefreshCoordinator TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P19a`

## Prerequisites
- Required: Phase 19 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P19" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/refresh-coordinator.test.ts` exists with 18+ tests
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P19` present
- [ ] Requirement markers (`@requirement`) present for R11, R12, R13, R14

## Semantic Verification — Anti-Fraud Checks
- [ ] No `toHaveBeenCalled` / `toHaveBeenCalledWith` (mock theater)
- [ ] No `toThrow('NotYetImplemented')` (reverse testing)
- [ ] No `expect().not.toThrow()` (no-op verification)
- [ ] No `toHaveProperty` without value assertion (structure-only testing)
- [ ] Tests use `toBe`, `toEqual`, `toMatch`, `toContain` (behavioral assertions)
- [ ] Tests fail naturally when run (stub not yet implemented)

## Behavioral Verification Questions
1. **Would these tests fail if the implementation was wrong?** — Each test verifies data transformation or error behavior
2. **Do tests cover the security invariant?** — refresh_token NEVER in any returned result
3. **Do tests cover the double-check pattern?** — Skips refresh when re-read token is valid
4. **Do tests cover all retry scenarios?** — Transient retry with backoff, auth error no retry, exhausted retries
5. **Do tests cover rate limiting?** — Valid token in cooldown, expired token in cooldown, outside cooldown


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
Create: `project-plans/issue1358_1359_1360/.completed/P19a.md`
