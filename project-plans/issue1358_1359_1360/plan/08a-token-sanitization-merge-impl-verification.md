# Phase 08a: Token Sanitization & Merge Implementation — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P08a`

## Prerequisites
- Required: Phase 08 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P08" packages/core/src/auth/`

## Structural Verification
- [ ] `@plan:PLAN-20250214-CREDPROXY.P08` markers in implementation files
- [ ] All tests pass: `npm test -- packages/core/src/auth/__tests__/token-sanitization.test.ts`
- [ ] All tests pass: `npm test -- packages/core/src/auth/__tests__/token-merge.test.ts`
- [ ] No test files modified: `git diff packages/core/src/auth/__tests__/`
- [ ] TypeScript compiles: `npm run typecheck`

## Deferred Implementation Detection (MANDATORY)
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
```
All three must return no matches.

## Pseudocode Compliance
- [ ] `sanitizeTokenForProxy` — destructures `refresh_token` out, returns rest
- [ ] `SanitizedOAuthToken` type — `Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>`
- [ ] `mergeRefreshedToken` — always uses new `access_token`/`expiry`, conditional `refresh_token`, optional fields
- [ ] Immutable — does not mutate input objects

## Holistic Functionality Assessment
**The verifier MUST write a documented assessment:**
- What was implemented? (describe sanitization + merge logic)
- Does it satisfy R10.1-R10.4, R12.1-R12.5?
- Trace: token with refresh_token → sanitizeTokenForProxy → verify refresh_token absent
- Trace: stored + new token → mergeRefreshedToken → verify merge rules applied
- What could go wrong? (edge cases with empty strings, undefined fields)
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
Create: `project-plans/issue1358_1359_1360/.completed/P08a.md`
