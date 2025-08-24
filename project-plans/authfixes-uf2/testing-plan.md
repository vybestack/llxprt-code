# Testing Plan for OAuth Fixes

## Test Matrix

### 1. Gemini OAuth Flow Tests

#### Test 1.1: Browser Auto-Launch
- **Setup**: Normal terminal environment
- **Action**: `/auth gemini login`
- **Expected**: Browser opens automatically
- **Verify**: Authentication completes without manual URL copy

#### Test 1.2: Fallback with No Browser
- **Setup**: `export LLXPRT_NO_BROWSER=1`
- **Action**: `/auth gemini login`
- **Expected**: Dialog shows URL, prompts for code
- **Verify**: Can paste code and complete auth

#### Test 1.3: SSH Environment
- **Setup**: SSH session
- **Action**: `/auth gemini login`
- **Expected**: Detects no browser, uses fallback
- **Verify**: Dialog flow works

### 2. Anthropic OAuth Tests

#### Test 2.1: Login Flow
- **Setup**: Clean state
- **Action**: `/auth anthropic login`
- **Expected**: Shows URL dialog, accepts code
- **Verify**: Can make API calls after auth

#### Test 2.2: Immediate Logout
- **Setup**: Logged in with Anthropic
- **Action**: `/auth anthropic logout` then immediate API call
- **Expected**: Logout message, then auth error
- **Verify**: No 1-minute delay, fails immediately

#### Test 2.3: Logout Error Handling
- **Setup**: Make token file read-only
- **Action**: `/auth anthropic logout`
- **Expected**: Error message about permission
- **Verify**: Doesn't silently "succeed"

### 3. Cross-Provider Tests

#### Test 3.1: Multiple Provider Logout
- **Setup**: Login to Anthropic, Gemini, Qwen
- **Action**: Logout from each
- **Expected**: Each stops working immediately
- **Verify**: No cross-contamination

#### Test 3.2: Re-login After Logout
- **Setup**: Logout from provider
- **Action**: Login again
- **Expected**: Works normally
- **Verify**: No stale cache issues

### 4. Error Recovery Tests

#### Test 4.1: Interrupted Auth Flow
- **Setup**: Start auth flow
- **Action**: Ctrl+C during code entry
- **Expected**: Graceful exit
- **Verify**: Can restart auth flow

#### Test 4.2: Invalid Verification Code
- **Setup**: Fallback flow
- **Action**: Enter wrong code
- **Expected**: Clear error message
- **Verify**: Can retry with correct code

### 5. Cache Behavior Tests

#### Test 5.1: Cache Clearing on Logout
- **Setup**: Make several API calls (populate cache)
- **Action**: Logout
- **Expected**: Cache cleared
- **Verify**: Next API call fails immediately

#### Test 5.2: Cache Timeout
- **Setup**: Login, make API call
- **Action**: Wait 65 seconds, make another call
- **Expected**: Cache miss, re-resolves auth
- **Verify**: Still works if logged in

## Automated Test Script

```bash
#!/bin/bash
# test-oauth-fixes.sh

echo "Testing OAuth Fixes"

# Test 1: Gemini browser detection
echo "Test 1: Gemini browser launch"
llxprt /auth gemini logout 2>/dev/null
llxprt /auth gemini login
echo "Did browser open? (y/n)"
read response

# Test 2: Gemini fallback
echo "Test 2: Gemini fallback"
LLXPRT_NO_BROWSER=1 llxprt /auth gemini logout
LLXPRT_NO_BROWSER=1 llxprt /auth gemini login
echo "Did dialog appear? (y/n)"
read response

# Test 3: Anthropic logout
echo "Test 3: Anthropic logout"
llxprt /auth anthropic login
llxprt "test message"
llxprt /auth anthropic logout
llxprt "should fail"
echo "Did second message fail? (y/n)"
read response

# Add more tests...
```

## Debug Commands

Enable debug logging:
```bash
export DEBUG=llxprt:*
```

Check token files:
```bash
ls -la ~/.llxprt/oauth/
```

Check cache state:
```bash
# Add debug endpoint to dump cache state
llxprt /debug auth-cache
```

## Success Metrics

- [ ] All browser detection tests pass
- [ ] All fallback UI tests pass
- [ ] All logout tests pass (immediate effect)
- [ ] No silent failures
- [ ] Debug logs show expected flow
- [ ] No regression in existing auth