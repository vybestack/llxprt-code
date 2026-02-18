# Deepthinker Verification Prompts

This document contains the MANDATORY deepthinker prompts for each verification phase. These prompts are designed to aggressively detect fake implementations.

---

## Anti-Evasion Checks

### String Concatenation Detection
```bash
# Detect suspicious string building that might hide banned patterns
grep -n "'\s*+\s*'" file.ts | grep -i "test\|access\|auth\|example\|refresh"
grep -n '"\s*+\s*"' file.ts | grep -i "test\|access\|auth\|example\|refresh"
grep -n '`.*${.*}`' file.ts | grep -i "test\|access\|auth\|example\|refresh"
```

### Variable Aliasing Detection
```bash
# Look for suspicious variable assignments that might hide fake values
grep -n "const.*=.*'test\|const.*=.*'auth\|const.*=.*'fake" file.ts
grep -n "let.*=.*'test\|let.*=.*'auth\|let.*=.*'fake" file.ts
```

### AST-Level Check (if available)
```bash
# Use ast_grep to find string literals containing suspicious patterns
ast-grep --pattern '"test_$$$"' file.ts
ast-grep --pattern '"auth.example$$$"' file.ts
ast-grep --pattern '"fake$$$"' file.ts
ast-grep --pattern '"refreshed_$$$"' file.ts
```

### Hidden Comment Detection
```bash
# Look for TODO/FIXME/HACK buried in code that might indicate fake impl
grep -n "TODO\|FIXME\|HACK\|TEMP\|XXX" file.ts | grep -v "^[0-9]*:\s*//"
```

---

## Phase 01a: Delete Fake Handlers Verification

```markdown
Launch deepthinker with this prompt:

"Verify the fake handlers have been replaced with NOT_IMPLEMENTED errors.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts

VERIFY:

1. handleOAuthInitiate THROWS NOT_IMPLEMENTED:
   - Find the method
   - First line MUST be: throw new Error('NOT_IMPLEMENTED: handleOAuthInitiate')
   - MUST NOT have any other logic before the throw

2. handleOAuthExchange THROWS NOT_IMPLEMENTED:
   - Find the method
   - First line should be: throw new Error('NOT_IMPLEMENTED: handleOAuthExchange')
   - Should NOT have any session validation before the throw

3. handleOAuthPoll THROWS NOT_IMPLEMENTED:
   - Find the method
   - First line should be: throw new Error('NOT_IMPLEMENTED: handleOAuthPoll')

4. handleRefreshToken THROWS NOT_IMPLEMENTED:
   - Find the method
   - First line should be: throw new Error('NOT_IMPLEMENTED: handleRefreshToken')

5. NO FAKE PATTERNS REMAIN:
   ```bash
   grep -n "auth.example.com\|test_access_\|refreshed_" packages/cli/src/auth/proxy/credential-proxy-server.ts
   ```
   Expected: 0 matches (comments OK)

VERDICT:
- PASS: All fake handlers replaced with NOT_IMPLEMENTED
- FAIL: List which handlers still have fake logic"
```

---

## Phase 02a: OAuth Initiate TDD Verification

```markdown
Launch deepthinker with this prompt:

"Verify the TDD tests for handleOAuthInitiate are BEHAVIORAL, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts

VERIFY EACH TEST:

1. TESTS VERIFY STATE, NOT MOCKS:
   - Find assertions that check backingStore state
   - Assertions like: expect(session.flowInstance).toBeDefined()
   - FAIL if you find: expect(mock).toHaveBeenCalled()

2. TESTS USE CONTROLLABLE TEST DOUBLES:
   - Find TestOAuthFlow class
   - It should be a real class with real methods, not jest.fn()
   - Methods should return controllable but non-hardcoded values

3. TESTS WOULD FAIL AGAINST STUB:
   - If handleOAuthInitiate returns hardcoded data, would these tests catch it?
   - Tests should verify auth_url format matches provider
   - Tests should verify session_id is unique per call

4. FLOW TYPE DETECTION TESTED:
   - Test for anthropic -> pkce_redirect
   - Test for qwen -> device_code
   - Test for unknown provider -> error

5. SESSION LIFECYCLE TESTED:
   - Session can be cancelled
   - Session has unique ID
   - Session stores flow instance

VERDICT:
- PASS: Tests are behavioral, verify state, would fail against fake
- FAIL: List specific mock theater or fake-passing tests"
```

---

## Phase 03a: OAuth Initiate Implementation Verification

```markdown
Launch deepthinker with this prompt:

"Verify handleOAuthInitiate is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleOAuthInitiate method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. FLOW FACTORY USAGE:
   - Find where flowFactories.get(provider) is called
   - Show me the EXACT line
   - If flowFactories not used, it's FAKE.

2. FLOW INSTANCE CREATION:
   - Find where flowFactory() is called to create instance
   - Show me the EXACT line
   - If hardcoded, it's FAKE.

3. FLOW TYPE DETECTION:
   - How does code determine pkce_redirect vs device_code vs browser_redirect?
   - Show me the logic
   - If hardcoded to always return same type, it's FAKE.

4. SESSION STORAGE:
   - Show where flowInstance is stored in session
   - Session must have: provider, bucket, flowInstance, flowType
   - If flowInstance not stored, exchange won't work

5. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   # MUST find all required method calls:
   grep -n "flowFactories.get\|flowFactory()\|initiateDeviceFlow\|oauthSessions.set" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i initiate
   ```
   All four patterns MUST be present

6. NO HARDCODED URLS:
   ```bash
   grep -n "example.com\|auth.example" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i initiate
   ```
   Expected: 0 matches in actual code

RED FLAGS (automatic FAIL):
- No flowFactories usage
- Hardcoded auth_url like 'https://auth.example.com'
- Same flow_type for all providers
- flowInstance not stored in session

YOUR VERDICT:
- PASS: Implementation uses real flow factories and stores flow instances
- FAIL: List specific fake patterns found"
```

---

## Phase 04a: OAuth Exchange TDD Verification

```markdown
Launch deepthinker with this prompt:

"Verify the TDD tests for handleOAuthExchange are BEHAVIORAL, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts

VERIFY EACH TEST:

1. TESTS VERIFY BACKING STORE STATE:
   - After exchange, tests MUST check: await backingStore.getToken(provider)
   - Backing store should have access_token AND refresh_token
   - Response should have access_token but NOT refresh_token

2. TESTS USE CONTROLLABLE TEST DOUBLES:
   - TestOAuthFlow.exchangeCodeForToken() returns controllable token
   - Token MUST include refresh_token that gets stripped

3. TESTS WOULD FAIL AGAINST STUB:
   - If exchange returned hardcoded 'test_access_', would tests catch it?
   - Tests should verify exact token values, not just presence

4. SECURITY TESTS:
   - Test: refresh_token NOT in response
   - Test: refresh_token IS in backing store
   - Test: session single-use (second exchange fails)

5. ERROR HANDLING TESTS:
   - Test: SESSION_NOT_FOUND for invalid session
   - Test: SESSION_ALREADY_USED for replay
   - Test: SESSION_EXPIRED for timeout

VERDICT:
- PASS: Tests verify state, security, would fail against fake
- FAIL: List specific issues"
```

---

## Phase 05a: OAuth Exchange Implementation Verification

```markdown
Launch deepthinker with this prompt:

"Verify handleOAuthExchange is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleOAuthExchange method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. SESSION RETRIEVAL:
   - Find where session is retrieved by session_id
   - Show me the EXACT line
   - Session must contain flowInstance

2. FLOW INSTANCE EXCHANGE:
   - Find where flowInstance.exchangeCodeForToken() is called
   - Show me the EXACT line
   - The code parameter must be passed from request

3. TOKEN STORAGE:
   - Find where tokenStore.saveToken() is called
   - Show me the EXACT line
   - Token saved MUST include refresh_token

4. RESPONSE SANITIZATION:
   - Find where sanitizeTokenForProxy() is called
   - Response MUST NOT include refresh_token

5. SESSION INVALIDATION:
   - Find where session is marked as used
   - This MUST happen BEFORE exchange (to prevent replay)

6. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   # MUST find all required method calls:
   grep -n "oauthSessions.get\|exchangeCodeForToken\|tokenStore.saveToken\|sanitize" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i exchange
   ```
   All four patterns MUST be present

7. NO HARDCODED TOKENS:
   ```bash
   grep -n "test_access_\|fake_\|dummy_" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i exchange
   ```
   Expected: 0 matches in actual code

RED FLAGS (automatic FAIL):
- No flowInstance.exchangeCodeForToken() call
- Hardcoded access_token like 'test_access_${sessionId}'
- Token not stored in tokenStore
- refresh_token in response

YOUR VERDICT:
- PASS: Implementation calls real exchange, stores token, sanitizes response
- FAIL: List specific fake patterns found"
```

---

## Phase 04c: OAuth Poll TDD Verification

```markdown
Launch deepthinker with this prompt:

"Verify the TDD tests for handleOAuthPoll are BEHAVIORAL, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts

VERIFY EACH TEST:

1. TESTS VERIFY STATE, NOT MOCKS:
   - Find assertions that check backingStore state
   - Assertions like: expect(stored).toBeNull() while pending
   - Assertions like: expect(stored?.access_token).toBe('...') after completion
   - FAIL if you find: expect(mock).toHaveBeenCalled()

2. TESTS VERIFY PENDING STATUS:
   - Test: Returns pending when provider says authorization_pending
   - Test: Returns pending with increased interval on slow_down
   - Test: Backing store has NO token while pending
   - Test: Can poll multiple times while pending

3. TESTS VERIFY COMPLETION:
   - Test: Returns complete status with token when provider completes
   - Test: Token stored in backing store ONLY on completion
   - Test: Multiple pending then complete scenario

4. TESTS USE CONTROLLABLE TEST DOUBLES:
   - Find TestDeviceCodeFlow class
   - It should have setPollSequence() to control poll results
   - Methods should return controllable but non-hardcoded values

5. TESTS WOULD FAIL AGAINST FAKE:
   - If handleOAuthPoll immediately returned a token, would tests catch it?
   - Tests that check 'no token while pending' would catch this
   - Tests should verify status is 'pending' vs 'complete'

6. SECURITY TESTS:
   - Test: refresh_token NOT in response
   - Test: refresh_token IS in backing store
   - Test: session consumed after completion (SESSION_ALREADY_USED)

7. ERROR HANDLING TESTS:
   - Test: SESSION_NOT_FOUND for invalid session
   - Test: SESSION_EXPIRED for timeout
   - Test: ACCESS_DENIED when user denies authorization

VERDICT:
- PASS: Tests are behavioral, verify state transitions, would fail against fake
- FAIL: List specific mock theater or fake-passing tests"
```

---

## Phase 04e: OAuth Poll Implementation Verification

```markdown
Launch deepthinker with this prompt:

"Verify handleOAuthPoll is REAL, not just differently-shaped fake.

Read: packages/cli/src/auth/proxy/credential-proxy-server.ts (handleOAuthPoll method)

YOUR JOB IS TO FIND PROBLEMS. Assume it's fake until proven real.

FIND EVIDENCE OF REAL IMPLEMENTATION:

1. SESSION RETRIEVAL:
   - Find where session is retrieved by session_id
   - Show me the EXACT line
   - Session must contain flowInstance and deviceCode

2. POLL FOR TOKEN CALL:
   - Find where flowInstance.pollForToken() is called
   - Show me the EXACT line
   - The deviceCode parameter must come from session, not request

3. PENDING STATUS HANDLING:
   - Find where authorization_pending error is caught
   - Show where { status: 'pending' } is returned
   - This must NOT immediately return a token

4. SLOW DOWN HANDLING:
   - Find where slow_down error is caught
   - Show where interval is increased
   - Show where { status: 'pending', interval: ... } is returned

5. TOKEN STORAGE ON SUCCESS:
   - Find where tokenStore.saveToken() is called
   - Show me the EXACT line
   - Token saved MUST include refresh_token
   - This MUST ONLY happen after pollForToken returns a token

6. RESPONSE SANITIZATION:
   - Find where token is sanitized (refresh_token removed)
   - Response MUST NOT include refresh_token

7. SESSION INVALIDATION:
   - Find where session.used = true is set
   - This MUST happen BEFORE storage (to prevent race)
   - Find where session is deleted after completion

8. SEMANTIC BEHAVIOR VERIFICATION:
   ```bash
   grep -c "pollForToken\|authorization_pending\|slow_down\|tokenStore.saveToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
   ```
   All 4 required behaviors MUST be present

9. NO FAKE PATTERNS:
   ```bash
   grep -n "test_access_\|fake_\|dummy_\|TODO.*real\|In real implementation\|for testing\|simulate" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i poll
   ```
   Expected: 0 matches in actual code

RED FLAGS (automatic FAIL):
- No pollForToken() call
- Immediately returns token without checking pending status
- Hardcoded access_token values
- Token stored before poll completes
- refresh_token in response
- No handling of authorization_pending

YOUR VERDICT:
- PASS: Implementation polls provider, handles pending, stores on success, sanitizes response
- FAIL: List specific fake patterns found"
```

---

## Phase 06a: Refresh Token TDD Verification

```markdown
Launch deepthinker with this prompt:

"Verify the TDD tests for handleRefreshToken are BEHAVIORAL, not mock theater.

Read: packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts

VERIFY EACH TEST:

1. TESTS VERIFY BACKING STORE STATE:
   - After refresh, tests MUST check: await backingStore.getToken(provider)
   - Backing store should have NEW access_token
   - Response should NOT have refresh_token

2. RATE LIMITING TESTS:
   - Test: Second refresh within 30s returns RATE_LIMITED
   - Test: Response includes retryAfter
   - Uses REAL timing (not fake timers)

3. DEDUPLICATION TESTS:
   - Test: Concurrent refreshes result in single provider call
   - Must verify actual deduplication, not just mock counting

4. ERROR HANDLING TESTS:
   - Test: REFRESH_NOT_AVAILABLE when no refresh_token
   - Test: NOT_FOUND when no token exists
   - Test: REAUTH_REQUIRED on auth errors

5. PROVIDER CALL TESTS:
   - Tests should verify provider was called with correct refresh_token
   - NOT using toHaveBeenCalledWith - verify by output

VERDICT:
- PASS: Tests verify state, rate limiting, deduplication
- FAIL: List specific issues"
```

---

## Phase 07a: Refresh Token Implementation Verification

```markdown
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
   - Show EXACT line where provider.refreshToken() is called
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

5. SEMANTIC IMPLEMENTATION VERIFICATION:
   - MUST use RefreshCoordinator.refresh() for rate limiting/dedup
   - MUST call provider.refreshToken() inside coordinator callback
   - MUST store new token in tokenStore
   - MUST handle RATE_LIMITED status with retryAfter
   - MUST sanitize response (remove refresh_token)
   - MUST NOT have hardcoded token values

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

## Phase 08a: Integration Wiring Verification

```markdown
Launch deepthinker with this prompt:

"Verify the integration wiring connects REAL components, not test doubles.

Read:
- packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
- packages/cli/src/auth/proxy/credential-proxy-server.ts

VERIFY:

1. FLOW FACTORIES ARE REAL:
   - Find buildDefaultFlowFactories()
   - Show that it creates AnthropicDeviceFlow, QwenDeviceFlow, CodexDeviceFlow
   - These must be IMPORTED from real modules, not test doubles

2. PROVIDERS ARE REAL:
   - Find buildDefaultProviders()
   - Show that providers wrap real flow.refreshToken()
   - Not fake providers that return hardcoded tokens

3. REFRESHCOORDINATOR WIRED:
   - Find where RefreshCoordinator is instantiated
   - Show it's passed to CredentialProxyServer
   - Verify 30s cooldown is configured

4. SERVER RECEIVES ALL DEPS:
   - Show CredentialProxyServer constructor call
   - Verify flowFactories, providers, refreshCoordinator all passed

5. NO HARDCODED TEST DATA:
   ```bash
   grep -n "example.com\|test_\|fake_" packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
   ```
   Expected: 0 matches in actual code

VERDICT:
- PASS: Wiring uses real flows, real providers, RefreshCoordinator
- FAIL: List specific issues"
```

---

## Phase 09: Final Acceptance Audit

```markdown
Launch deepthinker with this prompt:

"FINAL AUDIT: Find ANY remaining fake code in the credential proxy system.

Read ALL of these files:
- packages/cli/src/auth/proxy/credential-proxy-server.ts
- packages/cli/src/auth/proxy/sandbox-proxy-lifecycle.ts
- packages/cli/src/auth/proxy/__tests__/oauth-initiate.spec.ts
- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
- packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
- packages/cli/src/auth/proxy/__tests__/refresh-flow.spec.ts
- packages/cli/src/auth/proxy/__tests__/integration-wiring.spec.ts

COMPREHENSIVE CHECKLIST:

## Production Code

1. handleOAuthInitiate:
   - [ ] Uses flowFactories.get(provider)?
   - [ ] Calls flowInstance.initiateDeviceFlow()?
   - [ ] Stores flowInstance in session?
   - [ ] NO hardcoded auth URLs?
   - [ ] 40+ meaningful lines?

2. handleOAuthExchange:
   - [ ] Retrieves flowInstance from session?
   - [ ] Calls flowInstance.exchangeCodeForToken()?
   - [ ] Stores FULL token in tokenStore?
   - [ ] Returns sanitized token?
   - [ ] 50+ meaningful lines?

3. handleOAuthPoll:
   - [ ] Retrieves session with deviceCode and flowInstance?
   - [ ] Calls flowInstance.pollForToken(deviceCode)?
   - [ ] Returns pending status on authorization_pending?
   - [ ] Returns pending with increased interval on slow_down?
   - [ ] Stores FULL token ONLY on completion?
   - [ ] Returns sanitized token (no refresh_token)?
   - [ ] Session consumed after completion?
   - [ ] 30+ meaningful lines?

4. handleRefreshToken:
   - [ ] Uses RefreshCoordinator.refresh()?
   - [ ] Calls provider.refreshToken() inside callback?
   - [ ] Stores new token in tokenStore?
   - [ ] Handles RATE_LIMITED?
   - [ ] 40+ meaningful lines?

5. SandboxProxyLifecycle:
   - [ ] buildDefaultFlowFactories() creates real flows?
   - [ ] buildDefaultProviders() wraps real flows?
   - [ ] RefreshCoordinator properly wired?

## Test Code

6. No Mock Theater:
   - [ ] 0 instances of toHaveBeenCalled?
   - [ ] 0 instances of toHaveBeenCalledWith?
   - [ ] 0 instances of mockReturnValue?

7. Tests Verify State:
   - [ ] Tests check backingStore.getToken()?
   - [ ] Tests verify response structure?
   - [ ] Tests would FAIL against fakes?
   - [ ] OAuth Poll tests verify pending vs complete status?

## Final Checks

```bash
# Fake URL patterns
grep -rn "auth.example.com" packages/cli/src/auth/proxy/*.ts | grep -v __tests__

# Fake token patterns
grep -rn "test_access_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__
grep -rn "refreshed_" packages/cli/src/auth/proxy/*.ts | grep -v __tests__

# Stub markers
grep -rn "NOT_IMPLEMENTED" packages/cli/src/auth/proxy/*.ts | grep -v __tests__

# TODO admissions of fake code
grep -rn "TODO.*real\|TODO.*actual\|In real implementation\|for testing\|simulate" packages/cli/src/auth/proxy/*.ts | grep -v __tests__ | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"

# Future promise language
grep -rn "will be\|should be\|would be" packages/cli/src/auth/proxy/*.ts | grep -v __tests__ | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
```
All should return 0 matches (except possibly in comments).

FINAL VERDICT:
- [ ] PASS: All fake implementations replaced with real code
- [ ] FAIL: List remaining issues"
```
`
]*:.*//\|^[0-9]*:.*\*"
```
All should return 0 matches (except possibly in comments).

FINAL VERDICT:
- [ ] PASS: All fake implementations replaced with real code
- [ ] FAIL: List remaining issues"
```
ssues"
```
sues"
```
ssues"
```
sues"
```
ssues"
```
sues"
```
ssues"
```
