# Phase 07a: Refresh Token Implementation - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P07a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-07.sh

set -e
echo "=== Phase 07 Verification: Refresh Token Implementation ==="

PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"
TEST_FILE="packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts"

# 1. Check for fake patterns
echo ""
echo "1. Checking for fake patterns..."
# Look for refreshed_${Date.now()} or similar fake patterns
FAKE_MATCHES=$(grep -n "refreshed_.*Date\|'refreshed_'" "$PROXY_FILE" | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*" | wc -l || echo "0")
if [ "$FAKE_MATCHES" != "0" ]; then
  echo "FAIL: Found fake refresh pattern"
  grep -n "refreshed_" "$PROXY_FILE"
  exit 1
fi
echo "   [OK] No fake refresh patterns"

# 2. Check for RefreshCoordinator usage
echo ""
echo "2. Checking for RefreshCoordinator usage..."
if ! grep -q "refreshCoordinator.refresh\|refreshCoordinator\.refresh" "$PROXY_FILE"; then
  echo "FAIL: No RefreshCoordinator.refresh call found"
  exit 1
fi
echo "   [OK] RefreshCoordinator is used"

# 3. Check for provider refreshToken call
echo ""
echo "3. Checking for real provider call..."
if ! grep -q "refreshToken\|provider.*refresh" "$PROXY_FILE"; then
  echo "FAIL: No provider refreshToken call found"
  exit 1
fi
echo "   [OK] Provider refreshToken is called"

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

# 6. Check for RATE_LIMITED handling
echo ""
echo "6. Checking for rate limiting response..."
if ! grep -q "RATE_LIMITED\|rateLimited" "$PROXY_FILE"; then
  echo "FAIL: No rate limiting handling found"
  exit 1
fi
echo "   [OK] Rate limiting is handled"

# 7. Check for REFRESH_NOT_AVAILABLE
echo ""
echo "7. Checking for refresh_token validation..."
if ! grep -q "REFRESH_NOT_AVAILABLE" "$PROXY_FILE"; then
  echo "FAIL: No REFRESH_NOT_AVAILABLE error found"
  exit 1
fi
echo "   [OK] refresh_token validation present"

# 8. Semantic behavior check
echo ""
echo "8. Checking required semantic behaviors..."
BEHAVIORS=$(grep -c "RefreshCoordinator\|coordinator.*refresh\|refreshToken\|RATE_LIMITED" "$PROXY_FILE" || echo "0")
if [ "$BEHAVIORS" -lt 2 ]; then
  echo "FAIL: handleRefreshToken missing required behaviors (found $BEHAVIORS, need 2+)"
  exit 1
fi
echo "   [OK] handleRefreshToken has all required behaviors ($BEHAVIORS matches)"

# 9. TypeScript compilation
echo ""
echo "9. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 10. Tests pass
echo ""
echo "10. Running Phase 06 tests..."
npm test -- "$TEST_FILE" || {
  echo "FAIL: Refresh token tests failed"
  exit 1
}
echo "   [OK] All tests pass"

echo ""
echo "=== Phase 07 Verification PASSED ==="
```

---

## Manual Verification Checklist

### RefreshCoordinator Integration

- [ ] `refreshCoordinator` field added to class
- [ ] `handleRefreshToken` calls `this.refreshCoordinator.refresh()`
- [ ] Rate limiting result checked (`refreshResult.rateLimited`)
- [ ] `retryAfter` returned in RATE_LIMITED response

### Provider Integration

- [ ] `providers` map retrieved from options
- [ ] `oauthProvider.refreshToken()` called with refresh_token
- [ ] Call is wrapped in RefreshCoordinator callback

### Token Storage

- [ ] New token stored with `tokenStore.saveToken()`
- [ ] Old refresh_token preserved if new one not provided
- [ ] Storage happens AFTER successful refresh

### Sanitization

- [ ] `sanitizeTokenForProxy(newToken)` called
- [ ] Response does NOT contain `refresh_token`

### Error Handling

- [ ] `NOT_FOUND` when no token exists
- [ ] `REFRESH_NOT_AVAILABLE` when no refresh_token
- [ ] `RATE_LIMITED` with `retryAfter` when rate limited
- [ ] `REFRESH_FAILED` on provider error
- [ ] `REAUTH_REQUIRED` on auth errors (invalid_grant)

### Semantic Behaviors

- [ ] MUST use RefreshCoordinator.refresh()
- [ ] MUST call provider.refreshToken()
- [ ] MUST store new token in tokenStore
- [ ] MUST handle RATE_LIMITED with retryAfter
- [ ] MUST sanitize response

---

## Deepthinker Critical Analysis (MANDATORY)

```markdown
## Deepthinker Prompt for Phase 07a

Launch deepthinker with this prompt:

"Verify handleRefreshToken is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleRefreshToken method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. REFRESHCOORDINATOR USAGE:
   - Find where RefreshCoordinator.refresh() is called
   - Show me the EXACT line and callback
   - If refresh is called directly without coordinator, dedup won't work.

2. REAL PROVIDER CALL:
   - Show EXACT line where `provider.refreshToken()` is called
   - This must be inside the RefreshCoordinator callback
   - If result is hardcoded, it's FAKE.

3. RATE LIMITING:
   - Show where rateLimited result is checked
   - Show where RATE_LIMITED error is sent with retryAfter
   - If rate limiting is not handled, it's INCOMPLETE.

4. TOKEN STORAGE:
   - Show EXACT line where token is stored in backing store
   - Show that refresh_token is preserved
   - Token must be the RESULT of provider call, not hardcoded

5. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   grep -c "RefreshCoordinator\|refreshToken\|RATE_LIMITED\|tokenStore.saveToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
   ```
   All 4 required behaviors MUST be present

6. NO HARDCODED TOKENS:
   ```bash
   grep -n "refreshed_\|Date.now()" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i refresh | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
   ```
   Expected: 0 matches in actual code

RED FLAGS (automatic FAIL):
- No RefreshCoordinator usage
- Hardcoded access_token like refreshed_${Date.now()}
- Provider.refreshToken not called
- Rate limiting not handled
- Token not stored in tokenStore

YOUR VERDICT:
- PASS: Implementation uses RefreshCoordinator, calls real provider, handles rate limiting
- FAIL: List specific fake patterns found"
```

---

## Evidence Collection

### RefreshCoordinator Usage

```bash
$ grep -n "refreshCoordinator" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing usage]
```

### Provider Call

```bash
$ grep -B 5 -A 5 "refreshToken" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -A 5 -B 5 provider
[paste output showing provider call inside coordinator]
```

### Rate Limiting

```bash
$ grep -n "RATE_LIMITED\|rateLimited\|retryAfter" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output showing rate limit handling]
```

### Token Storage

```bash
$ grep -B 5 -A 5 "tokenStore.saveToken" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -A 5 -B 5 refresh
[paste output showing storage in handleRefreshToken]
```

### Line Count

```bash
$ sed -n '/private async handleRefreshToken/,/^  private/p' packages/cli/src/auth/proxy/credential-proxy-server.ts | wc -l
[paste count - must be >= 40]
```

### No Fake Patterns

```bash
$ grep -n "refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts
[should be empty or only in comments]
```

### Test Results

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts 2>&1 | tail -10
[paste output showing all tests pass]
```

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| RefreshCoordinator used | Yes | |
| provider.refreshToken called | Yes | |
| Rate limiting handled | Yes | |
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

### handleRefreshToken must have:
- [ ] Get existing token from tokenStore (`tokenStore.getToken(provider, bucket)`)
- [ ] Verify refresh_token exists (return REFRESH_NOT_AVAILABLE if not)
- [ ] Call `RefreshCoordinator.refresh()` with callback
- [ ] Inside callback: call `provider.refreshToken(refresh_token)`
- [ ] Handle rate limiting (RATE_LIMITED response with retryAfter)
- [ ] Handle deduplication (return cached result if concurrent)
- [ ] Merge new token with existing refresh_token if not provided
- [ ] Store new token in tokenStore
- [ ] Return sanitized token (no refresh_token)
- [ ] Error handling for provider failures

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Implement handleRefreshToken using RefreshCoordinator for rate limiting and deduplication**
- Read the implementation. Does it ACTUALLY use RefreshCoordinator?
- Would a user's problem be solved by this code? **Would a real token be refreshed?**

### B. Is This a Real Implementation?
- Trace the code path from entry to exit
- Does it call `provider.refreshToken()` with real refresh_token or ignore it?
- Does it store the RESULT in tokenStore, or a hardcoded value?
- Could this code work in production? **If it returns refreshed_${Date.now()}, it's FAKE**

### C. Did the Model Fake Anything?
- Look for code that ignores provider.refreshToken result
- Look for hardcoded tokens like `refreshed_${Date.now()}`
- Look for RefreshCoordinator used but callback doesn't call provider
- Look for rate limiting "handled" but always returns success

### D. Are There Serious Bugs or Issues?
- Race conditions in token storage?
- refresh_token lost when new token doesn't include one?
- Rate limiting cooldown implemented correctly (30s)?
- Deduplication actually working (or just sequential)?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve it?
- Does this implementation feel complete and robust?
- Is this code you'd trust to handle real token refreshes?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Holistic Functionality Assessment

### What was implemented?

[Describe what the code actually does based on reading it]

### Does it satisfy the requirements?

1. **RefreshCoordinator**: [Where is it used? Line number?]
2. **Real provider call**: [Line where refreshToken is called]
3. **Rate limiting**: [Lines where RATE_LIMITED is handled]
4. **Token storage**: [Line where saveToken is called]

### What is the data flow?

```
Request: { provider: 'anthropic', bucket: 'default' }
  -> handleRefreshToken()
  -> tokenStore.getToken() -> get existing token with refresh_token
  -> refreshCoordinator.refresh() -> check rate limit, dedup
    -> oauthProvider.refreshToken(existingToken.refresh_token) -> real provider call
  -> tokenStore.saveToken(provider, newToken, bucket) -> store with refresh_token
  -> sanitizeTokenForProxy(newToken) -> strip refresh_token
  -> Response: { access_token, token_type, expiry } (no refresh_token)
```

### What could go wrong?

[List edge cases and integration risks]

### Verdict

[PASS/FAIL with explanation]

---

## Phase Completion

When all checks pass:

1. Create `.completed/P07.md` with evidence
2. Commit: `git commit -m "Phase 07: Implement handleRefreshToken with RefreshCoordinator"`
3. Proceed to Phase 08: Integration Wiring
