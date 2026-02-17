# Phase 04c: OAuth Poll TDD Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P04c`

## Purpose

Verify that the TDD tests for `handleOAuthPoll` are:
1. **Behavioral** - verify state changes, not mock calls
2. **Anti-fake** - would fail against hardcoded/stub implementations
3. **Complete** - cover all polling scenarios

---

## Prerequisites

- Phase 04b completed (oauth_poll tests written)

---

## Automated Verification

### 1. Tests Fail Against Stub

```bash
# Ensure handleOAuthPoll throws NOT_IMPLEMENTED
grep -A2 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "NOT_IMPLEMENTED"
if [ $? -eq 0 ]; then
  echo "[OK] Handler is stubbed with NOT_IMPLEMENTED"
else
  echo " Handler may already be implemented - verify manually"
fi

# Run tests - they MUST fail
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts 2>&1 | tee /tmp/poll-test-output.txt
if grep -q "FAIL\|failed" /tmp/poll-test-output.txt; then
  echo "[OK] Tests fail against NOT_IMPLEMENTED stub (as expected)"
else
  echo " CRITICAL: Tests pass against stub - tests are mock theater!"
  exit 1
fi
```

### 2. Anti-Mock-Theater Check

```bash
# Check for mock theater patterns
echo "Checking for mock theater patterns..."

grep -n "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue\|jest.fn" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo " CRITICAL: Mock theater patterns found!"
  exit 1
else
  echo "[OK] No mock theater patterns"
fi
```

### 3. State Verification Check

```bash
# Tests MUST verify backing store state
echo "Checking for state verification..."

STORE_CHECKS=$(grep -c "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts)
if [ "$STORE_CHECKS" -ge 4 ]; then
  echo "[OK] Tests verify backing store state ($STORE_CHECKS checks)"
else
  echo " Insufficient backing store verification (only $STORE_CHECKS checks, need ≥4)"
  exit 1
fi
```

### 4. Polling-Specific Tests

```bash
# Tests MUST cover polling-specific scenarios
echo "Checking for polling-specific test coverage..."

# Pending status
grep -q "status.*pending\|pending.*status" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[OK] Pending status tests present"
else
  echo " Missing pending status tests"
  exit 1
fi

# Multiple polls
grep -q "poll multiple\|multiple.*poll\|poll1.*poll2\|poll2.*poll3" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[OK] Multiple polling tests present"
else
  echo " Missing multiple polling tests"
  exit 1
fi

# Slow down handling
grep -q "slow_down\|interval.*increase\|newInterval" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[OK] Slow down handling tests present"
else
  echo " Missing slow down handling tests"
  exit 1
fi
```

### 5. Security Tests

```bash
# Tests MUST verify refresh_token sanitization
echo "Checking security test coverage..."

grep -q "MUST_NOT_APPEAR_IN_RESPONSE\|refresh_token.*toBeUndefined" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[OK] Refresh token sanitization tests present"
else
  echo " Missing refresh token sanitization tests"
  exit 1
fi

grep -q "MUST_BE_IN_BACKING_STORE\|stored.*refresh_token" packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
if [ $? -eq 0 ]; then
  echo "[OK] Refresh token preservation tests present"
else
  echo " Missing refresh token preservation tests"
  exit 1
fi
```

---

## Manual Verification Checklist

### Test Categories Present

- [ ] **Pending status tests**
  - [ ] Returns pending when provider says authorization_pending
  - [ ] Returns pending with increased interval on slow_down
  - [ ] Backing store has NO token while pending

- [ ] **Completion tests**
  - [ ] Returns token when provider returns success
  - [ ] Stores token in backing store on completion
  - [ ] Returns token after multiple pending polls

- [ ] **Sanitization tests**
  - [ ] Response does NOT contain refresh_token
  - [ ] Backing store DOES contain refresh_token

- [ ] **Session lifecycle tests**
  - [ ] Session consumed after successful completion
  - [ ] Can poll multiple times while pending
  - [ ] Invalid session returns SESSION_NOT_FOUND
  - [ ] Expired session returns SESSION_EXPIRED

- [ ] **Provider integration tests**
  - [ ] Calls flow.pollForToken with device_code
  - [ ] ACCESS_DENIED error propagation
  - [ ] expired_token error propagation

- [ ] **Validation tests**
  - [ ] Missing session_id returns INVALID_REQUEST

- [ ] **Bucket handling tests**
  - [ ] Token stored with correct bucket

### Test Quality

- [ ] **Tests use controllable test doubles, not mocks**
  - TestDeviceCodeFlow class has real methods
  - Methods return configurable but verifiable values
  - pollCount and lastPolledDeviceCode are observable

- [ ] **Tests verify final state, not intermediate calls**
  - Assert on backingStore.getToken() results
  - Assert on response structure
  - Don't assert on "was this function called"

- [ ] **Tests would catch fake implementations**
  - If handleOAuthPoll immediately returned a token, tests would fail
  - If handleOAuthPoll didn't store in backingStore, tests would fail
  - If handleOAuthPoll included refresh_token in response, tests would fail

---

## Deepthinker Verification

Launch deepthinker with the prompt from `verification-prompts.md` Phase 04c.

### Deepthinker Must Confirm

1. [ ] Tests are behavioral, not mock theater
2. [ ] Tests verify backing store state
3. [ ] Tests would fail against fake "always return token" implementation
4. [ ] Tests cover pending → pending → complete scenario
5. [ ] Tests verify refresh_token never crosses socket boundary
6. [ ] Test doubles are controllable real classes, not jest.fn()

---

## Canonical oauth_poll Response Schema

Ensure tests verify these exact response shapes:

### oauth_poll Response (pending)
```typescript
{
  ok: true,
  data: {
    status: 'pending',
    interval?: number  // seconds to wait before next poll (if slow_down)
  }
}
```

### oauth_poll Response (complete)
```typescript
{
  ok: true,
  data: {
    status: 'complete',
    token: {
      access_token: string,
      token_type: 'Bearer',
      expiry: number,
      // NO refresh_token - stripped by sanitization
    }
  }
}
```

---

## Additional Tests Required (Deepthinker Recommendations)

### Argument-Capture Assertions

```typescript
### Test: Poll passes correct device_code to provider
- Capture the `deviceCode` argument passed to `flow.pollForToken()`
- Assert it exactly matches the deviceCode from session (NOT from request)
- NOT using toHaveBeenCalledWith - use a capturing test double
```

### Unpredictable Token Tests (Anti-Fake)

```typescript
### Test: Poll tokens are unpredictable (anti-fake)
- Generate a random nonce for this test run
- Configure test flow to return token containing this nonce on completion
- Verify response token contains the nonce
- This catches hardcoded tokens because nonce changes each run
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Write behavioral TDD tests for handleOAuthPoll**
- Read the tests. Do they ACTUALLY test polling behavior (pending → pending → complete)?
- Would these tests catch an implementation that immediately returns a token?

### B. Is This a Real Implementation?
- Trace each test from setup to assertion
- Do tests verify backingStore has NO token while pending, and HAS token after complete?
- Do tests use controllable test doubles with configurable poll sequences?
- Could these tests pass against `return { status: 'complete', token: {...} }` on first call? **They should NOT**

### C. Did the Model Fake Anything?
- Look for tests that don't verify "pending" status actually returns pending
- Look for tests that don't verify backingStore is empty while pending
- Look for tests where assertions would pass regardless of poll count

### D. Are There Serious Bugs or Issues?
- Do tests verify the multi-poll scenario (pending → pending → complete)?
- Do tests verify slow_down handling increases interval?
- Do tests verify session is consumed ONLY after completion?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve these tests?
- Do these tests give you confidence the polling implementation will be correct?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria

All of the following must be true:

1. [ ] Tests fail against NOT_IMPLEMENTED stub
2. [ ] Zero mock theater patterns
3. [ ] At least 4 backing store verifications
4. [ ] Pending status tests present
5. [ ] Multiple polling tests present (pending → pending → complete)
6. [ ] Slow down handling tests present
7. [ ] Refresh token sanitization verified
8. [ ] Argument-capture tests present
9. [ ] Unpredictable token tests present
10. [ ] Canonical response schema verified
11. [ ] Deepthinker PASS verdict

---

## Failure Actions

If verification fails:

1. **Mock theater found**: Rewrite tests to verify state, not calls
2. **Tests pass against stub**: Tests are not behavioral; add assertions on backingStore
3. **Missing test coverage**: Add missing test categories
4. **Deepthinker FAIL**: Address specific issues identified

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P04c.md` with:

```markdown
# Phase 04c Complete

Verified: [timestamp]

## Automated Checks
- [ ] Tests fail against stub: PASS/FAIL
- [ ] No mock theater: PASS/FAIL
- [ ] State verification present: PASS/FAIL
- [ ] Polling tests present: PASS/FAIL
- [ ] Security tests present: PASS/FAIL

## Deepthinker Verdict
[PASS/FAIL and summary]

## Evidence
[Link to test output or paste relevant sections]
```
