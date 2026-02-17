# Phase 04e: OAuth Poll Implementation Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P04e`

## Purpose

Verify that `handleOAuthPoll` is a **real** implementation, not a differently-shaped fake.

---

## Prerequisites

- Phase 04d completed (oauth_poll implementation written)
- Tests pass

---

## Automated Verification

### 1. Semantic Behavior Check

```bash
echo "Checking required semantic behaviors..."

# Must handle session retrieval
if grep -q "oauthSessions.get\|sessions.get" packages/cli/src/auth/proxy/credential-proxy-server.ts; then
  echo "[PASS] Session retrieval present"
else
  echo "[FAIL] Session retrieval NOT found!"
  exit 1
fi

# Must handle token storage on completion
if grep -A50 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "tokenStore.saveToken"; then
  echo "[PASS] Token storage on completion present"
else
  echo "[FAIL] Token storage on completion NOT found!"
  exit 1
fi

# Must handle session cleanup/marking
if grep -A50 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "session.used\|used.*true"; then
  echo "[PASS] Session lifecycle management present"
else
  echo "[FAIL] Session lifecycle management NOT found!"
  exit 1
fi
```

### 2. Fake Pattern Detection

```bash
echo "Checking for fake patterns..."

# Hardcoded tokens
grep -n "test_access_\|fake_\|dummy_\|placeholder" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -vi "^[0-9]*:.*//\|^[0-9]*:.*\*" | grep -i poll
if [ $? -eq 0 ]; then
  echo "[FAIL] Hardcoded token patterns found!"
  exit 1
else
  echo "[PASS] No hardcoded token patterns"
fi

# TODO admissions
grep -n "TODO.*real\|TODO.*actual\|In real implementation\|for testing\|simulate" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -vi "^[0-9]*:.*//\|^[0-9]*:.*\*" | grep -i poll
if [ $? -eq 0 ]; then
  echo "[FAIL] TODO/fake admissions found!"
  exit 1
else
  echo "[PASS] No TODO/fake admissions"
fi

# "will be" future promises
grep -n "will be\|should be\|would be" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -vi "^[0-9]*:.*//\|^[0-9]*:.*\*\|test" | grep -i poll
if [ $? -eq 0 ]; then
  echo "[WARN] Possible future promise language found - verify manually"
else
  echo "[PASS] No future promise language"
fi
```

### 3. Real Implementation Verification

```bash
echo "Checking for real implementation patterns..."

# Must call pollForToken
grep -q "pollForToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
if [ $? -eq 0 ]; then
  echo "[PASS] pollForToken call present"
else
  echo "[FAIL] pollForToken call NOT found - implementation is fake!"
  exit 1
fi

# Must handle authorization_pending
grep -q "authorization_pending" packages/cli/src/auth/proxy/credential-proxy-server.ts
if [ $? -eq 0 ]; then
  echo "[PASS] authorization_pending handling present"
else
  echo "[FAIL] authorization_pending handling NOT found!"
  exit 1
fi

# Must handle slow_down
grep -q "slow_down" packages/cli/src/auth/proxy/credential-proxy-server.ts
if [ $? -eq 0 ]; then
  echo "[PASS] slow_down handling present"
else
  echo "[FAIL] slow_down handling NOT found!"
  exit 1
fi

# Must call tokenStore.saveToken
grep -A50 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "tokenStore.saveToken\|this.options.tokenStore.saveToken"
if [ $? -eq 0 ]; then
  echo "[PASS] tokenStore.saveToken call present"
else
  echo "[FAIL] tokenStore.saveToken call NOT found - tokens not being stored!"
  exit 1
fi

# Must sanitize token
grep -A50 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "sanitizeToken\|refresh_token.*undefined\|{ refresh_token"
if [ $? -eq 0 ]; then
  echo "[PASS] Token sanitization present"
else
  echo "[WARN] Token sanitization pattern not clearly found - verify manually"
fi
```

### 4. Test Passage Check

```bash
echo "Running tests..."

npm test -- packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[PASS] All tests pass"
else
  echo "[FAIL] Tests do not pass"
  exit 1
fi
```

---

## Manual Verification Checklist

### Implementation Review

- [ ] **Session retrieval**
  - [ ] Retrieves session by session_id
  - [ ] Returns SESSION_NOT_FOUND for missing session
  - [ ] Returns SESSION_ALREADY_USED for completed session
  - [ ] Returns SESSION_EXPIRED for timed-out session

- [ ] **Poll execution**
  - [ ] Calls flowInstance.pollForToken(deviceCode)
  - [ ] Uses deviceCode from session (not from request)
  - [ ] Handles authorization_pending -> returns pending status
  - [ ] Handles slow_down -> returns pending with increased interval

- [ ] **Token handling on success**
  - [ ] Marks session.used = true BEFORE storing
  - [ ] Calls tokenStore.saveToken with FULL token
  - [ ] Saves to correct provider and bucket
  - [ ] Returns SANITIZED token (no refresh_token)
  - [ ] Deletes session after completion

- [ ] **Error handling**
  - [ ] Handles expired_token -> SESSION_EXPIRED
  - [ ] Handles access_denied -> ACCESS_DENIED
  - [ ] Handles unexpected errors gracefully

### Security Review

- [ ] **refresh_token never in response**
  - [ ] sanitizeTokenForProxy removes refresh_token
  - [ ] Response only contains access_token, token_type, expiry

- [ ] **Session protection**
  - [ ] Session marked used before async storage operation
  - [ ] Double-poll returns SESSION_ALREADY_USED
  - [ ] Session cleaned up after completion

---

## Deepthinker Verification

Launch deepthinker with the prompt from `verification-prompts.md` Phase 04e.

### Deepthinker Must Confirm

1. [ ] pollForToken is called with deviceCode from session
2. [ ] Token is stored in tokenStore.saveToken()
3. [ ] Response token is sanitized (no refresh_token)
4. [ ] authorization_pending returns pending status
5. [ ] slow_down increases interval
6. [ ] Session is consumed after completion
7. [ ] No hardcoded/fake tokens
8. [ ] All required semantic behaviors present

---

## Red Flags (Automatic FAIL)

- [ ] No pollForToken() call
- [ ] Immediately returns token without polling
- [ ] Hardcoded access_token values
- [ ] refresh_token in response
- [ ] Token not stored in tokenStore
- [ ] Tests fail
- [ ] Less than 30 LOC

---

## Semantic Implementation Checks (Replaces Raw LOC)

Instead of just counting lines, verify these BEHAVIORS exist:

### handleOAuthPoll must have:
- [ ] Session lookup by session_id (`oauthSessions.get(sessionId)`)
- [ ] Session validation (exists, not used, not expired, is device_code flow)
- [ ] Call `flow.pollForToken()` with deviceCode from session
- [ ] Handle 'authorization_pending' -> return `{ status: 'pending' }`
- [ ] Handle 'slow_down' -> return `{ status: 'pending', interval: increased }`
- [ ] Handle success -> mark session used BEFORE storage
- [ ] Store FULL token in tokenStore (including refresh_token)
- [ ] Return SANITIZED token (no refresh_token)
- [ ] Clean up session after success
- [ ] Handle access_denied, expired_token errors appropriately

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Implement handleOAuthPoll that actually polls providers**
- Read the implementation. Does it ACTUALLY poll (call `pollForToken`)?
- Would a user's problem be solved by this code? **Would polling work with real device_code flows?**

### B. Is This a Real Implementation?
- Trace the code path from entry to exit
- Does it call `flowInstance.pollForToken()` or something fake?
- Does it handle `authorization_pending` by returning pending status?
- Does it only store token and return complete when provider says complete?
- Could this code work in production? **If it ignores poll errors and always returns a token, it FAILS**

### C. Did the Model Fake Anything?
- Look for code that ignores pollForToken result and returns hardcoded token
- Look for catch blocks that swallow errors and return success
- Look for `status: 'complete'` returned without actually completing
- Look for token storage happening before poll completion
- Look for TODO/FIXME comments indicating incomplete work

### D. Are There Serious Bugs or Issues?
- Race conditions in session validation?
- Resource leaks (sessions never cleaned up)?
- Security issues (refresh_token in response, deviceCode guessable)?
- Error handling missing (what if pollForToken throws non-standard error)?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve it?
- Does this polling implementation feel complete and robust?
- Is this code you'd trust to handle real OAuth device flows?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria

All of the following must be true:

1. [ ] 30+ meaningful lines of code
2. [ ] pollForToken call with deviceCode from session
3. [ ] authorization_pending -> pending status
4. [ ] slow_down -> pending with increased interval
5. [ ] Token stored in tokenStore on success
6. [ ] Response sanitized (no refresh_token)
7. [ ] Session consumed after completion
8. [ ] All tests pass
9. [ ] No fake patterns
10. [ ] All semantic implementation checks pass
11. [ ] Holistic verification passed
12. [ ] Deepthinker PASS verdict

---

## Failure Actions

If verification fails:

1. **LOC too low**: Implementation is probably a stub; add real logic
2. **Fake patterns found**: Replace with real provider calls
3. **pollForToken not called**: Add real polling logic
4. **Tests fail**: Fix implementation to match test requirements
5. **Deepthinker FAIL**: Address specific issues identified

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P04e.md` with:

```markdown
# Phase 04e Complete

Verified: [timestamp]

## Automated Checks
- [ ] Semantic behaviors: PASS/FAIL (all required present)
- [ ] No fake patterns: PASS/FAIL
- [ ] pollForToken call: PASS/FAIL
- [ ] authorization_pending handling: PASS/FAIL
- [ ] slow_down handling: PASS/FAIL
- [ ] tokenStore.saveToken call: PASS/FAIL
- [ ] All tests pass: PASS/FAIL

## Deepthinker Verdict
[PASS/FAIL and summary]

## Evidence
[Link to test output or paste relevant sections]
```
