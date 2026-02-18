# Phase 03a: OAuth Initiate Implementation - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P03a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-03.sh

set -e
echo "=== Phase 03 Verification: OAuth Initiate Implementation ==="

PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"
TEST_FILE="packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts"

# 1. Check for fake patterns
echo ""
echo "1. Checking for fake patterns..."
if grep -n "auth.example.com" "$PROXY_FILE" | grep -i initiate; then
  echo "FAIL: Found fake auth URL in handleOAuthInitiate"
  exit 1
fi
echo "   [OK] No fake auth URLs"

# 2. Check for flow factory usage
echo ""
echo "2. Checking for flow factory usage..."
if ! grep -q "flowFactories\|flowFactory" "$PROXY_FILE"; then
  echo "FAIL: No flowFactories usage found"
  exit 1
fi
echo "   [OK] Flow factory is used"

# 3. Check for initiateDeviceFlow call
echo ""
echo "3. Checking for real provider call..."
if ! grep -q "initiateDeviceFlow" "$PROXY_FILE"; then
  echo "FAIL: No initiateDeviceFlow call found"
  exit 1
fi
echo "   [OK] initiateDeviceFlow is called"

# 4. Check for flow instance in session
echo ""
echo "4. Checking for flow instance storage..."
if ! grep -q "flowInstance" "$PROXY_FILE"; then
  echo "FAIL: flowInstance not stored in session"
  exit 1
fi
echo "   [OK] flowInstance is stored in session"

# 5. Semantic behavior check
echo ""
echo "5. Checking required semantic behaviors..."
BEHAVIORS=$(grep -c "flowFactories.get\|flowFactory()\|initiateDeviceFlow\|oauthSessions.set" "$PROXY_FILE" || echo "0")
if [ "$BEHAVIORS" -lt 3 ]; then
  echo "FAIL: handleOAuthInitiate missing required behaviors (found $BEHAVIORS, need 3+)"
  exit 1
fi
echo "   [OK] handleOAuthInitiate has all required behaviors ($BEHAVIORS matches)"

# 6. TypeScript compilation
echo ""
echo "6. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 7. Tests pass
echo ""
echo "7. Running Phase 02 tests..."
npm test -- "$TEST_FILE" || {
  echo "FAIL: OAuth initiate tests failed"
  exit 1
}
echo "   [OK] All tests pass"

# 8. Security check - no sensitive data in response
echo ""
echo "8. Checking security (no sensitive data returned)..."
# Look for response construction and ensure no sensitive fields
if grep -A 20 "const response:" "$PROXY_FILE" | grep -q "code_verifier\|pkce_verifier\|device_code"; then
  echo "WARN: Possible sensitive data in response - manual review needed"
fi
echo "   [OK] Security check passed (manual review recommended)"

echo ""
echo "=== Phase 03 Verification PASSED ==="
```

---

## Manual Verification Checklist

### Flow Factory Integration

- [ ] `flowFactories` is in `CredentialProxyServerOptions` interface
- [ ] `handleOAuthInitiate` calls `this.options.flowFactories?.get(provider)`
- [ ] Returns `PROVIDER_NOT_CONFIGURED` if no factory

### Real Provider Call

- [ ] `flowInstance.initiateDeviceFlow(redirectUri)` is called
- [ ] Result is used to build response
- [ ] Errors are caught and returned as `FLOW_INITIATION_FAILED`

### Session Storage

- [ ] Session includes `flowInstance`
- [ ] Session includes `flowType`
- [ ] Session includes `pkceState` for PKCE flows
- [ ] Session has `createdAt` for timeout tracking

### Flow Type Detection

- [ ] `detectFlowType` method exists
- [ ] Returns `pkce_redirect` for anthropic
- [ ] Returns `device_code` for qwen
- [ ] Returns appropriate type for other providers

### Response Structure

- [ ] Response includes `session_id` (32 hex chars)
- [ ] Response includes `flow_type`
- [ ] Response includes `auth_url`
- [ ] Response includes `pollIntervalMs`
- [ ] `device_code` flows include `user_code`

### Security Constraints

- [ ] `code_verifier` NOT in response
- [ ] `pkce_verifier` NOT in response
- [ ] `flowInstance` NOT in response
- [ ] `pkceState` NOT in response
- [ ] `device_code` (internal) NOT in response

### Semantic Behaviors

- [ ] MUST use flowFactories.get(provider)
- [ ] MUST call initiateDeviceFlow()
- [ ] MUST store flowInstance in session
- [ ] MUST detect flow type appropriately

---

## Deepthinker Critical Analysis (MANDATORY)

```markdown
## Deepthinker Prompt for Phase 03a

Launch deepthinker with this prompt:

"Verify handleOAuthInitiate is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleOAuthInitiate method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. FLOW FACTORY INTEGRATION:
   - Find where flowFactories map is accessed
   - Find where flow instance is created
   - Show me the EXACT line: `const flow = this.flowFactories.get(provider)()`
   - If you can't find this, it's FAKE.

2. PROVIDER-SPECIFIC FLOW DETECTION:
   - Show the switch/if that detects flow type per provider
   - Anthropic should use pkce_redirect
   - Qwen should use device_code
   - If all providers get same type, it's FAKE.

3. REAL PROVIDER CALL:
   - Show EXACT line where `initiateDeviceFlow()` is called
   - This must be `await flowInstance.initiateDeviceFlow(redirectUri)`
   - If result is hardcoded, it's FAKE.

4. SESSION STATE STORAGE:
   - Show where session is stored with flow instance
   - Must contain: { provider, bucket, flowInstance, flowType, createdAt, pkceState }
   - If flowInstance isn't stored, exchange can't work.

5. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   grep -c "flowFactories.get\|initiateDeviceFlow\|oauthSessions.set\|detectFlowType" packages/cli/src/auth/proxy/credential-proxy-server.ts
   ```
   All 4 required behaviors MUST be present

6. NO HARDCODED VALUES:
   ```bash
   grep -n "auth.example.com\|browser_redirect" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
   ```
   Expected: 0 matches in actual code (not comments)

RED FLAGS (automatic FAIL):
- Hardcoded flow_type 'browser_redirect' for all providers
- No flowFactories access
- auth_url contains 'example.com' or 'test'
- Session doesn't store flowInstance
- initiateDeviceFlow() not called

YOUR VERDICT:
- PASS: Implementation is real, uses flow factories, stores flow instance
- FAIL: List specific fake patterns found"
```

---

## Evidence Collection

### Flow Factory Usage

```bash
$ grep -n "flowFactories\|flowFactory" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing usage in handleOAuthInitiate]
```

### initiateDeviceFlow Call

```bash
$ grep -n "initiateDeviceFlow" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing the call]
```

### Session Storage

```bash
$ grep -A 10 "this.oauthSessions.set" packages/cli/src/auth/proxy/credential-proxy-server.ts | head -15
[paste output showing flowInstance in session]
```

### Line Count

```bash
$ sed -n '/private async handleOAuthInitiate/,/^  private async handle/p' packages/cli/src/auth/proxy/credential-proxy-server.ts | wc -l
[paste count - must be >= 40]
```

### No Fake Patterns

```bash
$ grep -n "example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts
[should be empty or only in comments]
```

### Test Results

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts 2>&1 | tail -10
[paste output showing all tests pass]
```

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| Flow factory used | Yes | |
| initiateDeviceFlow called | Yes | |
| flowInstance in session | Yes | |
| Semantic behaviors | All required | |
| No fake URLs | 0 matches | |
| Tests pass | All | |
| TypeScript compiles | Yes | |
| Deepthinker verdict | PASS | |

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Implement handleOAuthInitiate using real flow factories, storing flow instance in session**
- Read the implementation. Does it ACTUALLY accomplish that?
- Would a user's problem be solved by this code? **Would a user get a real auth URL they could use?**

### B. Is This a Real Implementation?
- Trace the code path from entry to exit
- Does it call real provider methods or fake ones? **Must call flowInstance.initiateDeviceFlow()**
- Does it store real data or return hardcoded values? **auth_url must come from provider, not hardcoded**
- Could this code work in production with real OAuth providers? **If the answer is "maybe" or "sort of", it FAILS**

### C. Did the Model Fake Anything?
- Look for clever tricks: string concatenation that builds "example.com"
- Look for aliased variables that hide fake values
- Look for "close but not quite" implementations (e.g., creates flow but ignores its output)
- Look for code that passes tests but doesn't actually work
- Look for TODO/FIXME/HACK comments hidden in the code

### D. Are There Serious Bugs or Issues?
- Race conditions in session creation?
- Resource leaks (flow instances created but never cleaned up)?
- Security issues (PKCE verifier exposed, auth state guessable)?
- Error handling missing or incomplete?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve it?
- Does something feel "off" about this implementation?
- Is this code you'd be comfortable running in production?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Holistic Functionality Assessment

### What was implemented?

[Describe in your own words what the code actually does - not what markers say, but what you observed by reading the code]

### Does it satisfy the requirements?

[For each requirement, explain HOW the implementation satisfies it with specific code locations]

1. **Flow type detection**: [How is this implemented? Which lines?]
2. **Real auth URL**: [Where does the URL come from? Line number?]
3. **Session storage**: [What's stored? Where?]
4. **Security**: [What sensitive data is NOT returned? Evidence?]

### What is the data flow?

```
Request: { provider: 'anthropic', bucket: 'default' }
  -> handleOAuthInitiate()
  -> flowFactories.get('anthropic')() -> creates flow instance
  -> flowInstance.initiateDeviceFlow() -> real provider call
  -> oauthSessions.set(sessionId, { flowInstance, flowType, ... })
  -> Response: { session_id, flow_type, auth_url, ... }
```

### What could go wrong?

[Identify edge cases, error conditions, or integration risks]

### Verdict

[PASS/FAIL with explanation]

---

## Semantic Implementation Checks (Replaces Raw LOC)

Instead of just counting lines, verify these BEHAVIORS exist:

### handleOAuthInitiate must have:
- [ ] Flow factory lookup by provider name (`flowFactories.get(provider)`)
- [ ] Flow instance creation (`flowFactory()` called)
- [ ] Session creation with unique ID (crypto.randomBytes or similar)
- [ ] Flow instance stored in session (`session.flowInstance = flow`)
- [ ] Flow-type-specific response (auth_url OR device_code+user_code)
- [ ] Error handling for missing provider factory
- [ ] Error handling for initiation failure

---

## Phase Completion

When all checks pass:

1. Create `.completed/P03.md` with evidence
2. Commit: `git commit -m "Phase 03: Implement handleOAuthInitiate with real flow factories"`
3. Proceed to Phase 04: OAuth Exchange TDD
