# Phase 30a: Integration Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P30a`

## Prerequisites
- Required: Phase 30 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P30" packages/cli/src/auth/proxy/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/credential-store-factory.ts` exists
- [ ] `packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts` exists
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P30` present in both files
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No parallel/duplicate versions

## Semantic Verification — Stub Checks
- [ ] `createTokenStore()` function exported (returns `TokenStore`)
- [ ] `createProviderKeyStorage()` function exported (returns appropriate interface)
- [ ] `createAndStartProxy(config)` function exported (async)
- [ ] `stopProxy()` function exported (async)
- [ ] Factory functions check `process.env.LLXPRT_CREDENTIAL_SOCKET` (in signature/types, even if stub body throws)
- [ ] No TODO/FIXME comments (only NotYetImplemented throws)
- [ ] Imports reference existing types: `TokenStore`, `KeyringTokenStore`, `ProxyTokenStore`, `ProxyProviderKeyStorage`


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
Create: `project-plans/issue1358_1359_1360/.completed/P30a.md`
