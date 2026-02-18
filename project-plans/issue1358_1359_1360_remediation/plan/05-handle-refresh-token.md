# Plan 05: handleRefreshToken — Implement Real Refresh with Locks and Merge

**Spec Reference**: technical-overview.md Section 6  
**File**: `packages/cli/src/auth/proxy/credential-proxy-server.ts`  
**Prerequisite**: Plans 01, 02

---

## Overview

The `handleRefreshToken` handler currently simulates refresh with fake tokens (`refreshed_${Date.now()}`). The real implementation must:

1. Look up the provider in the `providers` map
2. Get the current token (including refresh_token) from `KeyringTokenStore`
3. Acquire the refresh lock via `tokenStore.acquireRefreshLock()`
4. Double-check the token after lock (another process may have refreshed)
5. Call `provider.refreshToken(currentToken)` to get a new token
6. Merge the new token with the stored token (preserve stored refresh_token if new one missing)
7. Save the merged token
8. Release the lock
9. Return the sanitized token (no refresh_token)

Additionally, the implementation should use the existing `RefreshCoordinator` for rate limiting and retry logic.

---

## Requirements Trace

| Requirement | Source | Description |
|-------------|--------|-------------|
| REQ-05.1 | Spec §6 | Read full token including refresh_token |
| REQ-05.2 | Spec §6 | Acquire advisory lock before refresh |
| REQ-05.3 | Spec §6 | Double-check token validity after lock |
| REQ-05.4 | Spec §6 | Call provider.refreshToken(currentToken) |
| REQ-05.5 | Spec §6 | Merge new token per Token Merge Contract |
| REQ-05.6 | Spec §6 | Save merged token |
| REQ-05.7 | Spec §6 | Release lock |
| REQ-05.8 | Spec §6 | Return sanitized token (no refresh_token) |
| REQ-05.9 | Spec §6 | Rate limit: max 1 refresh per 30s per provider:bucket |
| REQ-05.10 | Spec §6 | Retry transient errors with backoff |
| REQ-05.11 | Spec §6 | Do NOT retry auth errors (401, invalid_grant) |

---

## Current State (Stub)

```typescript
// packages/cli/src/auth/proxy/credential-proxy-server.ts (lines 671-729)
private async handleRefreshToken(
  socket: net.Socket,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const provider = payload.provider as string | undefined;
  const bucket = payload.bucket as string | undefined;
  // ... validation ...

  // STUB: Get existing token (or create fake one)
  let existingToken = await this.options.tokenStore.getToken(provider, bucket);
  if (!existingToken) {
    existingToken = {
      access_token: `initial_${provider}`,
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: `refresh_${provider}`,
    };
  }

  // STUB: Simulate refresh
  const refreshedToken: OAuthToken = {
    ...existingToken,
    access_token: `refreshed_${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) + 3600,
  };

  await this.options.tokenStore.saveToken(provider, refreshedToken, bucket);
  const sanitized = sanitizeTokenForProxy(refreshedToken);
  this.sendOk(socket, id, sanitized as unknown as Record<string, unknown>);
}
```

---

## Target State

```typescript
import { RefreshCoordinator, RefreshResult } from './refresh-coordinator.js';

export class CredentialProxyServer {
  // ... existing fields ...
  private refreshCoordinator: RefreshCoordinator;

  constructor(options: CredentialProxyServerOptions) {
    this.options = options;
    this.providers = options.providers ?? new Map();
    this.flowFactories = options.flowFactories ?? new Map();
    
    // Initialize RefreshCoordinator with provider refresh function
    this.refreshCoordinator = new RefreshCoordinator({
      tokenStore: options.tokenStore,
      refreshFn: (provider, currentToken) => this.callProviderRefresh(provider, currentToken),
      cooldownMs: 30_000, // 30 seconds per spec
    });
  }

  private async handleRefreshToken(
    socket: net.Socket,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const provider = payload.provider as string | undefined;
    const bucket = payload.bucket as string | undefined;
    
    if (!provider) {
      this.sendError(socket, id, 'INVALID_REQUEST', 'Missing provider');
      return;
    }
    if (!this.isProviderAllowed(provider)) {
      this.sendError(socket, id, 'UNAUTHORIZED', `Provider not allowed: ${provider}`);
      return;
    }
    if (!this.isBucketAllowed(bucket)) {
      this.sendError(socket, id, 'UNAUTHORIZED', `Bucket not allowed: ${bucket ?? 'default'}`);
      return;
    }

    // Check provider is configured
    const oauthProvider = this.providers.get(provider);
    if (!oauthProvider) {
      this.sendError(socket, id, 'PROVIDER_NOT_CONFIGURED', `No provider configured for: ${provider}`);
      return;
    }

    // Use RefreshCoordinator for rate limiting and deduplication
    const result = await this.refreshCoordinator.refresh(provider, bucket);
    
    switch (result.status) {
      case 'ok':
        this.sendOk(socket, id, result.token as unknown as Record<string, unknown>);
        break;
      
      case 'rate_limited':
        this.sendError(
          socket,
          id,
          'RATE_LIMITED',
          `Refresh rate limited. Retry after ${result.retryAfter} seconds.`,
        );
        break;
      
      case 'auth_error':
        // Auth error (401, invalid_grant) - user must re-login
        this.sendError(
          socket,
          id,
          'AUTH_ERROR',
          result.error ?? 'Authentication failed. Please login again.',
        );
        break;
      
      case 'error':
        this.sendError(
          socket,
          id,
          'REFRESH_FAILED',
          result.error ?? 'Token refresh failed',
        );
        break;
    }
  }

  /**
   * Calls the appropriate provider's refreshToken method.
   * This is passed to RefreshCoordinator as the refreshFn.
   * 
   * For Gemini: uses OAuth2Client.getAccessToken() instead of provider.refreshToken()
   */
  private async callProviderRefresh(
    provider: string,
    currentToken: OAuthToken,
  ): Promise<OAuthToken> {
    if (provider === 'gemini') {
      return this.refreshGeminiToken(currentToken);
    }

    const oauthProvider = this.providers.get(provider);
    if (!oauthProvider) {
      throw new Error(`No provider configured for: ${provider}`);
    }

    const newToken = await oauthProvider.refreshToken(currentToken);
    if (!newToken) {
      throw new Error('Provider returned null token');
    }

    return newToken;
  }

  /**
   * Gemini-specific refresh using OAuth2Client.
   * Per spec: GeminiOAuthProvider.refreshToken() returns null.
   * Must use OAuth2Client.getAccessToken() instead.
   */
  private async refreshGeminiToken(currentToken: OAuthToken): Promise<OAuthToken> {
    if (!currentToken.refresh_token) {
      throw new Error('Cannot refresh Gemini token: no refresh_token');
    }

    const { OAuth2Client } = await import('google-auth-library');
    const client = new OAuth2Client({
      clientId: '<GEMINI_OAUTH_CLIENT_ID>',
      clientSecret: '<GEMINI_OAUTH_CLIENT_SECRET>',
    });

    // Load existing credentials
    client.setCredentials({
      access_token: currentToken.access_token,
      refresh_token: currentToken.refresh_token,
      expiry_date: currentToken.expiry * 1000, // Convert s to ms
      token_type: currentToken.token_type,
    });

    // getAccessToken() triggers internal refresh when expired
    const { token } = await client.getAccessToken();
    if (!token) {
      throw new Error('Gemini refresh returned no token');
    }

    // Read refreshed credentials from client
    const credentials = client.credentials;
    
    return {
      access_token: credentials.access_token!,
      expiry: credentials.expiry_date 
        ? Math.floor(credentials.expiry_date / 1000) 
        : Math.floor(Date.now() / 1000) + 3600,
      token_type: credentials.token_type ?? 'Bearer',
      refresh_token: credentials.refresh_token ?? currentToken.refresh_token,
      scope: credentials.scope ?? currentToken.scope,
    };
  }
}
```

---

## RefreshCoordinator Integration

The existing `RefreshCoordinator` already handles:

- Rate limiting (30s cooldown per provider:bucket)
- Concurrent request deduplication
- Retry with backoff for transient errors
- Auth error detection (no retry)
- Token merge via `mergeRefreshedToken()`
- Token sanitization via `sanitizeTokenForProxy()`

The handler just needs to:
1. Validate input and check provider exists
2. Call `refreshCoordinator.refresh(provider, bucket)`
3. Map the result status to the appropriate response

---

## Behavioral Test Scenarios

### Scenario 1: Successful refresh

```gherkin
@given a valid token with refresh_token exists for anthropic
@when refresh_token operation is called
@then provider.refreshToken is called with current token
@and merged token is saved
@and sanitized token is returned (no refresh_token)
```

**Test Code**:
```typescript
describe('handleRefreshToken - success', () => {
  it('calls provider refresh and returns sanitized token', async () => {
    const storedToken: OAuthToken = {
      access_token: 'old_access',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) - 100, // Expired
      refresh_token: 'stored_refresh',
    };
    
    const newToken: OAuthToken = {
      access_token: 'new_access',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      // Note: some providers return new refresh_token, some don't
    };
    
    const mockProvider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockResolvedValue(newToken),
    };
    
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.saveToken('anthropic', storedToken);
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: createMockProviderKeyStorage(),
      providers: new Map([['anthropic', mockProvider]]),
    });
    
    const client = await connectClient(server);
    const response = await client.request('refresh_token', {
      provider: 'anthropic',
    });
    
    expect(response.ok).toBe(true);
    expect(response.data.access_token).toBe('new_access');
    expect(response.data.refresh_token).toBeUndefined(); // Sanitized
    
    // Verify provider was called with current token
    expect(mockProvider.refreshToken).toHaveBeenCalledWith(storedToken);
    
    // Verify merged token saved (preserves refresh_token)
    const saved = await tokenStore.getToken('anthropic');
    expect(saved?.access_token).toBe('new_access');
    expect(saved?.refresh_token).toBe('stored_refresh'); // Preserved via merge
  });
});
```

### Scenario 2: Rate limiting

```gherkin
@given a refresh was performed less than 30 seconds ago
@when refresh_token is called again
@then response is error with code RATE_LIMITED
@and retryAfter indicates seconds to wait
```

**Test Code**:
```typescript
describe('handleRefreshToken - rate limiting', () => {
  it('returns RATE_LIMITED within cooldown period', async () => {
    const mockProvider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockResolvedValue({
        access_token: 'refreshed',
        token_type: 'Bearer',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
    };
    
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.saveToken('anthropic', {
      access_token: 'old',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh',
    });
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: createMockProviderKeyStorage(),
      providers: new Map([['anthropic', mockProvider]]),
    });
    
    const client = await connectClient(server);
    
    // First refresh succeeds
    const first = await client.request('refresh_token', { provider: 'anthropic' });
    expect(first.ok).toBe(true);
    
    // Second refresh within 30s is rate limited
    const second = await client.request('refresh_token', { provider: 'anthropic' });
    expect(second.ok).toBe(false);
    expect(second.code).toBe('RATE_LIMITED');
    expect(second.error).toContain('Retry after');
  });
});
```

### Scenario 3: Auth error (no retry)

```gherkin
@given the provider returns 401 or invalid_grant error
@when refresh_token is called
@then response is error with code AUTH_ERROR
@and the error is not retried
```

**Test Code**:
```typescript
describe('handleRefreshToken - auth error', () => {
  it('returns AUTH_ERROR for invalid_grant without retry', async () => {
    const mockProvider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockRejectedValue(new Error('invalid_grant: refresh token expired')),
    };
    
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.saveToken('anthropic', {
      access_token: 'old',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) - 100,
      refresh_token: 'expired_refresh',
    });
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: createMockProviderKeyStorage(),
      providers: new Map([['anthropic', mockProvider]]),
    });
    
    const client = await connectClient(server);
    const response = await client.request('refresh_token', { provider: 'anthropic' });
    
    expect(response.ok).toBe(false);
    expect(response.code).toBe('AUTH_ERROR');
    
    // Verify no retry (only 1 call)
    expect(mockProvider.refreshToken).toHaveBeenCalledTimes(1);
  });
});
```

### Scenario 4: Gemini refresh via OAuth2Client

```gherkin
@given a valid Gemini token with refresh_token exists
@when refresh_token is called for gemini
@then OAuth2Client.getAccessToken() is used instead of provider.refreshToken()
@and credentials are converted from ms to s
```

**Test Code**:
```typescript
describe('handleRefreshToken - Gemini', () => {
  it('uses OAuth2Client for Gemini refresh', async () => {
    const storedToken: OAuthToken = {
      access_token: 'old_gemini_access',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) - 100, // Expired
      refresh_token: 'gemini_refresh',
    };
    
    // Mock google-auth-library
    const mockClient = {
      setCredentials: vi.fn(),
      getAccessToken: vi.fn().mockResolvedValue({ token: 'new_gemini_access' }),
      credentials: {
        access_token: 'new_gemini_access',
        refresh_token: 'gemini_refresh',
        expiry_date: Date.now() + 3600000, // ms
        token_type: 'Bearer',
      },
    };
    
    vi.mock('google-auth-library', () => ({
      OAuth2Client: vi.fn().mockImplementation(() => mockClient),
    }));
    
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.saveToken('gemini', storedToken);
    
    // GeminiOAuthProvider.refreshToken returns null per spec
    const mockGeminiProvider: OAuthProvider = {
      name: 'gemini',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: createMockProviderKeyStorage(),
      providers: new Map([['gemini', mockGeminiProvider]]),
    });
    
    const client = await connectClient(server);
    const response = await client.request('refresh_token', { provider: 'gemini' });
    
    expect(response.ok).toBe(true);
    expect(response.data.access_token).toBe('new_gemini_access');
    
    // Verify OAuth2Client was used
    expect(mockClient.setCredentials).toHaveBeenCalled();
    expect(mockClient.getAccessToken).toHaveBeenCalled();
  });
});
```

### Scenario 5: Concurrent refresh deduplication

```gherkin
@given two concurrent refresh requests for the same provider:bucket
@when both arrive at the same time
@then only one provider.refreshToken call is made
@and both requests receive the same result
```

**Test Code**:
```typescript
describe('handleRefreshToken - deduplication', () => {
  it('deduplicates concurrent requests', async () => {
    let resolveRefresh: (token: OAuthToken) => void;
    const refreshPromise = new Promise<OAuthToken>((resolve) => {
      resolveRefresh = resolve;
    });
    
    const mockProvider: OAuthProvider = {
      name: 'anthropic',
      initiateAuth: vi.fn(),
      getToken: vi.fn(),
      refreshToken: vi.fn().mockReturnValue(refreshPromise),
    };
    
    const tokenStore = new InMemoryTokenStore();
    await tokenStore.saveToken('anthropic', {
      access_token: 'old',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'refresh',
    });
    
    const server = new CredentialProxyServer({
      tokenStore,
      providerKeyStorage: createMockProviderKeyStorage(),
      providers: new Map([['anthropic', mockProvider]]),
    });
    
    const client = await connectClient(server);
    
    // Start two concurrent requests
    const req1 = client.request('refresh_token', { provider: 'anthropic' });
    const req2 = client.request('refresh_token', { provider: 'anthropic' });
    
    // Let the refresh complete
    resolveRefresh!({
      access_token: 'refreshed',
      token_type: 'Bearer',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    });
    
    const [res1, res2] = await Promise.all([req1, req2]);
    
    // Both succeed with same token
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res1.data.access_token).toBe('refreshed');
    expect(res2.data.access_token).toBe('refreshed');
    
    // Only one provider call
    expect(mockProvider.refreshToken).toHaveBeenCalledTimes(1);
  });
});
```

---

## Implementation Steps

### Step 5.1: Add RefreshCoordinator initialization

In constructor:
```typescript
this.refreshCoordinator = new RefreshCoordinator({
  tokenStore: options.tokenStore,
  refreshFn: (provider, currentToken) => this.callProviderRefresh(provider, currentToken),
  cooldownMs: 30_000,
});
```

### Step 5.2: Implement callProviderRefresh

Add the method that calls the appropriate provider, with special handling for Gemini.

### Step 5.3: Implement refreshGeminiToken

Add the OAuth2Client-based refresh for Gemini.

### Step 5.4: Update handleRefreshToken

Replace the stub with coordinator-based implementation.

### Step 5.5: Add cleanup on stop

Reset the coordinator when server stops:
```typescript
async stop(): Promise<void> {
  this.refreshCoordinator.reset();
  // ... existing cleanup
}
```

---

## Verification Criteria

| Criterion | Verification Method |
|-----------|---------------------|
| Provider refresh called | Unit test verifies refreshToken called |
| Token merge works | Unit test verifies refresh_token preserved |
| Rate limiting | Unit test verifies RATE_LIMITED after recent refresh |
| Auth error detection | Unit test verifies AUTH_ERROR for invalid_grant |
| Gemini special path | Unit test verifies OAuth2Client used |
| Concurrent deduplication | Unit test verifies single provider call |
| Sanitization | Unit test verifies no refresh_token in response |

---

## Security Considerations

1. **Refresh Token Never Crosses Socket**: The `sanitizeTokenForProxy()` call ensures this.

2. **Auth Errors Not Retried**: Prevents hammering the provider with invalid credentials.

3. **Rate Limiting**: 30s cooldown prevents abuse.

4. **Error Sanitization**: Provider errors should not leak tokens.

---

## Token Merge Contract

Per spec, the merge algorithm:

1. Start with all fields from `currentToken` (stored)
2. Overlay all non-undefined fields from `newToken` (refreshed)
3. If `newToken.refresh_token` is undefined, preserve `currentToken.refresh_token`

This is implemented in `mergeRefreshedToken()` from `@vybestack/llxprt-code-core`:

```typescript
function mergeRefreshedToken(
  currentToken: OAuthToken,
  newToken: OAuthToken,
): OAuthToken {
  return {
    ...currentToken,
    ...newToken,
    refresh_token: newToken.refresh_token ?? currentToken.refresh_token,
  };
}
```

---

## Completion

This completes the remediation plan for OAuth/Refresh integration. After implementing all five plans:

1. CredentialProxyServer constructor accepts `providers` and `flowFactories`
2. sandbox-proxy-lifecycle.ts wires the maps with real providers
3. handleOAuthInitiate creates appropriate flows per provider
4. handleOAuthExchange performs real token exchange
5. handleRefreshToken uses RefreshCoordinator with real providers

The credential proxy will then be fully functional for sandbox OAuth login and token refresh operations.
