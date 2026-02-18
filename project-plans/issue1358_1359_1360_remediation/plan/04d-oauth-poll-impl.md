# Phase 04d: OAuth Poll Implementation

## Phase ID

`PLAN-20250217-CREDPROXY-REMEDIATION.P04d`

## Purpose

Implement **real** `handleOAuthPoll` that:
1. Retrieves session with device_code and flow instance
2. Calls `flowInstance.pollForToken(deviceCode)`
3. Returns PENDING status if authorization not yet complete
4. Stores token in backingStore when complete
5. Returns sanitized token (no refresh_token)
6. Cleans up session after completion

---

## Prerequisites

- Phase 04c completed (oauth_poll TDD verification passed)
- Tests exist and fail against NOT_IMPLEMENTED stub

---

## Implementation

### File: `packages/cli/src/auth/proxy/credential-proxy-server.ts`

Replace the fake `handleOAuthPoll` with real implementation:

```typescript
/**
 * Handle OAuth poll request for device_code flows.
 * 
 * Polls the provider to check if the user has completed authorization.
 * Returns pending status until complete, then stores and returns the token.
 * 
 * @param socket - The client socket
 * @param id - Request ID for response correlation
 * @param payload - Contains session_id from oauth_initiate
 */
private async handleOAuthPoll(
  socket: net.Socket,
  id: number,
  payload: Record<string, unknown>
): Promise<void> {
  const sessionId = payload.session_id as string | undefined;

  // Validate required fields
  if (!sessionId) {
    return this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
  }

  // Retrieve session
  const session = this.oauthSessions.get(sessionId);
  if (!session) {
    return this.sendError(socket, id, 'SESSION_NOT_FOUND', 'OAuth session not found');
  }

  // Check if session already completed
  if (session.used) {
    return this.sendError(socket, id, 'SESSION_ALREADY_USED', 'OAuth session already completed');
  }

  // Check session expiry
  const sessionTimeout = this.options.oauthSessionTimeoutMs ?? 600000; // 10 min default
  if (Date.now() - session.createdAt > sessionTimeout) {
    this.oauthSessions.delete(sessionId);
    return this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
  }

  // Verify session has flow instance and device_code (required for polling)
  if (!session.flowInstance) {
    return this.sendError(socket, id, 'INTERNAL_ERROR', 'Session missing flow instance');
  }
  if (!session.deviceCode) {
    return this.sendError(socket, id, 'INTERNAL_ERROR', 'Session missing device_code');
  }

  try {
    // Poll the provider for token
    const token = await session.flowInstance.pollForToken(session.deviceCode);

    // Success! Token received from provider
    // Mark session as used BEFORE storing to prevent race conditions
    session.used = true;

    // Store FULL token (including refresh_token) in backing store
    await this.options.tokenStore.saveToken(
      session.provider,
      token,
      session.bucket
    );

    // Return SANITIZED token (no refresh_token crosses socket boundary)
    const sanitized = this.sanitizeTokenForProxy(token);

    this.sendOk(socket, id, {
      status: 'complete',
      token: sanitized,
    });

    // Clean up session
    this.oauthSessions.delete(sessionId);

  } catch (error: unknown) {
    // Handle provider-specific polling responses
    const err = error as Error & { code?: string; newInterval?: number };
    const errorCode = err.code || err.message;

    switch (errorCode) {
      case 'authorization_pending':
        // User hasn't completed authorization yet - this is normal
        return this.sendOk(socket, id, {
          status: 'pending',
        });

      case 'slow_down':
        // Provider asking us to slow down polling
        // Return pending with increased interval
        const newInterval = err.newInterval ?? (session.pollInterval ?? 5) + 5;
        session.pollInterval = newInterval;
        return this.sendOk(socket, id, {
          status: 'pending',
          interval: newInterval,
        });

      case 'expired_token':
        // Device code expired - session is dead
        this.oauthSessions.delete(sessionId);
        return this.sendError(socket, id, 'SESSION_EXPIRED', 'Device code expired');

      case 'access_denied':
        // User denied authorization
        this.oauthSessions.delete(sessionId);
        return this.sendError(socket, id, 'ACCESS_DENIED', 'User denied authorization');

      default:
        // Unexpected error
        this.logger?.error?.('OAuth poll error', { error: err.message, sessionId });
        return this.sendError(socket, id, 'POLL_FAILED', err.message || 'Poll failed');
    }
  }
}

/**
 * Sanitize token for proxy response.
 * Removes refresh_token and other sensitive fields that should not
 * cross the socket boundary.
 */
private sanitizeTokenForProxy(token: OAuthToken): Omit<OAuthToken, 'refresh_token'> {
  const { refresh_token, ...sanitized } = token;
  return sanitized;
}
```

### Session Type Updates

Ensure the session type includes fields needed for polling:

```typescript
interface OAuthSession {
  provider: string;
  bucket?: string;
  flowInstance: OAuthFlow;
  flowType: 'pkce_redirect' | 'browser_redirect' | 'device_code';
  deviceCode?: string;       // For device_code flows
  pkceState?: string;        // For pkce_redirect flows
  pollInterval?: number;     // Current poll interval (can increase on slow_down)
  createdAt: number;
  used: boolean;
}
```

### handleOAuthInitiate Updates

Ensure `handleOAuthInitiate` stores `deviceCode` in session for device_code flows:

```typescript
// In handleOAuthInitiate, after initiating device_code flow:
if (flowType === 'device_code') {
  const deviceResult = await flowInstance.initiateDeviceFlow();
  
  this.oauthSessions.set(sessionId, {
    provider,
    bucket,
    flowInstance,
    flowType,
    deviceCode: deviceResult.device_code,  // CRITICAL: Store device_code for polling
    pollInterval: deviceResult.interval ?? 5,
    createdAt: Date.now(),
    used: false,
  });

  return this.sendOk(socket, id, {
    flow_type: 'device_code',
    session_id: sessionId,
    user_code: deviceResult.user_code,
    verification_uri: deviceResult.verification_uri,
    verification_uri_complete: deviceResult.verification_uri_complete,
    pollIntervalMs: (deviceResult.interval ?? 5) * 1000,
    expiresIn: deviceResult.expires_in,
  });
}
```

---

## Semantic Implementation Requirements

The implementation MUST have these behaviors:

1. **MUST retrieve session** with deviceCode and flowInstance
2. **MUST call flowInstance.pollForToken(deviceCode)**
3. **MUST handle authorization_pending** → return pending status
4. **MUST handle slow_down** → return pending with increased interval
5. **MUST store FULL token** (including refresh_token) ONLY on completion
6. **MUST sanitize response** (remove refresh_token) on completion
7. **MUST mark session as used** on completion

Verify:
```bash
grep -n "oauthSessions.get\|pollForToken\|authorization_pending\|slow_down\|tokenStore.saveToken\|sanitize" packages/cli/src/auth/proxy/credential-proxy-server.ts
# Expected: All patterns found in handleOAuthPoll
```

---

## Anti-Fake Verification

```bash
# NO hardcoded tokens
grep -n "test_access_\|fake_\|dummy_" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i poll
# Expected: 0 matches

# NO immediate token return without polling
grep -A30 "handleOAuthPoll" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -q "pollForToken"
# Expected: Match found

# NO TODO admissions of fake code
grep -n "TODO.*real\|TODO.*actual\|In real implementation\|for testing\|simulate" packages/cli/src/auth/proxy/credential-proxy-server.ts | grep -i poll
# Expected: 0 matches
```

---

## Test Verification

After implementation, all tests should pass:

```bash
npm test -- packages/cli/src/auth/proxy/__tests__/oauth-poll.spec.ts
# Expected: ALL PASS
```

---

## Success Criteria

1. [ ] handleOAuthPoll calls flowInstance.pollForToken(deviceCode)
2. [ ] Returns pending status on authorization_pending
3. [ ] Returns pending with increased interval on slow_down
4. [ ] Stores FULL token (including refresh_token) on completion
5. [ ] Returns SANITIZED token (no refresh_token) on completion
6. [ ] Session marked as used before storage (prevent races)
7. [ ] Session cleaned up after completion
8. [ ] Error cases handled: expired_token, access_denied
9. [ ] 30+ meaningful lines of code
10. [ ] All tests pass
11. [ ] No fake patterns

---

## Build Verification

```bash
npm run typecheck
npm run lint
npm test -- packages/cli/src/auth/proxy/
npm run build
```

---

## Phase Completion Marker

Create: `project-plans/issue1358_1359_1360_remediation/.completed/P04d.md`
