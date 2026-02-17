# Phase 09: Final Acceptance

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P09`

## Purpose

Comprehensive final verification that ALL fake implementations have been replaced with real ones:
1. Full deepthinker audit of entire proxy system
2. Run all verification scripts
3. Check for any remaining fake patterns
4. Verify full test suite passes
5. Smoke test with real provider

---

## Prerequisites

- All phases 01-08 completed
- All verification phases (01a-08a) passed

---

## Final Verification Script

```bash
#!/bin/bash
# verify-phase-09-final.sh

set -e
echo "==============================================="
echo "=== FINAL ACCEPTANCE: Credential Proxy System ==="
echo "==============================================="

PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"
LIFECYCLE_FILE="packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts"

echo ""
echo "=========================================="
echo "STEP 1: Check for ALL fake patterns"
echo "=========================================="

echo ""
echo "1.1 Checking for fake auth URLs..."
FAKE_URLS=$(grep -rn "auth.example.com\|example.com/oauth" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts" | wc -l || echo "0")
if [ "$FAKE_URLS" != "0" ]; then
  echo "FAIL: Found fake auth URLs in production code"
  grep -rn "auth.example.com\|example.com/oauth" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts"
  exit 1
fi
echo "   [OK] No fake auth URLs"

echo ""
echo "1.2 Checking for fake token patterns..."
FAKE_TOKENS=$(grep -rn "test_access_\|refreshed_.*Date\|'refreshed_'" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts" | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*" | wc -l || echo "0")
if [ "$FAKE_TOKENS" != "0" ]; then
  echo "FAIL: Found fake token patterns in production code"
  grep -rn "test_access_\|refreshed_.*Date" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts"
  exit 1
fi
echo "   [OK] No fake token patterns"

echo ""
echo "1.3 Checking for NOT_IMPLEMENTED errors..."
NOT_IMPL=$(grep -rn "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts" | wc -l || echo "0")
if [ "$NOT_IMPL" != "0" ]; then
  echo "FAIL: Found NOT_IMPLEMENTED in production code"
  grep -rn "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts"
  exit 1
fi
echo "   [OK] No NOT_IMPLEMENTED errors"

echo ""
echo "1.4 Checking for TODO/STUB/FIXME..."
TODOS=$(grep -rn "TODO\|STUB\|FIXME" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts" | wc -l || echo "0")
if [ "$TODOS" != "0" ]; then
  echo "WARN: Found TODO/STUB/FIXME in production code"
  grep -rn "TODO\|STUB\|FIXME" packages/cli/src/auth/proxy/ | grep -v "\.spec\.ts\|__tests__\|\.test\.ts"
  echo "   Review each manually - some may be acceptable"
fi

echo ""
echo "=========================================="
echo "STEP 2: Verify real implementation markers"
echo "=========================================="

echo ""
echo "2.1 Checking handleOAuthInitiate calls flowFactory..."
if ! grep -q "flowFactories.*get\|flowFactory" "$PROXY_FILE"; then
  echo "FAIL: handleOAuthInitiate doesn't use flowFactories"
  exit 1
fi
echo "   [OK] handleOAuthInitiate uses flowFactories"

echo ""
echo "2.2 Checking handleOAuthExchange calls exchangeCodeForToken..."
if ! grep -q "exchangeCodeForToken" "$PROXY_FILE"; then
  echo "FAIL: handleOAuthExchange doesn't call exchangeCodeForToken"
  exit 1
fi
echo "   [OK] handleOAuthExchange calls exchangeCodeForToken"

echo ""
echo "2.3 Checking handleRefreshToken uses RefreshCoordinator..."
if ! grep -q "refreshCoordinator.refresh\|refreshCoordinator\.refresh" "$PROXY_FILE"; then
  echo "FAIL: handleRefreshToken doesn't use RefreshCoordinator"
  exit 1
fi
echo "   [OK] handleRefreshToken uses RefreshCoordinator"

echo ""
echo "2.4 Checking real flow classes are used..."
FLOW_CLASSES=$(grep -c "AnthropicDeviceFlow\|QwenDeviceFlow\|CodexDeviceFlow" "$LIFECYCLE_FILE" || echo "0")
if [ "$FLOW_CLASSES" -lt 3 ]; then
  echo "FAIL: Missing real flow class references"
  exit 1
fi
echo "   [OK] Real flow classes are used ($FLOW_CLASSES references)"

echo ""
echo "=========================================="
echo "STEP 3: Semantic behavior verification"
echo "=========================================="

echo ""
echo "3.1 handleOAuthInitiate behaviors..."
INITIATE_BEHAVIORS=$(grep -c "flowFactories.get\|flowFactory()\|initiateDeviceFlow\|oauthSessions.set" "$PROXY_FILE" || echo "0")
if [ "$INITIATE_BEHAVIORS" -lt 3 ]; then
  echo "FAIL: handleOAuthInitiate missing required behaviors (found $INITIATE_BEHAVIORS, need 3+)"
  exit 1
fi
echo "   [OK] handleOAuthInitiate has all required behaviors ($INITIATE_BEHAVIORS matches)"

echo ""
echo "3.2 handleOAuthExchange behaviors..."
EXCHANGE_BEHAVIORS=$(grep -c "exchangeCodeForToken\|tokenStore.saveToken\|sanitize" "$PROXY_FILE" || echo "0")
if [ "$EXCHANGE_BEHAVIORS" -lt 2 ]; then
  echo "FAIL: handleOAuthExchange missing required behaviors (found $EXCHANGE_BEHAVIORS, need 2+)"
  exit 1
fi
echo "   [OK] handleOAuthExchange has all required behaviors ($EXCHANGE_BEHAVIORS matches)"

echo ""
echo "3.3 handleOAuthPoll behaviors..."
POLL_BEHAVIORS=$(grep -c "pollForToken\|authorization_pending\|slow_down" "$PROXY_FILE" || echo "0")
if [ "$POLL_BEHAVIORS" -lt 2 ]; then
  echo "FAIL: handleOAuthPoll missing required behaviors (found $POLL_BEHAVIORS, need 2+)"
  exit 1
fi
echo "   [OK] handleOAuthPoll has all required behaviors ($POLL_BEHAVIORS matches)"

echo ""
echo "3.4 handleRefreshToken behaviors..."
REFRESH_BEHAVIORS=$(grep -c "RefreshCoordinator\|coordinator.*refresh\|refreshToken\|RATE_LIMITED" "$PROXY_FILE" || echo "0")
if [ "$REFRESH_BEHAVIORS" -lt 2 ]; then
  echo "FAIL: handleRefreshToken missing required behaviors (found $REFRESH_BEHAVIORS, need 2+)"
  exit 1
fi
echo "   [OK] handleRefreshToken has all required behaviors ($REFRESH_BEHAVIORS matches)"

echo ""
echo "=========================================="
echo "STEP 4: Anti-mock-theater verification"
echo "=========================================="

echo ""
echo "4.1 Checking proxy tests don't use mock assertions..."
MOCK_THEATER=$(grep -rn "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue" packages/cli/src/auth/proxy/__tests__/ | wc -l || echo "0")
if [ "$MOCK_THEATER" != "0" ]; then
  echo "FAIL: Found mock theater in proxy tests"
  grep -rn "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/
  exit 1
fi
echo "   [OK] No mock theater ($MOCK_THEATER instances)"

echo ""
echo "4.2 Checking tests verify backing store state..."
STORE_CHECKS=$(grep -rn "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/ | wc -l || echo "0")
if [ "$STORE_CHECKS" -lt 10 ]; then
  echo "FAIL: Insufficient backing store verification ($STORE_CHECKS checks)"
  exit 1
fi
echo "   [OK] Tests verify backing store ($STORE_CHECKS checks)"

echo ""
echo "=========================================="
echo "STEP 5: Full test suite"
echo "=========================================="

echo ""
echo "5.1 TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

echo ""
echo "5.2 Linting..."
npm run lint || { echo "FAIL: Linting failed"; exit 1; }
echo "   [OK] Linting passes"

echo ""
echo "5.3 Formatting..."
npm run format || { echo "FAIL: Format check failed"; exit 1; }
echo "   [OK] Formatting correct"

echo ""
echo "5.4 Running ALL proxy tests..."
npm test -- packages/cli/src/auth/proxy/ || {
  echo "FAIL: Proxy tests failed"
  exit 1
}
echo "   [OK] All proxy tests pass"

echo ""
echo "5.5 Running full test suite..."
npm test || {
  echo "FAIL: Full test suite failed"
  exit 1
}
echo "   [OK] Full test suite passes"

echo ""
echo "5.6 Build..."
npm run build || { echo "FAIL: Build failed"; exit 1; }
echo "   [OK] Build successful"

echo ""
echo "=========================================="
echo "STEP 6: Smoke test"
echo "=========================================="

echo ""
echo "6.1 Running smoke test..."
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else" || {
  echo "FAIL: Smoke test failed"
  exit 1
}
echo "   [OK] Smoke test passes"

echo ""
echo "================================================"
echo "=== FINAL ACCEPTANCE VERIFICATION COMPLETE ==="
echo "================================================"
echo ""
echo "Summary:"
echo "  - No fake auth URLs"
echo "  - No fake token patterns"
echo "  - No NOT_IMPLEMENTED errors"
echo "  - handleOAuthInitiate: has required semantics"
echo "  - handleOAuthExchange: has required semantics"
echo "  - handleOAuthPoll: has required semantics"
echo "  - handleRefreshToken: has required semantics"
echo "  - No mock theater"
echo "  - All tests pass"
echo "  - Build successful"
echo "  - Smoke test passes"
echo ""
echo "CREDENTIAL PROXY REMEDIATION COMPLETE"
```

---

## Deepthinker Full System Audit

```markdown
## Deepthinker Prompt for Final Acceptance

Launch deepthinker with this comprehensive audit prompt:

"You are performing the FINAL AUDIT of the credential proxy remediation.

YOUR JOB IS TO FIND ANY REMAINING FAKE CODE.

Read these files thoroughly:
- packages/cli/src/auth/proxy/credential-proxy-server.ts
- packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
- packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts

COMPREHENSIVE AUDIT CHECKLIST:

## 1. handleOAuthInitiate

- [ ] Uses flowFactories.get(provider) to create flow?
- [ ] Calls flowInstance.initiateDeviceFlow()?
- [ ] Stores flowInstance in session?
- [ ] Returns real auth URL (not example.com)?
- [ ] Does NOT return code_verifier/pkce_verifier?
- [ ] All required semantic behaviors present?

Evidence required: Show exact lines for each check.

## 2. handleOAuthExchange

- [ ] Retrieves flowInstance from session?
- [ ] Calls flowInstance.exchangeCodeForToken()?
- [ ] Stores FULL token in tokenStore (including refresh_token)?
- [ ] Returns sanitized token (no refresh_token)?
- [ ] Session marked as used before exchange?
- [ ] All required semantic behaviors present?

Evidence required: Show exact lines for each check.

## 3. handleOAuthPoll

- [ ] Retrieves session with deviceCode and flowInstance?
- [ ] Calls flowInstance.pollForToken(deviceCode)?
- [ ] Handles authorization_pending → pending status?
- [ ] Handles slow_down → increased interval?
- [ ] Stores FULL token in tokenStore ONLY on completion?
- [ ] Returns sanitized token (no refresh_token)?
- [ ] Session marked as used after completion?
- [ ] All required semantic behaviors present?

Evidence required: Show exact lines for each check.

## 4. handleRefreshToken

- [ ] Uses RefreshCoordinator.refresh()?
- [ ] Calls provider.refreshToken() inside coordinator callback?
- [ ] Stores new token in tokenStore?
- [ ] Returns sanitized token (no refresh_token)?
- [ ] Handles RATE_LIMITED with retryAfter?
- [ ] All required semantic behaviors present?

Evidence required: Show exact lines for each check.

## 5. SandboxProxyLifecycle

- [ ] buildDefaultFlowFactories() creates real flows?
- [ ] buildDefaultProviders() wraps real flows?
- [ ] RefreshCoordinator is instantiated with 30s cooldown?
- [ ] All deps passed to CredentialProxyServer?

Evidence required: Show exact lines for each check.

## 5. Tests Are Real

- [ ] No toHaveBeenCalled assertions?
- [ ] Tests verify backingStore state?
- [ ] Tests would FAIL against fake implementations?

Evidence required: Show representative test assertions.

## 6. No Fake Patterns Remaining

Run these checks:
```bash
grep -rn "auth.example.com" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
grep -rn "test_access_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
grep -rn "refreshed_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
grep -rn "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
```
All should return 0 matches.

## FINAL VERDICT

Based on your thorough audit:

- [ ] PASS: All fake implementations replaced with real code
- [ ] FAIL: List specific remaining issues

If FAIL, list exactly what needs to be fixed."
```

---

## Human Acceptance Checklist (MANDATORY)

Before marking the remediation complete, a human MUST verify:

- [ ] A human has read every handler implementation (handleOAuthInitiate, handleOAuthExchange, handleOAuthPoll, handleRefreshToken)
- [ ] A human has run the smoke test with real providers
- [ ] A human has reviewed test coverage and found it adequate
- [ ] A human has checked for TODOs, FIXMEs, or deferred work
- [ ] A human would approve this as a production PR
- [ ] The original issue requirements (#1358, #1359, #1360) are actually met
- [ ] A human has spot-checked that backingStore tests actually verify state (not just response)

### Human Review Notes

[Write your findings here after manual review]

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this remediation supposed to accomplish? **Replace fake OAuth handlers with real implementations**
- Read all the handlers. Do they ACTUALLY use real providers?
- Would a user's OAuth flow work end-to-end with these handlers?

### B. Is This a Real Implementation?
- Trace the complete OAuth flow: initiate → exchange → token stored → refresh
- Does each step call real provider methods?
- Could this system authenticate a real user with Anthropic, Qwen, or Codex?

### C. Did the Model Fake Anything?
- Look for subtle fakes: providers that ignore their input, factories that don't create what they claim
- Look for "technically correct" code that wouldn't work in production
- Look for edge cases that are silently ignored

### D. Are There Serious Bugs or Issues?
- Race conditions in any handler?
- Security issues (tokens leaked, sessions not invalidated)?
- Error handling incomplete?
- Resource leaks (sessions, connections)?

### E. Verifier's Gut Check
- Would you deploy this to production tomorrow?
- Does this system feel robust and complete?
- Is there anything that makes you uncomfortable?

**Write a 3-4 paragraph assessment answering these questions. If ANY answer raises concerns, the remediation is NOT complete.**

---

## Success Criteria Summary

| Check | Expected |
|-------|----------|
| Fake auth URLs | 0 |
| Fake token patterns | 0 |
| NOT_IMPLEMENTED errors | 0 |
| handleOAuthInitiate semantics | All required behaviors |
| handleOAuthExchange semantics | All required behaviors |
| handleOAuthPoll semantics | All required behaviors |
| handleRefreshToken semantics | All required behaviors |
| Mock theater | 0 |
| Backing store checks | 10+ |
| TypeScript compiles | Yes |
| Lint passes | Yes |
| Format passes | Yes |
| Proxy tests pass | All |
| Full test suite passes | All |
| Build passes | Yes |
| Smoke test passes | Yes |
| Human acceptance checklist | All checked |
| Holistic verification | Passed |
| Deepthinker audit | PASS |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P09.md` with evidence
2. Create final commit: `git commit -m "Complete credential proxy OAuth remediation"`
3. Create PR with comprehensive description
4. Run `gh pr checks NUM --watch --interval 300` until all pass

---

## PR Description Template

```markdown
## Summary

Replaces fake credential proxy OAuth handlers with real implementations.

## Changes

### handleOAuthInitiate (Phase 03)
- Uses flowFactories to create real flow instances
- Detects flow type per provider (pkce_redirect, device_code)
- Returns real auth URLs from providers
- Stores flow instance in session for exchange

### handleOAuthExchange (Phase 05)
- Retrieves flow instance from session
- Calls real exchangeCodeForToken() on provider
- Stores full token (including refresh_token) in backing store
- Returns sanitized token (refresh_token stripped)

### handleRefreshToken (Phase 07)
- Uses RefreshCoordinator for rate limiting (30s) and deduplication
- Calls real provider.refreshToken()
- Stores new token in backing store
- Returns sanitized token

### Integration Wiring (Phase 08)
- SandboxProxyLifecycle builds real flow factories
- Real providers wired (AnthropicDeviceFlow, QwenDeviceFlow, etc.)
- RefreshCoordinator properly initialized

## Testing

- All tests verify backing store state (no mock theater)
- Tests would FAIL against old fake implementations
- Full test suite passes

## Verification

```bash
# No fake patterns
grep -rn "auth.example.com\|test_access_\|refreshed_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
# Returns 0 matches

# All tests pass
npm test -- packages/cli/src/auth/proxy/
```

Fixes #1358, #1359, #1360
```

---

## Remediation Complete

All credential proxy OAuth handlers now use real implementations:

| Handler | Before | After |
|---------|--------|-------|
| handleOAuthInitiate | Fake `auth.example.com` | Real flow factory |
| handleOAuthExchange | Fake `test_access_` token | Real `exchangeCodeForToken()` |
| handleOAuthPoll | Fake immediate token | (Deferred - uses exchange) |
| handleRefreshToken | Fake `refreshed_` token | Real `provider.refreshToken()` |
terns
grep -rn "auth.example.com\|test_access_\|refreshed_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
# Returns 0 matches

# All tests pass
npm test -- packages/cli/src/auth/proxy/
```

Fixes #1358, #1359, #1360
```

---

## Remediation Complete

All credential proxy OAuth handlers now use real implementations:

| Handler | Before | After |
|---------|--------|-------|
| handleOAuthInitiate | Fake `auth.example.com` | Real flow factory |
| handleOAuthExchange | Fake `test_access_` token | Real `exchangeCodeForToken()` |
| handleOAuthPoll | Fake immediate token | (Deferred - uses exchange) |
| handleRefreshToken | Fake `refreshed_` token | Real `provider.refreshToken()` |
n Complete

All credential proxy OAuth handlers now use real implementations:

| Handler | Before | After |
|---------|--------|-------|
| handleOAuthInitiate | Fake `auth.example.com` | Real flow factory |
| handleOAuthExchange | Fake `test_access_` token | Real `exchangeCodeForToken()` |
| handleOAuthPoll | Fake immediate token | (Deferred - uses exchange) |
| handleRefreshToken | Fake `refreshed_` token | Real `provider.refreshToken()` |
