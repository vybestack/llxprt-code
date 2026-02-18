# Phase 12a: ProxyProviderKeyStorage Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P12a`

## Prerequisites
- Required: Phase 12 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P12" packages/core/src/auth/proxy/`

## Structural Verification
- [ ] `packages/core/src/auth/proxy/proxy-provider-key-storage.ts` exists
- [ ] Plan markers present
- [ ] `npm run typecheck` passes

## Semantic Verification
- [ ] All methods present: `getKey`, `listKeys`, `hasKey`, `saveKey`, `deleteKey`
- [ ] `saveKey` throws with sandbox mode error message
- [ ] `deleteKey` throws with sandbox mode error message
- [ ] Constructor accepts `socketPath: string`
- [ ] No version duplication

## Holistic Functionality Assessment
The verifier MUST write a documented assessment answering:
- What was created?
- Does the class match the `ProviderKeyStorage` interface surface?
- Are write methods correctly throwing?
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
Create: `project-plans/issue1358_1359_1360/.completed/P12a.md`
