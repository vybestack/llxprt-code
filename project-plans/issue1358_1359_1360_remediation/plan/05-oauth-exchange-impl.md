# Phase 05: OAuth Exchange Implementation

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P05`

## Purpose

Implement **REAL** `handleOAuthExchange` that:
1. Retrieves flow instance from session
2. Calls real `flow.exchangeCodeForToken()` with authorization code
3. Stores full token (including refresh_token) in backingStore
4. Returns sanitized token (without refresh_token)

---

## Prerequisites

- Phase 04 completed (TDD tests written)
- Phase 04a verification passed (tests fail against stub)

---

## Implementation

### handleOAuthExchange - REAL Implementation

Replace the NOT_IMPLEMENTED stub with:

```typescript
/**
 * Handles OAuth code exchange - calls real provider, stores full token.
 * 
 * CRITICAL: Token is stored in backingStore WITH refresh_token.
 *           Response is sanitized (refresh_token stripped).
 *
 * @plan PLAN-20250217-CREDPROXY-REMEDIATION.P05
 */
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sessionId = payload.session_id as string | undefined;
  const code = payload.code as string | undefined;

  // Validate required fields
  if (!sessionId) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
    return;
  }
  if (!code) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing code');
    return;
  }

  // Retrieve session
  const session = this.oauthSessions.get(sessionId);
  if (!session) {
    this.sendError(socket, id, 'SESSION_NOT_FOUND', 'OAuth session not found');
    return;
  }

  // Check if session already used
  if (session.used) {
    this.sendError(socket, id, 'SESSION_ALREADY_USED', 'OAuth session already used');
    return;
  }

  // Check if session expired
  const sessionTimeoutMs = this.options.oauthSessionTimeoutMs ?? CredentialProxyServer.SESSION_TIMEOUT_MS;
  if (Date.now() - session.createdAt > sessionTimeoutMs) {
    this.oauthSessions.delete(sessionId);
    this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
    return;
  }

  // Mark session as used BEFORE attempting exchange (prevent replay)
  session.used = true;

  try {
    // Retrieve flow instance from session
    const flowInstance = session.flowInstance;
    if (!flowInstance || typeof flowInstance.exchangeCodeForToken !== 'function') {
      this.sendError(socket, id, 'INVALID_SESSION', 'Session missing flow instance');
      return;
    }

    // Call REAL provider exchange
    // For PKCE flows, the code might need to be combined with stored state
    let exchangeCode = code;
    if (session.flowType === 'pkce_redirect' && session.pkceState) {
      // Some flows expect code#state format
      exchangeCode = `${code}#${session.pkceState}`;
    }

    const token = await flowInstance.exchangeCodeForToken(exchangeCode, session.pkceState);

    // Store FULL token in backing store (INCLUDING refresh_token)
    await this.options.tokenStore.saveToken(
      session.provider,
      token,
      session.bucket,
    );

    // Clean up session (single-use)
    this.oauthSessions.delete(sessionId);

    // Return SANITIZED token (WITHOUT refresh_token)
    const sanitized = sanitizeTokenForProxy(token);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  } catch (err) {
    // Session remains marked as used to prevent retry
    const message = err instanceof Error ? err.message : String(err);
    this.sendError(socket, id, 'EXCHANGE_FAILED', message);
  }
}
```

---

## Semantic Behavior Requirement

The implementation MUST have all required method calls:

```bash
# Verify all required behaviors are present
grep -c "oauthSessions.get\|exchangeCodeForToken\|tokenStore.saveToken\|sanitize" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: 3+
```

---

## Real Provider Call Verification

The implementation MUST call `flowInstance.exchangeCodeForToken()`:

```bash
grep -n "exchangeCodeForToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Find the call inside handleOAuthExchange
```

---

## Token Storage Verification

The implementation MUST store full token in backingStore:

```bash
grep -A 5 "tokenStore.saveToken" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: See token being saved in handleOAuthExchange
```

---

## Sanitization Verification

The implementation MUST use `sanitizeTokenForProxy`:

```bash
grep -n "sanitizeTokenForProxy" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: Find in handleOAuthExchange
```

---

## No Fake Patterns

```bash
grep -n "test_access_\|example.com" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -v "^[0-9]*:.*//\|^[0-9]*:.*\*"
# Expected: 0 matches in code (comments OK)
```

---

## Tests Should Now Pass

After implementation:

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-exchange.spec.ts
# Expected: ALL PASS
```

---

## Success Criteria

1. [x] `handleOAuthExchange` retrieves `flowInstance` from session
2. [x] `handleOAuthExchange` calls `flowInstance.exchangeCodeForToken()`
3. [x] Full token (including refresh_token) stored in backingStore
4. [x] Response is sanitized (no refresh_token)
5. [x] Session marked as used before exchange (prevent replay)
6. [x] Session deleted after successful exchange
7. [x] All required semantic behaviors present
8. [x] All Phase 04 tests now PASS
9. [x] No fake patterns

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P05.md`

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/auth/proxy/credential-proxy-server.ts

Changes:
- Implemented handleOAuthExchange (XX lines)
- Retrieves flowInstance from session
- Calls real exchangeCodeForToken()
- Stores full token, returns sanitized

Key Implementation Lines:
- Line XX: session.flowInstance retrieval
- Line YY: flowInstance.exchangeCodeForToken(code)
- Line ZZ: tokenStore.saveToken(provider, token, bucket)
- Line AA: sanitizeTokenForProxy(token)

Verification:
- Semantic verification: All required method calls present
- Tests: All Phase 04 tests PASS
- Fake patterns: 0 matches
- sanitizeTokenForProxy: Used
```
ce retrieval
- Line YY: flowInstance.exchangeCodeForToken(code)
- Line ZZ: tokenStore.saveToken(provider, token, bucket)
- Line AA: sanitizeTokenForProxy(token)

Verification:
- Semantic behaviors: All required method calls present
- Tests: All Phase 04 tests PASS
- Fake patterns: 0 matches
- sanitizeTokenForProxy: Used
```
