# Phase 05a: OAuth Exchange Implementation - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P05a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-05.sh

set -e
echo "=== Phase 05 Verification: OAuth Exchange Implementation ==="

PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"
TEST_FILE="packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts"

# 1. Check for fake patterns
echo ""
echo "1. Checking for fake patterns..."
FAKE_MATCHES=$(grep -n "test_access_" "$PROXY_FILE" | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*" | wc -l || echo "0")
if [ "$FAKE_MATCHES" != "0" ]; then
  echo "FAIL: Found fake token pattern in handleOAuthExchange"
  grep -n "test_access_" "$PROXY_FILE"
  exit 1
fi
echo "   [OK] No fake token patterns"

# 2. Check for flow instance retrieval
echo ""
echo "2. Checking for flow instance retrieval..."
if ! grep -q "session.flowInstance\|flowInstance.*session" "$PROXY_FILE"; then
  echo "FAIL: No flow instance retrieval found"
  exit 1
fi
echo "   [OK] Flow instance retrieved from session"

# 3. Check for exchangeCodeForToken call
echo ""
echo "3. Checking for real provider call..."
if ! grep -q "exchangeCodeForToken" "$PROXY_FILE"; then
  echo "FAIL: No exchangeCodeForToken call found"
  exit 1
fi
echo "   [OK] exchangeCodeForToken is called"

# 4. Check for token storage
echo ""
echo "4. Checking for token storage..."
if ! grep -q "tokenStore.saveToken" "$PROXY_FILE"; then
  echo "FAIL: No tokenStore.saveToken call found"
  exit 1
fi
echo "   [OK] Token is stored in backing store"

# 5. Check for sanitization
echo ""
echo "5. Checking for token sanitization..."
if ! grep -q "sanitizeTokenForProxy" "$PROXY_FILE"; then
  echo "FAIL: No sanitizeTokenForProxy call found"
  exit 1
fi
echo "   [OK] Token is sanitized before return"

# 6. Semantic behavior check
echo ""
echo "6. Checking required semantic behaviors..."
BEHAVIORS=$(grep -c "exchangeCodeForToken\|tokenStore.saveToken\|sanitize" "$PROXY_FILE" || echo "0")
if [ "$BEHAVIORS" -lt 2 ]; then
  echo "FAIL: handleOAuthExchange missing required behaviors (found $BEHAVIORS, need 2+)"
  exit 1
fi
echo "   [OK] handleOAuthExchange has all required behaviors ($BEHAVIORS matches)"

# 7. TypeScript compilation
echo ""
echo "7. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 8. Tests pass
echo ""
echo "8. Running Phase 04 tests..."
npm test -- "$TEST_FILE" || {
  echo "FAIL: OAuth exchange tests failed"
  exit 1
}
echo "   [OK] All tests pass"

echo ""
echo "=== Phase 05 Verification PASSED ==="
```

---

## Manual Verification Checklist

### Flow Instance Integration

- [ ] `session.flowInstance` is retrieved
- [ ] Error if flowInstance missing: `INVALID_SESSION`
- [ ] `flowInstance.exchangeCodeForToken(code)` is called

### Token Storage

- [ ] Full token (including refresh_token) stored via `tokenStore.saveToken()`
- [ ] Provider and bucket passed correctly
- [ ] Storage happens BEFORE response

### Sanitization

- [ ] `sanitizeTokenForProxy(token)` called
- [ ] Response does NOT contain `refresh_token`
- [ ] Provider-specific fields preserved in response

### Session Lifecycle

- [ ] Session marked as used BEFORE exchange attempt
- [ ] Session deleted after successful exchange
- [ ] `SESSION_ALREADY_USED` if already used
- [ ] `SESSION_EXPIRED` if timeout exceeded

### Error Handling

- [ ] Provider errors caught and returned as `EXCHANGE_FAILED`
- [ ] Session remains used on error (no replay)

### Semantic Behaviors

- [ ] MUST retrieve flowInstance from session
- [ ] MUST call exchangeCodeForToken()
- [ ] MUST store full token in tokenStore
- [ ] MUST sanitize response
- [ ] MUST mark session as used before exchange

---

## Deepthinker Critical Analysis (MANDATORY)

```markdown
## Deepthinker Prompt for Phase 05a

Launch deepthinker with this prompt:

"Verify handleOAuthExchange is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleOAuthExchange method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. FLOW INSTANCE RETRIEVAL:
   - Find where flowInstance is retrieved from session
   - Show me the EXACT line: `const flowInstance = session.flowInstance`
   - If flowInstance is hardcoded or created fresh, it's FAKE.

2. REAL PROVIDER CALL:
   - Show EXACT line where `exchangeCodeForToken()` is called
   - This must be `await flowInstance.exchangeCodeForToken(code)`
   - If result is hardcoded token, it's FAKE.

3. TOKEN STORAGE:
   - Show EXACT line where token is stored in backing store
   - This must be `await this.tokenStore.saveToken(provider, token, bucket)`
   - Token must be the RESULT of exchangeCodeForToken, not hardcoded

4. SANITIZATION:
   - Show where sanitizeTokenForProxy is called
   - Show that response uses sanitized token, not original

5. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   grep -c "oauthSessions.get\|exchangeCodeForToken\|tokenStore.saveToken\|sanitize" packages/cli/src/auth/proxy/credential-proxy-server.ts
   ```
   All 4 required behaviors MUST be present

6. NO HARDCODED TOKENS:
   ```bash
   grep -n "test_access_\|fake_\|placeholder" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
   ```
   Expected: 0 matches in actual code

RED FLAGS (automatic FAIL):
- Token created without calling exchangeCodeForToken
- flowInstance not retrieved from session
- Token not stored in tokenStore
- sanitizeTokenForProxy not called
- Hardcoded access_token value

YOUR VERDICT:
- PASS: Implementation is real, calls provider, stores token, sanitizes response
- FAIL: List specific fake patterns found"
```

---

## Evidence Collection

### Flow Instance Retrieval

```bash
$ grep -n "flowInstance" packages/cli/src/auth/proxy/credential-proxy-server.ts | head -10
[paste output showing retrieval from session]
```

### Provider Call

```bash
$ grep -n "exchangeCodeForToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing the call]
```

### Token Storage

```bash
$ grep -B 5 -A 5 "tokenStore.saveToken" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -A 5 -B 5 exchange
[paste output showing storage in handleOAuthExchange]
```

### Sanitization

```bash
$ grep -n "sanitizeTokenForProxy" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing usage]
```

### Line Count

```bash
$ sed -n '/private async handleOAuthExchange/,/^  private async handle/p' packages/cli/src/auth/proxy/credential-proxy-server.ts | wc -l
[paste count - must be >= 50]
```

### No Fake Patterns

```bash
$ grep -n "test_access_" packages/cli/src/auth/proxy/credential-proxy-server.ts
[should be empty]
```

### Test Results

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts 2>&1 | tail -10
[paste output showing all tests pass]
```

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| flowInstance retrieved | Yes | |
| exchangeCodeForToken called | Yes | |
| tokenStore.saveToken called | Yes | |
| sanitizeTokenForProxy called | Yes | |
| Semantic behaviors | All required | |
| No fake patterns | 0 matches | |
| Tests pass | All | |
| TypeScript compiles | Yes | |
| Deepthinker verdict | PASS | |

---

## Semantic Implementation Checks (Replaces Raw LOC)

Instead of just counting lines, verify these BEHAVIORS exist:

### handleOAuthExchange must have:
- [ ] Session lookup by session_id (`oauthSessions.get(sessionId)`)
- [ ] Session validation (exists, not used, not expired)
- [ ] Mark session as used BEFORE exchange (prevent replay)
- [ ] Call `flow.exchangeCodeForToken()` with request code
- [ ] Store FULL token in tokenStore (including refresh_token)
- [ ] Return SANITIZED token (no refresh_token)
- [ ] Clean up session after success
- [ ] Error handling for provider failures

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Implement handleOAuthExchange that calls real provider and stores token**
- Read the implementation. Does it ACTUALLY call `exchangeCodeForToken`?
- Would a user's problem be solved by this code? **Would a real auth code be exchanged for a real token?**

### B. Is This a Real Implementation?
- Trace the code path from entry to exit
- Does it call `flowInstance.exchangeCodeForToken()` or return hardcoded token?
- Does it store the actual result in tokenStore, or ignore it?
- Could this code work in production? **If the answer is "sort of", it FAILS**

### C. Did the Model Fake Anything?
- Look for code that ignores exchangeCodeForToken result
- Look for hardcoded tokens like `test_access_${sessionId}`
- Look for sanitization that just returns `{}` instead of real token
- Look for TODO comments indicating incomplete work

### D. Are There Serious Bugs or Issues?
- Race conditions in session marking (could both requests succeed)?
- Token storage order issues (response sent before storage)?
- Security issues (refresh_token leaked, code reusable)?
- Error handling missing or incomplete?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve it?
- Does this implementation feel complete and robust?
- Is this code you'd trust to handle real OAuth exchanges?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Holistic Functionality Assessment

### What was implemented?

[Describe what the code actually does based on reading it]

### Does it satisfy the requirements?

1. **Real provider call**: [Line where exchangeCodeForToken is called]
2. **Token storage**: [Line where saveToken is called]
3. **Sanitization**: [Line where sanitizeTokenForProxy is used]
4. **Session cleanup**: [Line where session is deleted]

### What is the data flow?

```
Request: { session_id: 'abc123', code: 'auth_code_from_browser' }
  -> handleOAuthExchange()
  -> oauthSessions.get(session_id) -> session with flowInstance
  -> flowInstance.exchangeCodeForToken(code) -> real provider call
  -> tokenStore.saveToken(provider, fullToken, bucket) -> store with refresh_token
  -> sanitizeTokenForProxy(token) -> strip refresh_token
  -> Response: { access_token, token_type, expiry } (no refresh_token)
```

### What could go wrong?

[List edge cases and integration risks]

### Verdict

[PASS/FAIL with explanation]

---

## Phase Completion

When all checks pass:

1. Create `.completed/P05.md` with evidence
2. Commit: `git commit -m "Phase 05: Implement handleOAuthExchange with real provider call"`
3. Proceed to Phase 06: Refresh Token TDD
ith real provider call"`
3. Proceed to Phase 06: Refresh Token TDD
