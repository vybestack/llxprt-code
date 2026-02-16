# Phase 01a: Analysis Verification

## Phase ID
`PLAN-20250214-CREDPROXY.P01a`

## Prerequisites
- Required: Phase 01 completed
- Verification: `test -f project-plans/issue1358_1359_1360/.completed/P01.md`

## Verification Checklist

### Structural Verification
- [ ] `analysis/domain-model.md` exists and is non-empty
- [ ] All 9 components from pseudocode are covered
- [ ] State transition diagrams present for connection, session, token lifecycle
- [ ] Business rules section covers trust boundary, rate limiting, profile scoping
- [ ] Edge cases enumerated (PID reuse, macOS symlinks, sleep, concurrent refresh, Gemini)
- [ ] Error scenarios documented with expected behavior

### Semantic Verification
- [ ] All REQ tags from requirements.md have corresponding domain model coverage
- [ ] R1 (combined delivery) reflected in entity relationships
- [ ] R2 (detection/mode selection) reflected in factory function design
- [ ] R3 (socket creation/security) reflected in CredentialProxyServer entity
- [ ] R10 (token sanitization) reflected as a cross-cutting concern
- [ ] R17-R19 (OAuth flows) reflected in session state machine
- [ ] No implementation details leaked into domain analysis

### Behavioral Verification Questions
1. **Does the domain model capture the trust boundary?**
   - [ ] refresh_token stripping is a first-class concept
   - [ ] PKCE secrets confined to host-side entities
2. **Are all data flows traceable?**
   - [ ] Token read path: inner → ProxyTokenStore → socket → CredentialProxyServer → KeyringTokenStore → sanitize → return
   - [ ] Token refresh path: inner → refresh_token op → server → lock → double-check → provider.refresh → merge → save → unlock → sanitize → return
   - [ ] Login path: inner → ProxyOAuthAdapter → oauth_initiate → server → provider flow → session → exchange/poll → token stored on host → sanitize → return

## Verification Commands

```bash
# Count entity coverage
for entity in CredentialProxyServer ProxyTokenStore ProxyProviderKeyStorage ProxyOAuthAdapter ProxySocketClient PKCESessionStore ProactiveScheduler RefreshCoordinator TokenMerge; do
  COUNT=$(grep -c "$entity" analysis/domain-model.md 2>/dev/null || echo 0)
  echo "$entity: $COUNT mentions"
done

# Verify requirement coverage
for req in R1 R2 R3 R4 R5 R6 R7 R8 R9 R10 R11 R12 R13 R14 R15 R16 R17 R18 R19 R20 R21 R22 R23 R24 R25 R26 R27 R28 R29; do
  grep -q "$req" analysis/domain-model.md 2>/dev/null && echo "$req: covered" || echo "$req: MISSING"
done
```

## Success Criteria
- All 9 entities documented with relationships
- All 29 requirement groups have domain model coverage
- No implementation details in analysis
- Edge cases match specification


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
Create: `project-plans/issue1358_1359_1360/.completed/P01a.md`
