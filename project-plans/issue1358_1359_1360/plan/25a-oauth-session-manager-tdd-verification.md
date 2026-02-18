# Phase 25a: OAuthSessionManager TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P25a`

## Prerequisites
- Required: Phase 25 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P25" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/oauth-session-manager.test.ts` exists with 15+ tests
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P25` present
- [ ] Requirement markers (`@requirement`) present for R20

## Semantic Verification — Anti-Fraud Checks
- [ ] No `toHaveBeenCalled` / `toHaveBeenCalledWith` (mock theater)
- [ ] No `toThrow('NotYetImplemented')` (reverse testing)
- [ ] No `expect().not.toThrow()` (no-op verification)
- [ ] Tests use behavioral assertions (`toBe`, `toEqual`, `toMatch`, `toContain`, `toThrow`)
- [ ] Tests fail naturally when run (stub not yet implemented)

## Behavioral Verification Questions
1. **Do tests verify session lifecycle?** — Create, get, markUsed, remove, clearAll
2. **Do tests verify security invariants?** — Peer binding, single-use, expiration
3. **Do tests verify error cases?** — SESSION_NOT_FOUND, SESSION_ALREADY_USED, SESSION_EXPIRED, UNAUTHORIZED
4. **Do tests verify cleanup?** — sweepExpired removes stale sessions, abortController.abort() called
5. **Do tests verify configurability?** — Env var override for session timeout


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
Create: `project-plans/issue1358_1359_1360/.completed/P25a.md`
