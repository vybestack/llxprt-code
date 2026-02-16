# Phase 07a: Token Sanitization & Merge TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P07a`

## Prerequisites
- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P07" packages/core/src/auth/__tests__/`

## Structural Verification
- [ ] `token-sanitization.test.ts` exists with 10+ tests
- [ ] `token-merge.test.ts` exists with 12+ tests
- [ ] Plan markers present in both test files
- [ ] Requirement markers (`@requirement`) present

## Semantic Verification — Anti-Fraud Checks
- [ ] No `toHaveBeenCalled` / `toHaveBeenCalledWith` (mock theater)
- [ ] No `toThrow('NotYetImplemented')` (reverse testing)
- [ ] No `expect().not.toThrow()` (no-op verification)
- [ ] No `toHaveProperty` without value assertion (structure-only testing)
- [ ] Tests use `toBe`, `toEqual`, `toMatch`, `toContain` (behavioral assertions)
- [ ] Tests fail naturally when run (stubs not yet implemented)

## Behavioral Verification Questions
1. **Would these tests fail if the implementation was wrong?** — Each test verifies actual output values
2. **Do tests cover all requirement behaviors?** — R10.1 (stripping), R10.3 (passthrough), R12.1 (access_token), R12.2 (refresh_token preserve), R12.3 (revocation), R12.4 (optional fields)
3. **Are immutability tests present?** — Verify input tokens are not mutated


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
Create: `project-plans/issue1358_1359_1360/.completed/P07a.md`
