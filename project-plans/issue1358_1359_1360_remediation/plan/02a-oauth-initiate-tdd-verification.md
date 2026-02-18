# Phase 02a: OAuth Initiate TDD - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P02a`

---

## Automated Verification Script

```bash
#!/bin/bash
# verify-phase-02.sh

set -e
echo "=== Phase 02 Verification: OAuth Initiate TDD ==="

TEST_FILE="packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts"

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

# 3. Check for flow type tests
echo ""
echo "3. Checking for flow type detection tests..."
FLOW_TESTS=$(grep -c "flow_type\|pkce_redirect\|device_code" "$TEST_FILE" || echo "0")
if [ "$FLOW_TESTS" -lt 5 ]; then
  echo "FAIL: Insufficient flow type tests (found $FLOW_TESTS references)"
  exit 1
fi
echo "   [OK] Flow type tests present ($FLOW_TESTS references)"

# 4. Check for security tests
echo ""
echo "4. Checking for security tests..."
SECURITY_TESTS=$(grep -c "code_verifier\|pkce_verifier\|flowInstance" "$TEST_FILE" || echo "0")
if [ "$SECURITY_TESTS" -lt 3 ]; then
  echo "FAIL: Insufficient security tests (found $SECURITY_TESTS references)"
  exit 1
fi
echo "   [OK] Security tests present ($SECURITY_TESTS references)"

# 5. Check for real URL verification (not example.com)
echo ""
echo "5. Checking for real URL verification..."
if ! grep -q "not.*contain.*example.com\|toContain.*anthropic\|toContain.*aliyun" "$TEST_FILE"; then
  echo "FAIL: Tests should verify real URLs, not fake example.com"
  exit 1
fi
echo "   [OK] Real URL verification present"

# 6. Check for controllable test flow (not mocks)
echo ""
echo "6. Checking for controllable test flows..."
if ! grep -q "TestOAuthFlow\|setInitiateResult" "$TEST_FILE"; then
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
# This is expected to fail since handlers are NOT_IMPLEMENTED
if npm test -- "$TEST_FILE" 2>/dev/null; then
  echo "FAIL: Tests passed but handlers are NOT_IMPLEMENTED - this is mock theater!"
  exit 1
fi
echo "   [OK] Tests fail against stub (expected behavior)"

echo ""
echo "=== Phase 02 Verification PASSED ==="
echo "Tests are correctly failing against NOT_IMPLEMENTED stub."
echo "Proceed to Phase 03 to implement handleOAuthInitiate."
```

---

## Manual Verification Checklist

### Test File Structure

- [ ] File exists: `packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts`
- [ ] Uses `InMemoryTokenStore` (not mocks)
- [ ] Uses `TestOAuthFlow` controllable test double (not mocks)
- [ ] Has `beforeEach`/`afterEach` for server/client setup/teardown

### Flow Type Detection Tests

- [ ] Test: anthropic returns `pkce_redirect`
- [ ] Test: qwen returns `device_code`
- [ ] Test: unknown provider returns error

### Auth URL Tests

- [ ] Test: anthropic URL contains `console.anthropic.com`
- [ ] Test: URLs do NOT contain `example.com`
- [ ] Test: device_code flow has user_code

### Session Tests

- [ ] Test: session_id is 32 hex chars
- [ ] Test: different calls get different session_ids
- [ ] Test: session can be cancelled

### Security Tests

- [ ] Test: `code_verifier` NOT in response
- [ ] Test: `pkce_verifier` NOT in response
- [ ] Test: `flowInstance` NOT in response

### Error Tests

- [ ] Test: missing provider returns INVALID_REQUEST
- [ ] Test: unauthorized provider returns UNAUTHORIZED

### Anti-Mock-Theater Verification

```bash
# Run this command - must return 0 matches
grep -c "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
```

### Stub-Fail Verification

```bash
# Tests must FAIL against NOT_IMPLEMENTED
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
# Expected: FAIL
```

---

## Deepthinker Critical Analysis

```markdown
## Deepthinker Prompt for Phase 02a

Launch deepthinker with this prompt:

"Verify that TDD tests for handleOAuthInitiate are REAL behavioral tests, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts

VERIFY THESE REQUIREMENTS:

1. PROVIDER FLOW DETECTION TESTS:
   - [ ] Test that 'anthropic' returns flow_type 'pkce_redirect'
   - [ ] Test that 'qwen' returns flow_type 'device_code'
   - [ ] Test that unknown provider returns error
   Show me the EXACT test assertions for each.

2. SESSION UNIQUENESS TESTS:
   - [ ] Test that two calls get different session_ids
   - [ ] Test that session_id matches /^[a-f0-9]{32}$/
   Show me the assertions.

3. SECURITY TESTS:
   - [ ] Test that code_verifier/pkce_verifier NOT in response
   - [ ] Test that flowInstance NOT in response
   Show me how these are verified.

4. ANTI-MOCK-THEATER CHECK:
   ```bash
   grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
   ```
   Expected: 0 matches

5. STUB-FAIL VERIFICATION:
   Would these tests PASS against:
   ```typescript
   this.sendError(socket, id, 'NOT_IMPLEMENTED', '...');
   ```
   They MUST fail against this stub.

6. CONTROLLABLE TEST DOUBLES:
   - Is TestOAuthFlow used instead of vi.fn() mocks?
   - Is InMemoryTokenStore used instead of mocked TokenStore?

YOUR VERDICT:
- PASS: All tests are behavioral, would fail against stub, no mock theater
- FAIL: List specific issues"
```

---

## Evidence Collection

### Test Count

```bash
$ grep -c "it(" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
[paste count - should be ~15]
```

### Mock Theater Check

```bash
$ grep -n "toHaveBeenCalled" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
[should be empty]
```

### Flow Type Assertions

```bash
$ grep -n "flow_type" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
[paste output showing multiple assertions]
```

### Security Assertions

```bash
$ grep -n "code_verifier\|pkce_verifier" packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
[paste output showing security checks]
```

### Stub-Fail Result

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts 2>&1 | tail -20
[paste output showing tests FAIL]
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Write behavioral TDD tests for handleOAuthInitiate that will fail against fakes**
- Read the tests. Do they ACTUALLY test real behavior?
- Would these tests catch a fake implementation that returns hardcoded values?

### B. Is This a Real Implementation?
- Trace each test from setup to assertion
- Do tests verify backingStore state, not just response shape?
- Do tests use controllable test doubles (TestOAuthFlow), not vi.fn() mocks?
- Could these tests pass against `return { flow_type: 'browser_redirect', auth_url: 'https://example.com' }`? **They should NOT**

### C. Did the Model Fake Anything?
- Look for tests that only check `.toBeDefined()` without checking specific values
- Look for tests that don't verify the flow factory was actually used
- Look for tests where assertions are so loose they'd pass against anything
- Look for tests that rely on mock internals rather than observable behavior

### D. Are There Serious Bugs or Issues?
- Do tests clean up properly (afterEach closes connections)?
- Are there race conditions in test setup?
- Do tests actually exercise the code path they claim to test?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve these tests?
- Do these tests give you confidence the implementation will be correct?
- Would you trust these tests to catch regressions?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| Test file exists | Yes | |
| Test count | ~15 | |
| Mock theater (toHaveBeenCalled) | 0 | |
| Flow type tests | 3+ | |
| Security tests | 2+ | |
| Tests fail against stub | Yes | |
| TypeScript compiles | Yes | |
| Deepthinker verdict | PASS | |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P02.md` with evidence
2. Commit: `git commit -m "Phase 02: OAuth initiate TDD tests"`
3. Proceed to Phase 03: OAuth Initiate Implementation
