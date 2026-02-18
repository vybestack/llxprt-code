# Phase 08a: Integration Wiring - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P08a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-08.sh

set -e
echo "=== Phase 08 Verification: Integration Wiring ==="

LIFECYCLE_FILE="packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts"
PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"
TEST_FILE="packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts"

# 1. Check flowFactories wiring
echo ""
echo "1. Checking flowFactories wiring..."
if ! grep -q "flowFactories\|buildDefaultFlowFactories" "$LIFECYCLE_FILE"; then
  echo "FAIL: No flowFactories wiring in lifecycle"
  exit 1
fi
echo "   [OK] flowFactories wired"

# 2. Check providers wiring
echo ""
echo "2. Checking providers wiring..."
if ! grep -q "providers\|buildDefaultProviders" "$LIFECYCLE_FILE"; then
  echo "FAIL: No providers wiring in lifecycle"
  exit 1
fi
echo "   [OK] providers wired"

# 3. Check RefreshCoordinator wiring
echo ""
echo "3. Checking RefreshCoordinator wiring..."
if ! grep -q "RefreshCoordinator" "$LIFECYCLE_FILE"; then
  echo "FAIL: No RefreshCoordinator in lifecycle"
  exit 1
fi
echo "   [OK] RefreshCoordinator wired"

# 4. Check real flow imports
echo ""
echo "4. Checking real flow imports..."
FLOW_IMPORTS=$(grep -c "AnthropicDeviceFlow\|QwenDeviceFlow\|CodexDeviceFlow" "$LIFECYCLE_FILE" || echo "0")
if [ "$FLOW_IMPORTS" -lt 2 ]; then
  echo "FAIL: Missing real flow imports (found $FLOW_IMPORTS)"
  exit 1
fi
echo "   [OK] Real flow classes imported ($FLOW_IMPORTS references)"

# 5. Check test file exists
echo ""
echo "5. Checking integration test file..."
if [ ! -f "$TEST_FILE" ]; then
  echo "FAIL: Integration test file not found: $TEST_FILE"
  exit 1
fi
echo "   [OK] Integration test file exists"

# 6. TypeScript compilation
echo ""
echo "6. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 7. Integration tests pass
echo ""
echo "7. Running integration tests..."
npm test -- "$TEST_FILE" || {
  echo "FAIL: Integration tests failed"
  exit 1
}
echo "   [OK] Integration tests pass"

# 8. Run all proxy tests to ensure nothing broken
echo ""
echo "8. Running all proxy tests..."
npm test -- packages/cli/src/auth/proxy/__tests__/ || {
  echo "FAIL: Some proxy tests failed"
  exit 1
}
echo "   [OK] All proxy tests pass"

echo ""
echo "=== Phase 08 Verification PASSED ==="
```

---

## Manual Verification Checklist

### SandboxProxyLifecycle Updates

- [ ] `buildDefaultFlowFactories()` method exists
- [ ] Returns Map with 'anthropic', 'qwen', 'codex' entries
- [ ] Each factory creates real flow instance (AnthropicDeviceFlow, etc.)

- [ ] `buildDefaultProviders()` method exists
- [ ] Wraps flow instances for refreshToken calls
- [ ] Handles providers without refreshToken capability

- [ ] `RefreshCoordinator` is instantiated
- [ ] 30s cooldown is configured
- [ ] Passed to CredentialProxyServer

### CredentialProxyServer Updates

- [ ] Constructor accepts `flowFactories` option
- [ ] Constructor accepts `providers` option
- [ ] Constructor accepts `refreshCoordinator` option
- [ ] Defaults to creating RefreshCoordinator if not provided

### Integration Tests

- [ ] Test: oauth_initiate uses real flow factory
- [ ] Test: Token operations use real backing store
- [ ] Test: Lifecycle stop cleans up socket

### Real Providers Used

```bash
grep -n "new AnthropicDeviceFlow\|new QwenDeviceFlow\|new CodexDeviceFlow" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
# Expected: Find instantiation
```

---

## Deepthinker Critical Analysis (MANDATORY)

```markdown
## Deepthinker Prompt for Phase 08a

Launch deepthinker with this prompt:

"Verify the integration wiring connects REAL components, not test doubles.

Read:
- packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
- packages/cli/src/auth/proxy/credential-proxy-server.ts

VERIFY THESE REQUIREMENTS:

1. FLOW FACTORIES ARE REAL:
   - Find buildDefaultFlowFactories()
   - Show that it creates AnthropicDeviceFlow, QwenDeviceFlow, CodexDeviceFlow
   - These must be IMPORTED from real modules, not test doubles
   Show me the imports and the factory Map construction.

2. PROVIDERS ARE REAL:
   - Find buildDefaultProviders()
   - Show that providers wrap real flow.refreshToken()
   - Not fake providers that return hardcoded tokens
   Show me how providers are constructed.

3. REFRESHCOORDINATOR WIRED:
   - Find where RefreshCoordinator is instantiated
   - Show it's passed to CredentialProxyServer
   - Verify 30s cooldown is configured
   Show me the wiring.

4. SERVER RECEIVES ALL DEPS:
   - Show CredentialProxyServer constructor call
   - Verify flowFactories, providers, refreshCoordinator all passed
   If any are missing, the implementation is INCOMPLETE.

5. NO HARDCODED TEST DATA:
   ```bash
   grep -n "example.com\|test_\|fake_" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
   ```
   Expected: 0 matches in actual code

6. INTEGRATION POINTS:
   - Can a sandbox process actually call oauth_initiate and get real URLs?
   - Can a sandbox process actually call refresh_token and use RefreshCoordinator?
   If code is not reachable from sandbox, it's DEAD CODE.

YOUR VERDICT:
- PASS: Wiring uses real flows, real providers, RefreshCoordinator
- FAIL: List specific issues"
```

---

## Evidence Collection

### Flow Factories

```bash
$ grep -A 10 "buildDefaultFlowFactories" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
[paste output showing real flow instantiation]
```

### Providers

```bash
$ grep -A 15 "buildDefaultProviders" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
[paste output showing provider construction]
```

### RefreshCoordinator

```bash
$ grep -B 5 -A 5 "RefreshCoordinator" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
[paste output showing instantiation and wiring]
```

### Server Construction

```bash
$ grep -A 10 "new CredentialProxyServer" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
[paste output showing all deps passed]
```

### No Fake Data

```bash
$ grep -n "example.com" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
[should be empty]
```

### Test Results

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts 2>&1 | tail -10
[paste output showing all tests pass]
```

---

## Additional Tests Required (Deepthinker Recommendations)

### Provider Coverage Tests

```typescript
### Provider-Specific Flow Type Tests
- Test: anthropic -> pkce_redirect flow, returns verification_uri_complete
- Test: qwen -> device_code flow, returns user_code + verification_uri
- Test: codex (primary) -> browser_redirect flow, returns auth_url
- Test: codex (fallback) -> device_code flow when browser unavailable
- Test: gemini -> pkce_redirect flow with Google OAuth

### Test: Each provider uses correct flow factory
- Mock each flow factory
- Initiate for each provider
- Verify correct factory was used (by checking response shape matches provider)
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Wire real OAuth providers into the credential proxy server**
- Read the wiring. Does it ACTUALLY connect real providers?
- Would the system work end-to-end with real OAuth flows?

### B. Is This a Real Implementation?
- Trace the wiring from SandboxProxyLifecycle to CredentialProxyServer
- Are real flow classes (AnthropicDeviceFlow, QwenDeviceFlow, CodexDeviceFlow) imported?
- Are factories creating real instances, not mocks?
- Could this code actually authenticate with Anthropic, Qwen, Codex in production?

### C. Did the Model Fake Anything?
- Look for imports from `__mocks__` or test directories
- Look for factories that return stub objects instead of real flows
- Look for RefreshCoordinator configured with 0ms cooldown (disabling rate limiting)
- Look for "example" or "test" providers mixed in

### D. Are There Serious Bugs or Issues?
- Are all providers actually wired (anthropic, qwen, codex, gemini)?
- Is RefreshCoordinator cooldown set correctly (30s)?
- Are there missing error handlers that could crash the proxy?
- Is cleanup happening on shutdown (socket file deleted)?

### E. Verifier's Gut Check
- If you deployed this to production, would OAuth flows work?
- Does this integration feel complete and robust?
- Is this wiring you'd trust to handle real user authentication?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| flowFactories wired | Yes | |
| Real flow classes used | 3+ | |
| providers wired | Yes | |
| RefreshCoordinator wired | Yes | |
| Provider coverage tests | Yes | |
| Integration tests pass | All | |
| All proxy tests pass | All | |
| TypeScript compiles | Yes | |
| No fake data | 0 matches | |
| Holistic verification passed | Yes | |
| Deepthinker verdict | PASS | |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P08.md` with evidence
2. Commit: `git commit -m "Phase 08: Wire real providers into credential proxy"`
3. Proceed to Phase 09: Final Acceptance
