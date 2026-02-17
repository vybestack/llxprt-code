# Plan 04: handleOAuthExchange — Implement Real Token Exchange

**Spec Reference**: technical-overview.md Section 8  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: Plans 01, 02, 03

---

## Overview

The `handleOAuthExchange` handler currently creates fake tokens (`test_access_${sessionId}`). The real implementation must:

1. Validate the session exists and is not expired/used
2. Verify the flow type is compatible with `oauth_exchange` (only `pkce_redirect`)
3. Call the provider-specific exchange method with the authorization code
4. Store the FULL token (including refresh_token) in `KeyringTokenStore`
5. Return the SANITIZED token (no refresh_token) to the inner process
6. Clean up the session

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| REQ-04.1 | Spec §8 | `oauth_exchange` only valid for `pkce_redirect` flows |
| REQ-04.2 | Spec §8 | Must call provider-specific exchange method |
| REQ-04.3 | Spec §6 | Full token stored in KeyringTokenStore |
| REQ-04.4 | Spec §6 | Only sanitized token returned to inner |
| REQ-04.5 | Spec §8 | Session marked used before exchange attempt |
| REQ-04.6 | Spec §8 | Session cleaned up after exchange |

---

## Current State (Stub)

```typescript
// packages/cli/src/auth/proxy/credential-proxy-server.ts (lines 558-604)
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sessionId = payload.session_id as string | undefined;
  const code = payload.code as string | undefined;
  if (!sessionId) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
    return;
  }
  if (!code) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing code');
    return;
  }

  const session = this.oauthSessions.get(sessionId);
  if (!session) {
    this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session not found or expired');
    return;
  }

  // STUB: Simulate successful exchange
  const token: OAuthToken = {
    access_token: `test_access_${sessionId}`,
    token_type: 'Bearer',
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };

  await this.options.tokenStore.saveToken(session.provider, token, session.bucket);
  this.oauthSessions.delete(sessionId);
  const sanitized = sanitizeTokenForProxy(token);
  this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
}
```

---

## Target State

```typescript
private async handleOAuthExchange(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const sessionId = payload.session_id as string | undefined;
  const code = payload.code as string | undefined;
  
  if (!sessionId) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing session_id');
    return;
  }
  if (!code) {
    this.sendError(socket, id, 'INVALID_REQUEST', 'Missing code');
    return;
  }

  const session = this.oauthSessions.get(sessionId);
  if (!session) {
    this.sendError(socket, id, 'SESSION_NOT_FOUND', 'OAuth session not found or expired');
    return;
  }

  // Check if session was already used (replay prevention)
  if (session.used) {
    this.sendError(socket, id, 'SESSION_ALREADY_USED', 'OAuth session already used');
    return;
  }

  // Check session timeout (10 minutes)
  const SESSION_TIMEOUT_MS = 10 * 60 * 1000;
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    this.oauthSessions.delete(sessionId);
    this.sendError(socket, id, 'SESSION_EXPIRED', 'OAuth session expired');
    return;
  }

  // Validate flow type compatibility
  if (session.flowType !== 'pkce_redirect') {
    this.sendError(
      socket,
      id,
      'INVALID_REQUEST',
      `Operation oauth_exchange is not valid for flow type ${session.flowType}. Use oauth_poll instead.`,
    );
    return;
  }

  // Mark session as used BEFORE exchange attempt (prevents concurrent use)
  session.used = true;

  try {
    // Call provider-specific exchange
    const token = await this.exchangeCodeForToken(session, code);
    
    // Validate token has required fields
    if (!token.access_token) {
      throw new Error('Token exchange returned invalid token: missing access_token');
    }

    // Store FULL token (including refresh_token) in KeyringTokenStore
    await this.options.tokenStore.saveToken(session.provider, token, session.bucket);

    // Clean up session
    this.oauthSessions.delete(sessionId);

    // Return SANITIZED token (no refresh_token)
    const sanitized = sanitizeTokenForProxy(token);
    this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
  } catch (err) {
    // Clean up session on failure
    this.oauthSessions.delete(sessionId);
    
    // Sanitize error message (don't leak internal details)
    const message = err instanceof Error 
      ? this.sanitizeErrorMessage(err.message) 
      : 'Token exchange failed';
    this.sendError(socket, id, 'EXCHANGE_FAILED', message);
  }
}

/**
 * Provider-specific code-to-token exchange.
 */
private async exchangeCodeForToken(
  session: OAuthSession,
  code: string,
): Promise<OAuthToken> {
  const { provider, flowInstance } = session;

  switch (provider) {
    case 'anthropic':
      return this.exchangeAnthropicCode(flowInstance as AnthropicDeviceFlow, code);
    case 'codex':
      return this.exchangeCodexCode(flowInstance as CodexDeviceFlow, code, session);
    case 'gemini':
      return this.exchangeGeminiCode(flowInstance as OAuth2Client, code);
    default:
      throw new Error(`Exchange not supported for provider: ${provider}`);
  }
}

/**
 * Anthropic code exchange.
 * Code format: "code#state" (combined string pasted by user)
 */
private async exchangeAnthropicCode(
  flow: AnthropicDeviceFlow,
  code: string,
): Promise<OAuthToken> {
  // Anthropic expects code#state format
  return flow.exchangeCodeForToken(code);
}

/**
 * Codex code exchange (browser_redirect flow).
 * Note: device_code flow uses oauth_poll, not oauth_exchange.
 */
private async exchangeCodexCode(
  flow: CodexDeviceFlow,
  code: string,
  session: OAuthSession,
): Promise<OAuthToken> {
  // Extract state from code if present (format: code?state=xxx)
  const url = new URL('http://dummy?' + code.split('?')[1] || '');
  const authCode = code.split('?')[0];
  const state = url.searchParams.get('state') || '';
  const redirectUri = 'https://auth.openai.com/deviceauth/callback';
  
  return flow.exchangeCodeForToken(authCode, redirectUri, state);
}

/**
 * Gemini code exchange using OAuth2Client.
 * 
 * IMPORTANT: authWithCode returns boolean, not token.
 * Tokens are side-effected onto client.credentials.
 */
private async exchangeGeminiCode(
  client: OAuth2Client,
  code: string,
): Promise<OAuthToken> {
  const redirectUri = 'https://codeassist.google.com/authcode';
  
  // Get the stored PKCE verifier
  // OAuth2Client stores this after generateCodeVerifierAsync()
  const codeVerifier = (client as any)._codeVerifier;
  
  // Exchange code for tokens
  const { tokens } = await client.getToken({
    code,
    redirect_uri: redirectUri,
    codeVerifier: codeVerifier?.codeVerifier,
  });
  
  client.setCredentials(tokens);
  
  // Convert Google Credentials to OAuthToken format
  return this.convertGeminiCredentials(tokens);
}

/**
 * Convert Google Credentials to OAuthToken format.
 * Per spec: expiry_date (ms) -> expiry (s)
 */
private convertGeminiCredentials(credentials: Credentials): OAuthToken {
  return {
    access_token: credentials.access_token!,
    // CRITICAL: expiry_date is milliseconds, expiry is seconds
    expiry: credentials.expiry_date 
      ? Math.floor(credentials.expiry_date / 1000)
      : Math.floor(Date.now() / 1000) + 3600,
    token_type: credentials.token_type ?? 'Bearer',
    refresh_token: credentials.refresh_token ?? undefined,
    scope: credentials.scope ?? undefined,
  };
}

/**
 * Sanitize error messages to prevent leaking sensitive data.
 */
private sanitizeErrorMessage(message: string): string {
  // Remove any tokens, codes, or secrets that might be in the message
  return message
    .replace(/access_token[=:]\s*\S+/gi, 'access_token=[REDACTED]')
    .replace(/refresh_token[=:]\s*\S+/gi, 'refresh_token=[REDACTED]')
    .replace(/code[=:]\s*\S+/gi, 'code=[REDACTED]')
    .replace(/verifier[=:]\s*\S+/gi, 'verifier=[REDACTED]')
    .substring(0, 200); // Limit length
}
```

---

## Behavioral Test Scenarios

### Scenario 1: Successful Anthropic code exchange

```gherkin
@given a valid pkce_redirect session exists for anthropic
@when oauth_exchange is called with valid code
@then the token is stored in KeyringTokenStore with refresh_token
@and the response contains access_token but NOT refresh_token
@and the session is deleted
```

**Test Code**:
```typescript
describe('handleOAuthExchange - Anthropic', () => {
  it('exchanges code and returns sanitized token', async () => {
    const fullToken: OAuthToken = {
      access_token: 'real_access_token',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'real_refresh_token',
      scope: 'org:create_api_key user:profile',
    };
    
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'verifier',
        verification_uri_complete: 'https://claude.ai/oauth/authorize',
        expires_in: 1800,
        interval: 5,
      }),
      exchangeCodeForToken: vi.fn().mockResolvedValue(fullToken),
    };
    
    const tokenStore = new InMemoryTokenStore();
    const server = createServer({ 
      tokenStore,
      flowFactories: new Map([['anthropic', () => mockFlow]]),
    });
    
    const client = await connectClient(server);
    
    // Initiate session
    const initResponse = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    const sessionId = initResponse.data.session_id;
    
    // Exchange code
    const exchangeResponse = await client.request('oauth_exchange', {
      session_id: sessionId,
      code: 'auth_code#state_123',
    });
    
    expect(exchangeResponse.ok).toBe(true);
    expect(exchangeResponse.data.access_token).toBe('real_access_token');
    expect(exchangeResponse.data.refresh_token).toBeUndefined(); // SANITIZED
    expect(exchangeResponse.data.scope).toBe('org:create_api_key user:profile');
    
    // Verify full token stored
    const storedToken = await tokenStore.getToken('anthropic');
    expect(storedToken?.refresh_token).toBe('real_refresh_token');
    
    // Verify session cleaned up
    expect(server['oauthSessions'].has(sessionId)).toBe(false);
  });
});
```

### Scenario 2: Wrong flow type returns error

```gherkin
@given a device_code session exists for qwen
@when oauth_exchange is called
@then response is error with code INVALID_REQUEST
@and error message suggests using oauth_poll
```

**Test Code**:
```typescript
describe('handleOAuthExchange - wrong flow type', () => {
  it('rejects exchange for device_code flow', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'qwen_device',
        user_code: 'ABC-123',
        verification_uri: 'https://chat.qwen.ai/oauth/device',
        interval: 5,
      }),
    };
    
    const server = createServer({
      flowFactories: new Map([['qwen', () => mockFlow]]),
    });
    const client = await connectClient(server);
    
    // Initiate device_code session
    const initResponse = await client.request('oauth_initiate', {
      provider: 'qwen',
    });
    
    // Try exchange (wrong operation for device_code)
    const exchangeResponse = await client.request('oauth_exchange', {
      session_id: initResponse.data.session_id,
      code: 'some_code',
    });
    
    expect(exchangeResponse.ok).toBe(false);
    expect(exchangeResponse.code).toBe('INVALID_REQUEST');
    expect(exchangeResponse.error).toContain('Use oauth_poll instead');
  });
});
```

### Scenario 3: Session already used (replay prevention)

```gherkin
@given a pkce_redirect session that was already exchanged
@when oauth_exchange is called again
@then response is error with code SESSION_ALREADY_USED
```

**Test Code**:
```typescript
describe('handleOAuthExchange - replay prevention', () => {
  it('rejects second exchange attempt', async () => {
    const mockFlow = {
      initiateDeviceFlow: vi.fn().mockResolvedValue({
        device_code: 'verifier',
        verification_uri_complete: 'https://example.com',
        expires_in: 1800,
        interval: 5,
      }),
      exchangeCodeForToken: vi.fn().mockResolvedValue({
        access_token: 'token',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
    };
    
    const server = createServer({
      flowFactories: new Map([['anthropic', () => mockFlow]]),
    });
    const client = await connectClient(server);
    
    const initResponse = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    const sessionId = initResponse.data.session_id;
    
    // First exchange succeeds
    await client.request('oauth_exchange', {
      session_id: sessionId,
      code: 'code1',
    });
    
    // Second exchange fails
    const replayResponse = await client.request('oauth_exchange', {
      session_id: sessionId,
      code: 'code2',
    });
    
    expect(replayResponse.ok).toBe(false);
    // Session deleted after first exchange, so it's not found
    expect(replayResponse.code).toBe('SESSION_NOT_FOUND');
  });
});
```

### Scenario 4: Session timeout

```gherkin
@given a pkce_redirect session created more than 10 minutes ago
@when oauth_exchange is called
@then response is error with code SESSION_EXPIRED
```

**Test Code**:
```typescript
describe('handleOAuthExchange - session timeout', () => {
  it('rejects expired session', async () => {
    const server = createServer({
      flowFactories: new Map([['anthropic', () => createMockAnthropicFlow()]]),
    });
    const client = await connectClient(server);
    
    const initResponse = await client.request('oauth_initiate', {
      provider: 'anthropic',
    });
    const sessionId = initResponse.data.session_id;
    
    // Manually expire the session
    const session = server['oauthSessions'].get(sessionId);
    session.createdAt = Date.now() - (11 * 60 * 1000); // 11 minutes ago
    
    const exchangeResponse = await client.request('oauth_exchange', {
      session_id: sessionId,
      code: 'code',
    });
    
    expect(exchangeResponse.ok).toBe(false);
    expect(exchangeResponse.code).toBe('SESSION_EXPIRED');
  });
});
```

### Scenario 5: Gemini credential conversion

```gherkin
@given a valid pkce_redirect session for gemini
@when oauth_exchange succeeds
@then Google credentials are converted to OAuthToken format
@and expiry_date (ms) is converted to expiry (s)
```

**Test Code**:
```typescript
describe('handleOAuthExchange - Gemini credential conversion', () => {
  it('converts expiry_date ms to expiry seconds', async () => {
    const googleCredentials = {
      access_token: 'google_access',
      refresh_token: 'google_refresh',
      expiry_date: 1700000000000, // milliseconds
      token_type: 'Bearer',
      scope: 'email profile',
    };
    
    const mockClient = {
      generateCodeVerifierAsync: vi.fn().mockResolvedValue({
        codeVerifier: 'verifier',
        codeChallenge: 'challenge',
      }),
      generateAuthUrl: vi.fn().mockReturnValue('https://accounts.google.com/...'),
      getToken: vi.fn().mockResolvedValue({ tokens: googleCredentials }),
      setCredentials: vi.fn(),
    };
    
    const tokenStore = new InMemoryTokenStore();
    const server = createServer({
      tokenStore,
      flowFactories: new Map([['gemini', () => mockClient]]),
    });
    const client = await connectClient(server);
    
    const initResponse = await client.request('oauth_initiate', {
      provider: 'gemini',
    });
    
    const exchangeResponse = await client.request('oauth_exchange', {
      session_id: initResponse.data.session_id,
      code: 'google_auth_code',
    });
    
    expect(exchangeResponse.ok).toBe(true);
    // Verify expiry is in seconds, not milliseconds
    expect(exchangeResponse.data.expiry).toBe(1700000000); // seconds
    
    const storedToken = await tokenStore.getToken('gemini');
    expect(storedToken?.expiry).toBe(1700000000);
  });
});
```

---

## Implementation Steps

### Step 4.1: Add session validation

Add timeout and used checks at the start of the handler.

### Step 4.2: Add flow type validation

Check that `session.flowType === 'pkce_redirect'`.

### Step 4.3: Implement provider-specific exchange methods

Add `exchangeAnthropicCode`, `exchangeCodexCode`, `exchangeGeminiCode`.

### Step 4.4: Add credential conversion for Gemini

Implement `convertGeminiCredentials` with proper ms-to-s conversion.

### Step 4.5: Add error sanitization

Implement `sanitizeErrorMessage` to prevent leaking secrets.

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Anthropic exchange works | Unit test with mock flow |
| Gemini credential conversion | Unit test verifies ms-to-s |
| Flow type validation | Unit test for device_code rejection |
| Session replay prevention | Unit test for SESSION_ALREADY_USED |
| Session timeout | Unit test with expired createdAt |
| Full token stored | Unit test checks tokenStore |
| Sanitized token returned | Unit test checks no refresh_token |

---

## Security Considerations

1. **Refresh Token Protection**: The response MUST use `sanitizeTokenForProxy()` to strip refresh_token.

2. **Error Sanitization**: Provider errors can contain tokens in nested fields. Use `sanitizeErrorMessage()`.

3. **Session Single-Use**: Mark `used = true` BEFORE the exchange attempt to prevent race conditions.

4. **Session Cleanup**: Delete session even on failure to prevent retry attacks.

---

## Next Step

Proceed to **05-handle-refresh-token.md** to implement the refresh handler with locks and merge.
