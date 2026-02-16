# Phase 24a: OAuthSessionManager Stub — Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P24a`

## Prerequisites
- Required: Phase 24 completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P24" packages/cli/src/auth/proxy/`

## Structural Verification
- [ ] `packages/cli/src/auth/proxy/oauth-session-manager.ts` exists
- [ ] Plan markers `@plan:PLAN-20250214-CREDPROXY.P24` present
- [ ] TypeScript compiles: `npm run typecheck`
- [ ] No parallel/duplicate versions

## Semantic Verification — Stub Checks
- [ ] `PKCESessionStore` class exported
- [ ] `OAuthSession` interface exported with fields: `sessionId`, `provider`, `bucket`, `flowType`, `flowInstance`, `codeVerifier?`, `deviceCode?`, `pollIntervalMs?`, `abortController?`, `result?`, `createdAt`, `peerIdentity`, `used`
- [ ] Constructor accepts optional `sessionTimeoutMs` parameter (default 600_000)
- [ ] Environment variable override `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS` referenced or stubbed
- [ ] `startGC()` method exists
- [ ] `sweepExpired()` method exists
- [ ] `createSession(provider, bucket, flowType, flowInstance, peerIdentity)` method exists
- [ ] `getSession(sessionId, peerIdentity)` method exists
- [ ] `markUsed(sessionId)` method exists
- [ ] `removeSession(sessionId)` method exists
- [ ] `clearAll()` method exists
- [ ] `sessions` Map property exists
- [ ] `gcInterval` property exists
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
Create: `project-plans/issue1358_1359_1360/.completed/P24a.md`
