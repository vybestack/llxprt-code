# Phase 06a: Token Sanitization & Merge Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P06a`

## Prerequisites
- Required: Phase 06 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P06" packages/core/src/auth/`

## Structural Verification
- [ ] `packages/core/src/auth/token-sanitization.ts` exists
- [ ] `packages/core/src/auth/token-merge.ts` exists
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P06` present in both files
- [ ] `npm run typecheck` passes

## Semantic Verification
- [ ] `sanitizeTokenForProxy` exported from `token-sanitization.ts`
- [ ] `SanitizedOAuthToken` type exported from `token-sanitization.ts`
- [ ] `mergeRefreshedToken` exported from `token-merge.ts`
- [ ] No version duplication
- [ ] Stubs use `throw new Error('NotYetImplemented')` or return typed empty values
- [ ] Correct function signatures match pseudocode contract (input/output types)

## Behavioral Verification Questions
1. **Do the files compile?** — Run `npm run typecheck`, verify zero errors
2. **Are the exports correct?** — Read actual export statements, verify match to pseudocode 002
3. **Is the type surface correct?** — `SanitizedOAuthToken` = `Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>`

## Holistic Functionality Assessment
The verifier MUST write a documented assessment answering:
- What was created? (describe the stub structure)
- Does it match the pseudocode contract? (inputs/outputs/types)
- What is the type surface area? (exported types and functions)
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
Create: `project-plans/issue1358_1359_1360/.completed/P06a.md`
