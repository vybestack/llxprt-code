# Phase 01a: Delete Fake Handlers - Verification

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P01a`

---

## Automated Verification Script

Run this script to verify Phase 01:

```bash
#!/bin/bash
# verify-phase-01.sh

set -e
echo "=== Phase 01 Verification: Delete Fake Handlers ==="

PROXY_FILE="packages/cli/src/auth/proxy/credential-proxy-server.ts"

# 1. Check fake patterns are gone
echo ""
echo "1. Checking fake patterns are removed..."

FAKE_URL=$(grep -c "auth.example.com" "$PROXY_FILE" || echo "0")
if [ "$FAKE_URL" != "0" ]; then
  echo "FAIL: Found auth.example.com in $PROXY_FILE"
  grep -n "auth.example.com" "$PROXY_FILE"
  exit 1
fi
echo "   [OK] No auth.example.com"

FAKE_ACCESS=$(grep -c "test_access_" "$PROXY_FILE" || echo "0")
if [ "$FAKE_ACCESS" != "0" ]; then
  echo "FAIL: Found test_access_ in $PROXY_FILE"
  grep -n "test_access_" "$PROXY_FILE"
  exit 1
fi
echo "   [OK] No test_access_"

FAKE_REFRESH=$(grep -c 'refreshed_' "$PROXY_FILE" || echo "0")
if [ "$FAKE_REFRESH" != "0" ]; then
  echo "FAIL: Found refreshed_ in $PROXY_FILE"
  grep -n "refreshed_" "$PROXY_FILE"
  exit 1
fi
echo "   [OK] No refreshed_"

# 2. Check NOT_IMPLEMENTED is in place
echo ""
echo "2. Checking NOT_IMPLEMENTED markers..."

NOT_IMPL=$(grep -c "NOT_IMPLEMENTED" "$PROXY_FILE" || echo "0")
if [ "$NOT_IMPL" -lt 4 ]; then
  echo "FAIL: Expected 4 NOT_IMPLEMENTED, found $NOT_IMPL"
  exit 1
fi
echo "   [OK] Found $NOT_IMPL NOT_IMPLEMENTED markers"

# 3. TypeScript compilation
echo ""
echo "3. Checking TypeScript compilation..."
npm run typecheck || { echo "FAIL: TypeScript compilation failed"; exit 1; }
echo "   [OK] TypeScript compiles"

# 4. Token CRUD tests still pass
echo ""
echo "4. Checking token CRUD tests still pass..."
npm test -- --grep "token operations\|get_token\|save_token\|remove_token" || {
  echo "FAIL: Token CRUD tests should still pass"
  exit 1
}
echo "   [OK] Token CRUD tests pass"

# 5. OAuth handler tests should FAIL (expected)
echo ""
echo "5. Verifying OAuth handler tests fail (expected behavior)..."

# Note: We expect these to fail, so we check they DON'T pass
if npm test -- --grep "oauth_initiate" 2>/dev/null; then
  echo "WARNING: oauth_initiate tests passed - investigate for mock theater"
fi

if npm test -- --grep "oauth_exchange" 2>/dev/null; then
  echo "WARNING: oauth_exchange tests passed - investigate for mock theater"  
fi

if npm test -- --grep "refresh_token" 2>/dev/null; then
  echo "WARNING: refresh_token tests passed - investigate for mock theater"
fi

echo ""
echo "=== Phase 01 Verification PASSED ==="
```

---

## Manual Verification Checklist

### Fake Pattern Removal

- [ ] `grep -n "auth.example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts` returns 0 matches
- [ ] `grep -n "test_access_" packages/cli/src/auth/proxy/credential-proxy-server.ts` returns 0 matches
- [ ] `grep -n "refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts` returns 0 matches

### NOT_IMPLEMENTED Markers

- [ ] handleOAuthInitiate contains `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`
- [ ] handleOAuthExchange contains `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`
- [ ] handleOAuthPoll contains `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`
- [ ] handleRefreshToken contains `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`

### Build Status

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

### Test Status

- [ ] Token CRUD tests pass (get_token, save_token, remove_token)
- [ ] API key tests pass
- [ ] OAuth handler tests fail with NOT_IMPLEMENTED (expected)

---

## Deepthinker Critical Analysis

```markdown
## Deepthinker Prompt for Phase 01a

Launch deepthinker with this prompt:

"Verify that all fake handler implementations have been completely deleted.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts

FIND THESE SPECIFIC FAKE PATTERNS AND VERIFY THEY ARE GONE:

1. handleOAuthInitiate:
   - OLD: `flow_type: 'browser_redirect'` hardcoded
   - OLD: `auth_url: 'https://auth.example.com/oauth?...'`
   - Should now be: `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`

2. handleOAuthExchange:
   - OLD: `access_token: 'test_access_${sessionId}'`
   - OLD: Creates fake OAuthToken inline
   - Should now be: `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`

3. handleOAuthPoll:
   - OLD: `access_token: 'test_access_${sessionId}'`
   - OLD: Immediately returns complete status
   - Should now be: `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`

4. handleRefreshToken:
   - OLD: `access_token: 'refreshed_${Date.now()}'`
   - OLD: Modifies existingToken inline without provider call
   - Should now be: `this.sendError(socket, id, 'NOT_IMPLEMENTED', ...)`

RUN THESE VERIFICATION COMMANDS:
```bash
# No fake URLs
grep -c "auth.example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 0

# No fake tokens
grep -c "test_access_\|refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 0

# NOT_IMPLEMENTED present
grep -c "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 4+
```

ALSO VERIFY:
1. The oauthSessions Map is still declared (needed for real impl)
2. handleOAuthCancel still works (just deletes from map)
3. No hidden fake logic remains in helper methods

YOUR VERDICT:
- PASS: All fake patterns removed, NOT_IMPLEMENTED in place
- FAIL: List any remaining fake patterns with line numbers"
```

---

## Holistic Verification (MANDATORY)

Before marking this phase complete, the verifier MUST answer these questions:

### A. Does This Meet the Intent?
- What was this phase supposed to accomplish? **Delete all fake handler implementations and replace with NOT_IMPLEMENTED stubs**
- Read the implementation. Does it ACTUALLY accomplish that?
- Would a user's problem be solved by this code? **N/A - this is a cleanup phase to create a clean baseline**

### B. Is This a Real Implementation?
- Trace the code path from entry to exit
- Does it call real provider methods or fake ones? **Should call NOTHING - just return NOT_IMPLEMENTED error**
- Does it store real data or return hardcoded values? **Should store NOTHING**
- Could this code work in production with real OAuth providers? **No, and that's the point - it's a stub**

### C. Did the Model Fake Anything?
- Look for clever tricks: string concatenation, aliased variables
- Look for "close but not quite" implementations
- Look for code that passes tests but doesn't actually work
- Look for TODO/FIXME/HACK comments hidden in the code
- **Specifically check**: Did the model leave ANY logic beyond the error throw?

### D. Are There Serious Bugs or Issues?
- Are the NOT_IMPLEMENTED errors properly formatted?
- Is any state leaked (sessions created but not cleaned up)?
- Are there any resource leaks?

### E. Verifier's Gut Check
- If you were code reviewing this PR, would you approve it?
- Does something feel "off" about this implementation?
- Is this code you'd be comfortable running in production?

**Write a 2-3 paragraph assessment answering these questions. If ANY answer raises concerns, the phase FAILS.**

---

## Evidence Collection

After completing Phase 01, record:

### Grep Results

```bash
$ grep -n "auth.example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output - should be empty]

$ grep -n "test_access_\|refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output - should be empty]

$ grep -n "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/credential-proxy-server.ts
[paste output - should show 4 lines]
```

### Handler Line Counts

```bash
# Each handler should now be very short (5-10 lines max)
$ sed -n '/handleOAuthInitiate/,/^  private async handle/p' packages/cli/src/auth/proxy/credential-proxy-server.ts | wc -l
[should be ~10 or less]

$ sed -n '/handleOAuthExchange/,/^  private async handle/p' packages/cli/src/auth/proxy/credential-proxy-server.ts | wc -l
[should be ~10 or less]
```

### Test Results

```bash
$ npm test -- packages/cli/src/auth/proxy/__tests__/ 2>&1 | grep -E "(PASS|FAIL|NOT_IMPLEMENTED)"
[paste relevant output]
```

---

## Failure Recovery

If verification fails:

```bash
# Restore from git
git checkout packages/cli/src/auth/proxy/credential-proxy-server.ts

# Re-apply changes more carefully
# Follow 01-delete-fake-handlers.md step by step
```

---

## Success Criteria Summary

| Check | Expected | Actual |
|-------|----------|--------|
| auth.example.com grep | 0 matches | |
| test_access_ grep | 0 matches | |
| refreshed_ grep | 0 matches | |
| NOT_IMPLEMENTED grep | 4+ matches | |
| TypeScript compiles | Yes | |
| Token CRUD tests | Pass | |
| OAuth handler tests | Fail (expected) | |
| Deepthinker verdict | PASS | |

---

## Phase Completion

When all checks pass:

1. Create `.completed/P01.md` with evidence
2. Commit: `git commit -m "Phase 01: Delete fake credential proxy handlers"`
3. Proceed to Phase 02: OAuth Initiate TDD
