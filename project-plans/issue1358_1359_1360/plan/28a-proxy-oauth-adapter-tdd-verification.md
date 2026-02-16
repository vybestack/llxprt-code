# Phase 28a: ProxyOAuthAdapter TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P28a`

## Prerequisites
- Required: Phase 28 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P28" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/proxy-oauth-adapter.test.ts` exists with 15+ tests
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P28` present
- [ ] Requirement markers (`@requirement`) present for R17, R18, R19

## Semantic Verification — Anti-Fraud Checks
- [ ] No `toHaveBeenCalled` / `toHaveBeenCalledWith` (mock theater)
- [ ] No `toThrow('NotYetImplemented')` (reverse testing)
- [ ] No `expect().not.toThrow()` (no-op verification)
- [ ] Tests use behavioral assertions (`toBe`, `toEqual`, `toMatch`, `toContain`, `toThrow`)
- [ ] Tests fail naturally when run (stub not yet implemented)

## Behavioral Verification Questions
1. **Do tests verify all three flow types?** — PKCE redirect, device code, browser redirect
2. **Do tests verify the poll loop?** — Pending → complete transitions, interval updates
3. **Do tests verify error handling?** — Exchange failure, poll error status, cancel on error
4. **Do tests verify refresh?** — On-demand refresh via `refresh_token` proxy operation
5. **Do tests verify cancel?** — `oauth_cancel` sent with correct session_id
6. **Do tests verify best-effort cancel?** — Cancel failure does not mask original error


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
Create: `project-plans/issue1358_1359_1360/.completed/P28a.md`
