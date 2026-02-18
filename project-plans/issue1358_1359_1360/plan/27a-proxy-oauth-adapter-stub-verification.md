# Phase 27a: ProxyOAuthAdapter Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P27a`

## Prerequisites
- Required: Phase 27 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P27" packages/cli/src/auth/proxy/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/proxy-oauth-adapter.ts` exists
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P27` present
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No parallel/duplicate versions

## Semantic Verification — Stub Checks
- [ ] `ProxyOAuthAdapter` class exported
- [ ] Constructor accepts `socketClient: ProxySocketClient`
- [ ] `login(provider: string, bucket?: string)` method exists (async)
- [ ] `handlePkceRedirect(sessionId: string, data: InitiateResponse)` method exists (async)
- [ ] `handleDeviceCode(sessionId: string, data: InitiateResponse)` method exists (async)
- [ ] `handleBrowserRedirect(sessionId: string, data: InitiateResponse)` method exists (async)
- [ ] `refresh(provider: string, bucket?: string)` method exists (async)
- [ ] `cancel(sessionId: string)` method exists (async)
- [ ] `socketClient` property stored from constructor
- [ ] No TODO/FIXME comments (only NotYetImplemented throws)


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
Create: `project-plans/issue1358_1359_1360/.completed/P27a.md`
