# Phase 06a: Refresh Token TDD - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P06a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-06.sh

set -e
echo "=== Phase 06 Verification: Refresh Token TDD ==="

TEST_FILE="packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts"

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
if [ "$STORE_CHECKS" -lt 2 ]; then
  echo "FAIL: Insufficient backingStore verification (found $STORE_CHECKS)"
  exit 1
fi
echo "   [OK] Backing store verification present ($STORE_CHECKS checks)"

# 4. Check for rate limiting tests
echo ""
echo "4. Checking for rate limiting tests..."
RATE_TESTS=$(grep -c "RATE_LIMITED\|retryAfter\|30s cooldown" "$TEST_FILE" || echo "0")
if [ "$RATE_TESTS" -lt 2 ]; then
  echo "FAIL: Insufficient rate limiting tests (found $RATE_TESTS)"
  exit 1
fi
echo "   [OK] Rate limiting tests present ($RATE_TESTS references)"

# 5. Check for deduplication tests
echo ""
echo "5. Checking for deduplication tests..."
if ! grep -q "dedupl\|concurrent" "$TEST_FILE"; then
  echo "FAIL: No deduplication tests found"
  exit 1
fi
echo "   [OK] Deduplication tests present"

# 6. Check for error handling tests
echo ""
echo "6. Checking for error handling tests..."
ERROR_TESTS=$(grep -c "NOT_FOUND\|REFRESH_NOT_AVAILABLE\|REFRESH_FAILED" "$TEST_FILE" || echo "0")
if [ "$ERROR_TESTS" -lt 3 ]; then
  echo "FAIL: Insufficient error handling tests (found $ERROR_TESTS)"
  exit 1
fi
echo "   [OK] Error handling tests present ($ERROR_TESTS tests)"

# 7. Check for controllable test provider
echo ""
echo "7. Checking for controllable test provider..."
if ! grep -q "TestOAuthProvider\|setRefreshResult\|getRefreshCount" "$TEST_FILE"; then
  echo "FAIL: Should use controllable test provider, not mocks"
  exit 1
fi
echo "   [OK] Controllable test provider used"

# 8. TypeScript compilation
echo ""
echo "8. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 9. Tests SHOULD FAIL against fake implementation
echo ""
echo "9. Verifying tests fail against fake implementation..."
# The current fake impl returns refreshed_${Date.now()} which won't match expected tokens
if npm test -- "$TEST_FILE" 2>/dev/null; then
  echo "FAIL: Tests passed but handleRefreshToken is fake - this is mock theater!"
  exit 1
fi
echo "   [OK] Tests fail against fake (expected behavior)"

echo ""
echo "=== Phase 06 Verification PASSED ==="
echo "Tests are correctly failing against fake implementation."
echo "Proceed to Phase 07 to implement handleRefreshToken."
```

---

## Manual Verification Checklist

### Test File Structure

- [ ] File exists: `packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts`
- [ ] Uses `InMemoryTokenStore` (not mocks)
- [ ] Uses `TestOAuthProvider` controllable test double
- [ ] Has `beforeEach`/`afterEach` for server/client setup/teardown

### Token Refresh Tests

- [ ] Test: new access_token stored in backingStore
- [ ] Test: new refresh_token stored in backingStore
- [ ] Test: provider.refreshToken() is called

### Sanitization Tests

- [ ] Test: response does NOT contain `refresh_token`
- [ ] Test: backingStore DOES contain `refresh_token`

### Rate Limiting Tests

- [ ] Test: 30s cooldown enforced per provider:bucket
- [ ] Test: `RATE_LIMITED` code returned
- [ ] Test: `retryAfter` field in response
- [ ] Test: different buckets have independent limits

### Deduplication Tests

- [ ] Test: concurrent requests deduplicated
- [ ] Test: provider called at most once

### Error Handling Tests

- [ ] Test: `NOT_FOUND` when no token exists
- [ ] Test: `REFRESH_NOT_AVAILABLE` when no refresh_token
- [ ] Test: `REFRESH_FAILED` on provider error

### Anti-Mock-Theater Verification

```bash
# Run this command - must return 0 matches
grep -c "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
```

### Stub-Fail Verification

```bash
# Tests must FAIL against fake `refreshed_${Date.now()}`
npm test -- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
# Expected: FAIL
```

---

## Deepthinker Critical Analysis

```markdown
## Deepthinker Prompt for Phase 06a

Launch deepthinker with this prompt:

"Verify that TDD tests for handleRefreshToken are REAL behavioral tests, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts

VERIFY THESE REQUIREMENTS:

1. TOKEN STORAGE VERIFICATION:
   - [ ] Test reads from backingStore.getToken() after refresh
   - [ ] Test verifies NEW access_token value in backing store
   - [ ] Test verifies refresh_token in backing store
   Show me the EXACT assertions using backingStore.

2. RATE LIMITING TESTS:
   - [ ] Test that second refresh within 30s returns RATE_LIMITED
   - [ ] Test that retryAfter is in response
   - [ ] Test that different buckets have independent limits
   Show me the rate limiting assertions.

3. DEDUPLICATION TESTS:
   - [ ] Test fires concurrent requests
   - [ ] Test verifies provider.refreshToken called only once
   - [ ] Uses getRefreshCount() to verify, NOT toHaveBeenCalled
   Show me the deduplication test.

4. CONTROLLABLE TEST DOUBLE:
   - Is TestOAuthProvider used instead of vi.fn() mocks?
   - Does testProvider.setRefreshResult() control the token?
   - Does testProvider.getRefreshCount() verify call count?
   Show me how controllable test double is used.

5. ANTI-MOCK-THEATER CHECK:
   ```bash
   grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
   ```
   Expected: 0 matches

6. STUB-FAIL VERIFICATION:
   Would these tests PASS against:
   ```typescript
   const refreshedToken: OAuthToken = {
     ...existingToken,
     access_token: 'refreshed_' + Date.now(),
     expiry: Math.floor(Date.now() / 1000) + 3600,
   };
   ```
   They MUST fail against this fake (wrong access_token value).

YOUR VERDICT:
- PASS: Tests verify backing store, rate limiting, deduplication, no mock theater
- FAIL: List specific issues"
```

---

## Evidence Collection

### Test Count

```bash
$ grep -c "it(" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
[paste count - should be ~15]
```

### Mock Theater Check

```bash
$ grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
[should be empty]
```

### Backing Store Verification

```bash
$ grep -n "backingStore.getToken" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
[paste output showing state checks]
```

### Rate Limiting Tests

```bash
$ grep -n "RATE_LIMITED\|retryAfter" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
[paste output showing rate limit tests]
```

### Deduplication Tests

```bash
$ grep -n "getRefreshCount\|concurrent" packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
[paste output showing dedup tests]
```

### Stub-Fail Result

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts 2>&1 | tail -20
[paste output showing tests FAIL]
```

---

## Additional Tests Required (Deepthinker Recommendations)

### Argument-Capture Assertions

```typescript
### Test: Refresh uses correct refresh_token from store
- Pre-populate store with known refresh_token
- Capture the token passed to `provider.refreshToken()`
- Assert it exactly matches what was in the store
- NOT using toHaveBeenCalledWith - use capturing test double
```

### Unpredictable Token Tests (Anti-Fake)

```typescript
### Test: Refreshed tokens are unpredictable (anti-fake)
- Generate a random nonce for this test run
- Configure test provider to return token containing this nonce
- Verify response contains the nonce
- This catches hardcoded refreshed_${Date.now()} because nonce changes each run
```

### Concurrency Race Tests

```typescript
### Test: Concurrent refresh - deduplicated
- Trigger 5 simultaneous refresh requests
- Provider.refreshToken should be called exactly ONCE
- All 5 requests should return the same token
- Use getRefreshCount() to verify, not toHaveBeenCalled

### Test: Rate limiting applies to non-concurrent requests
- Refresh successfully
- Wait 100ms (less than 30s cooldown)
- Refresh again
- Second should get RATE_LIMITED, not hit provider
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Write behavioral TDD tests for handleRefreshToken with rate limiting and deduplication**
- Read the tests. Do they ACTUALLY test real behavior?
- Would these tests catch a fake implementation returning `refreshed_${Date.now()}`?

### B. Is This a Real Implementation?
- Trace each test from setup to assertion
- Do tests verify backingStore has NEW token after refresh?
- Do tests use controllable test doubles (TestOAuthProvider), not vi.fn() mocks?
- Could these tests pass against hardcoded token generation? **They should NOT**

### C. Did the Model Fake Anything?
- Look for tests that only check `.toBeDefined()` without specific values
- Look for tests where the "expected" token is also hardcoded (test doesn't prove anything)
- Look for tests that don't actually verify provider was called

### D. Are There Serious Bugs or Issues?
- Do rate limiting tests use real timing (not fake timers that might mask issues)?
- Do deduplication tests actually fire concurrent requests?
- Are there tests for edge cases (no token, no refresh_token)?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve these tests?
- Do these tests give you confidence the implementation will be correct?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| Test file exists | Yes | |
| Test count | ~18 (including new tests) | |
| Mock theater (toHaveBeenCalled) | 0 | |
| backingStore.getToken checks | 2+ | |
| Rate limiting tests | 2+ | |
| Deduplication tests | Yes | |
| Argument-capture tests | 1+ | |
| Unpredictable token tests | 1+ | |
| Concurrency race tests | 2+ | |
| Error handling tests | 3+ | |
| Tests fail against fake | Yes | |
| TypeScript compiles | Yes | |
| Holistic verification passed | Yes | |
| Deepthinker verdict | PASS | |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P06.md` with evidence
2. Commit: `git commit -m "Phase 06: Refresh token TDD tests"`
3. Proceed to Phase 07: Refresh Token Implementation
