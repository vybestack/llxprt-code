# Phase 04a: OAuth Exchange TDD - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P04a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-04.sh

set -e
echo "=== Phase 04 Verification: OAuth Exchange TDD ==="

TEST_FILE="packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts"

# 1. Check test file exists
echo ""
echo "1. Checking test file exists..."
if [ ! -f "$TEST_FILE" ]; then
  echo "FAIL: Test file not found: $TEST_FILE"
  exit 1
fi
echo "   [OK] Test file exists"

# 2. Check for mock theater
echo ""
echo "2. Checking for mock theater..."
MOCK_CALLS=$(grep -c "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue" "$TEST_FILE" || echo "0")
if [ "$MOCK_CALLS" != "0" ]; then
  echo "FAIL: Mock theater found ($MOCK_CALLS instances)"
  grep -n "toHaveBeenCalled\|toHaveBeenCalledWith\|mockReturnValue" "$TEST_FILE"
  exit 1
fi
echo "   [OK] No mock theater"

# 3. Check for backing store verification
echo ""
echo "3. Checking for backing store verification..."
STORE_CHECKS=$(grep -c "backingStore.getToken" "$TEST_FILE" || echo "0")
if [ "$STORE_CHECKS" -lt 3 ]; then
  echo "FAIL: Insufficient backingStore verification (found $STORE_CHECKS)"
  exit 1
fi
echo "   [OK] Backing store verification present ($STORE_CHECKS checks)"

# 4. Check for refresh_token sanitization tests
echo ""
echo "4. Checking for refresh_token sanitization tests..."
SANITIZE_TESTS=$(grep -c "refresh_token.*toBeUndefined\|refresh_token.*toBe\|MUST_NOT_APPEAR\|MUST_BE_IN" "$TEST_FILE" || echo "0")
if [ "$SANITIZE_TESTS" -lt 2 ]; then
  echo "FAIL: Insufficient refresh_token sanitization tests (found $SANITIZE_TESTS)"
  exit 1
fi
echo "   [OK] Sanitization tests present ($SANITIZE_TESTS tests)"

# 5. Check for session lifecycle tests
echo ""
echo "5. Checking for session lifecycle tests..."
SESSION_TESTS=$(grep -c "SESSION_ALREADY_USED\|SESSION_NOT_FOUND\|SESSION_EXPIRED" "$TEST_FILE" || echo "0")
if [ "$SESSION_TESTS" -lt 3 ]; then
  echo "FAIL: Insufficient session lifecycle tests (found $SESSION_TESTS)"
  exit 1
fi
echo "   [OK] Session lifecycle tests present ($SESSION_TESTS tests)"

# 6. Check for TestOAuthFlow usage
echo ""
echo "6. Checking for controllable test flows..."
if ! grep -q "TestOAuthFlow\|setExchangeResult\|getExchangeCount" "$TEST_FILE"; then
  echo "FAIL: Should use controllable test flows, not mocks"
  exit 1
fi
echo "   [OK] Controllable test flows used"

# 7. TypeScript compilation
echo ""
echo "7. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 8. Tests SHOULD FAIL against NOT_IMPLEMENTED
echo ""
echo "8. Verifying tests fail against NOT_IMPLEMENTED stub..."
if npm test -- "$TEST_FILE" 2>/dev/null; then
  echo "FAIL: Tests passed but handleOAuthExchange is NOT_IMPLEMENTED - this is mock theater!"
  exit 1
fi
echo "   [OK] Tests fail against stub (expected behavior)"

echo ""
echo "=== Phase 04 Verification PASSED ==="
echo "Tests are correctly failing against NOT_IMPLEMENTED stub."
echo "Proceed to Phase 05 to implement handleOAuthExchange."
```

---

## Manual Verification Checklist

### Test File Structure

- [ ] File exists: `packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts`
- [ ] Uses `InMemoryTokenStore` (not mocks)
- [ ] Uses `TestOAuthFlow` controllable test double
- [ ] Has `beforeEach`/`afterEach` for server/client setup/teardown

### Token Storage Tests

- [ ] Test: token stored in backingStore after exchange
- [ ] Test: token stored with correct bucket
- [ ] Test: provider-specific fields preserved

### Sanitization Tests

- [ ] Test: response does NOT contain `refresh_token`
- [ ] Test: backingStore DOES contain `refresh_token`
- [ ] Test: provider-specific fields preserved in response

### Session Lifecycle Tests

- [ ] Test: session consumed after successful exchange
- [ ] Test: second exchange returns `SESSION_ALREADY_USED`
- [ ] Test: invalid session returns `SESSION_NOT_FOUND`
- [ ] Test: expired session returns `SESSION_EXPIRED`

### Provider Call Tests

- [ ] Test: `exchangeCodeForToken` called with correct code
- [ ] Test: provider error propagates as `EXCHANGE_FAILED`

### Validation Tests

- [ ] Test: missing session_id returns `INVALID_REQUEST`
- [ ] Test: missing code returns `INVALID_REQUEST`

### Anti-Mock-Theater Verification

```bash
# Run this command - must return 0 matches
grep -c "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
```

### Stub-Fail Verification

```bash
# Tests must FAIL against NOT_IMPLEMENTED
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
# Expected: FAIL
```

---

## Deepthinker Critical Analysis

```markdown
## Deepthinker Prompt for Phase 04a

Launch deepthinker with this prompt:

"Verify that TDD tests for handleOAuthExchange are REAL behavioral tests, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts

VERIFY THESE REQUIREMENTS:

1. TOKEN STORAGE VERIFICATION:
   - [ ] Test reads from backingStore.getToken() after exchange
   - [ ] Test verifies access_token value in backing store
   - [ ] Test verifies correct provider and bucket
   Show me the EXACT assertions using backingStore.

2. REFRESH_TOKEN SANITIZATION:
   - [ ] Test that response.data.refresh_token is undefined
   - [ ] Test that backingStore token HAS refresh_token
   - [ ] These must be DIFFERENT tests or assertions
   Show me both assertions.

3. SESSION SINGLE-USE:
   - [ ] Test that second exchange fails
   - [ ] Test that error code is SESSION_ALREADY_USED
   Show me the test.

4. CONTROLLABLE TEST DOUBLE:
   - Is TestOAuthFlow used instead of vi.fn() mocks?
   - Does testFlow.setExchangeResult() control the token returned?
   - Does testFlow.getExchangeCount() verify provider was called?
   Show me how controllable test double is used.

5. ANTI-MOCK-THEATER CHECK:
   ```bash
   grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
   ```
   Expected: 0 matches

6. STUB-FAIL VERIFICATION:
   Would these tests PASS against:
   ```typescript
   const token: OAuthToken = {
     access_token: 'test_access_' + sessionId,
     token_type: 'Bearer',
     expiry: Math.floor(Date.now() / 1000) + 3600,
   };
   ```
   They MUST fail against this fake (wrong access_token value).

YOUR VERDICT:
- PASS: Tests verify backing store, sanitization, session lifecycle, no mock theater
- FAIL: List specific issues"
```

---

## Evidence Collection

### Test Count

```bash
$ grep -c "it(" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
[paste count - should be ~12]
```

### Mock Theater Check

```bash
$ grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
[should be empty]
```

### Backing Store Verification

```bash
$ grep -n "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
[paste output showing multiple state checks]
```

### Sanitization Tests

```bash
$ grep -n "refresh_token" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
[paste output showing both response check and store check]
```

### Session Lifecycle Tests

```bash
$ grep -n "SESSION_ALREADY_USED\|SESSION_NOT_FOUND\|SESSION_EXPIRED" packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
[paste output showing all three]
```

### Stub-Fail Result

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts 2>&1 | tail -20
[paste output showing tests FAIL]
```

---

## Additional Tests Required (Deepthinker Recommendations)

### Argument-Capture Assertions

Add these tests to verify correct arguments are passed to provider:

```typescript
### Test: Exchange passes correct code to provider
- Capture the `code` argument passed to `flow.exchangeCodeForToken()`
- Assert it exactly matches the code from the request
- NOT using toHaveBeenCalledWith - use a capturing test double

### Test: Exchange passes correct state to provider  
- Capture the `state` argument
- Assert it matches the state from initiate response (for PKCE flows)
```

### Unpredictable Token Tests (Anti-Fake)

```typescript
### Test: Tokens are unpredictable (anti-fake)
- Generate a random nonce for this test run
- Configure test flow to return token containing this nonce
- Verify response contains the nonce
- This catches hardcoded tokens because nonce changes each run
```

### Concurrency Race Tests

```typescript
### Test: Concurrent exchange - only one succeeds
- Initiate OAuth session
- Simultaneously call exchange twice with same session_id
- Exactly ONE should succeed with token
- Exactly ONE should fail with SESSION_ALREADY_USED
- No race condition where both succeed

### Test: Concurrent exchange - no token duplication
- After concurrent exchange attempts
- backingStore should have exactly ONE token entry
- Not two entries from race condition
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Write behavioral TDD tests for handleOAuthExchange**
- Read the tests. Do they ACTUALLY test real behavior?
- Would these tests catch a fake implementation returning `test_access_${sessionId}`?

### B. Is This a Real Implementation?
- Trace each test from setup to assertion
- Do tests verify backingStore state, not just response shape?
- Do tests use controllable test doubles, not vi.fn() mocks?
- Could these tests pass against hardcoded token generation? **They should NOT**

### C. Did the Model Fake Anything?
- Look for tests that only check `.toBeDefined()` without specific values
- Look for tests that don't verify the actual token from provider is stored
- Look for tests where assertions are so loose they'd pass against anything

### D. Are There Serious Bugs or Issues?
- Do tests verify refresh_token is stripped from response AND stored in backingStore?
- Do tests verify session single-use semantics?
- Are there race condition tests for concurrent exchange attempts?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve these tests?
- Do these tests give you confidence the implementation will be correct?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| Test file exists | Yes | |
| Test count | ~15 (including new tests) | |
| Mock theater (toHaveBeenCalled) | 0 | |
| backingStore.getToken checks | 3+ | |
| refresh_token sanitization tests | 2+ | |
| Session lifecycle tests | 3+ | |
| Argument-capture tests | 2+ | |
| Unpredictable token tests | 1+ | |
| Concurrency race tests | 2+ | |
| Tests fail against stub | Yes | |
| TypeScript compiles | Yes | |
| Deepthinker verdict | PASS | |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P04.md` with evidence
2. Commit: `git commit -m "Phase 04: OAuth exchange TDD tests"`
3. Proceed to Phase 05: OAuth Exchange Implementation
