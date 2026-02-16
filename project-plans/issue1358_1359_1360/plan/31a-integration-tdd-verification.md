# Phase 31a: Integration TDD — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P31a`

## Prerequisites
- Required: Phase 31 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P31" packages/cli/src/auth/proxy/__tests__/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/__tests__/integration.test.ts` exists with 20+ tests
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P31` present
- [ ] Requirement markers (`@requirement`) present for R2, R8, R9, R10, R17, R25

## Semantic Verification — Anti-Fraud Checks
- [ ] No `toHaveBeenCalled` / `toHaveBeenCalledWith` (mock theater)
- [ ] No `toThrow('NotYetImplemented')` (reverse testing)
- [ ] No `expect().not.toThrow()` (no-op verification)
- [ ] Tests use behavioral assertions (`toBe`, `toEqual`, `toMatch`, `toContain`, `toThrow`)
- [ ] Tests fail naturally when run (stubs not yet implemented)

## Behavioral Verification Questions
1. **Do tests create real socket connections?** — Not mocked sockets, real Unix domain sockets
2. **Do tests verify the full data path?** — Inner API → socket → proxy → host store → response
3. **Do tests verify token sanitization end-to-end?** — refresh_token stripped across real socket
4. **Do tests verify factory detection?** — env var set/unset returns correct implementation
5. **Do tests verify singleton behavior?** — Same instance returned from repeated calls
6. **Do tests verify lifecycle?** — Socket created on start, removed on stop
7. **Do tests verify profile scoping?** — Unauthorized provider rejected
8. **Do tests verify connection loss?** — Hard error surfaces to caller
9. **Do tests cover all TokenStore operations?** — get, save, remove, listProviders, listBuckets, getBucketStats
10. **Do tests cover ProviderKeyStorage operations?** — getKey, listKeys, hasKey, saveKey (throws), deleteKey (throws)


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
Create: `project-plans/issue1358_1359_1360/.completed/P31a.md`
