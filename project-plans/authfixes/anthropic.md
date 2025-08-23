# Anthropic Provider Authentication - Deep Analysis

## Current Implementation Overview

### Key Files
- **OAuth Provider**: `/packages/cli/src/auth/anthropic-oauth-provider.ts`
- **Device Flow**: `/packages/core/src/auth/anthropic-device-flow.ts`
- **Main Provider**: `/packages/core/src/providers/anthropic/AnthropicProvider.ts`
- **OAuth Manager**: `/packages/cli/src/auth/oauth-manager.ts`
- **Tests**: `/packages/core/src/providers/anthropic/AnthropicProvider.oauth.test.ts`

## Current Authentication Flow

### 1. OAuth Provider Implementation (`anthropic-oauth-provider.ts`)

```typescript
// Lines 14-29: Current implementation
export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private currentToken: OAuthToken | null = null; // ❌ PROBLEM: In-memory only
  private authCancelled: boolean = false;

  constructor() {
    this.deviceFlow = new AnthropicDeviceFlow();
  }
```

**Issues:**
- Token stored only in `currentToken` variable
- No `TokenStore` integration in provider itself
- Lost on process exit

### 2. Device Flow Implementation (`anthropic-device-flow.ts`)

```typescript
// Lines 66-97: Simulated device flow
async initiateDeviceFlow(): Promise<DeviceCodeResponse> {
  const { verifier, challenge } = this.generatePKCE();
  this.state = verifier;
  
  // Build authorization URL with PKCE parameters
  const params = new URLSearchParams({
    code: 'true',
    client_id: this.config.clientId,
    response_type: 'code',
    redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    scope: this.config.scopes.join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: verifier,
  });
  
  return {
    device_code: verifier,
    user_code: 'ANTHROPIC',
    verification_uri: 'https://console.anthropic.com/oauth/authorize',
    verification_uri_complete: authUrl,
    expires_in: 1800,
    interval: 5,
  };
}
```

**Note:** Anthropic uses a simulated device flow with PKCE, not true device flow.

### 3. Token Exchange (`anthropic-device-flow.ts:102-159`)

```typescript
async exchangeCodeForToken(authCodeWithState: string): Promise<OAuthToken> {
  // OpenCode splits the code and state - format: code#state
  const splits = authCodeWithState.split('#');
  const authCode = splits[0];
  const stateFromResponse = splits[1] || this.state;
  
  const requestBody = {
    grant_type: 'authorization_code',
    code: authCode,
    state: stateFromResponse,
    client_id: this.config.clientId,
    redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
    code_verifier: this.codeVerifier,
  };
  
  const response = await fetch(this.config.tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', // JSON, not form-encoded!
    },
    body: JSON.stringify(requestBody),
  });
}
```

**Important:** Anthropic uses JSON for token exchange, not form-encoded data.

### 4. Provider Integration (`AnthropicProvider.ts:99-131`)

```typescript
private async updateClientWithResolvedAuth(): Promise<void> {
  const resolvedToken = await this.getAuthToken();
  
  // Check if this is an OAuth token (starts with sk-ant-oat)
  const isOAuthToken = resolvedToken.startsWith('sk-ant-oat');
  
  if (isOAuthToken) {
    // For OAuth tokens, use authToken field which sends Bearer token
    const oauthConfig: Record<string, unknown> = {
      authToken: resolvedToken, // Use authToken for OAuth Bearer tokens
      baseURL: this.baseURL,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'oauth-2025-04-20',
      },
    };
    this.anthropic = new Anthropic(oauthConfig as ClientOptions);
  }
}
```

**Note:** OAuth tokens use `authToken` field with special beta header.

## Current Token Handling Issues

### 1. Token Persistence (`anthropic-oauth-provider.ts`)

```typescript
// Lines 139-160: Current refresh logic
async refreshIfNeeded(): Promise<OAuthToken | null> {
  if (!this.currentToken) {
    return null; // ❌ PROBLEM: Doesn't check persistent storage
  }
  
  const now = Date.now() / 1000;
  const expiresAt = this.currentToken.expiry;
  
  if (expiresAt && expiresAt - now < 30) {
    if (this.currentToken.refresh_token) {
      try {
        this.currentToken = await this.deviceFlow.refreshToken(
          this.currentToken.refresh_token,
        ); // ❌ PROBLEM: Doesn't persist refreshed token
      } catch (error) {
        console.error('Failed to refresh Anthropic token:', error);
        return null;
      }
    }
  }
  
  return this.currentToken;
}
```

### 2. OAuth Manager Integration (`oauth-manager.ts:97-128`)

```typescript
async authenticate(providerName: string): Promise<OAuthToken | null> {
  // ... validation ...
  
  await provider.initiateAuth();
  const token = await provider.getToken();
  
  if (token) {
    // ✅ GOOD: Token is saved to persistent storage here
    await this.tokenStore.saveToken(providerName, token);
    return token;
  }
}
```

**Note:** OAuth Manager does save tokens, but provider doesn't load them on restart.

## Required Changes

### 1. Add Token Persistence to Provider

#### File: `/packages/cli/src/auth/anthropic-oauth-provider.ts`

**Current Constructor (Lines 19-29):**
```typescript
constructor() {
  this.deviceFlow = new AnthropicDeviceFlow();
}
```

**Required Change:**
```typescript
constructor(private tokenStore?: TokenStore) {
  this.deviceFlow = new AnthropicDeviceFlow();
  if (tokenStore) {
    this.initializeToken();
  }
}

private async initializeToken(): Promise<void> {
  if (!this.tokenStore) return;
  
  const savedToken = await this.tokenStore.getToken('anthropic');
  if (savedToken && !this.isTokenExpired(savedToken)) {
    this.currentToken = savedToken;
  }
}

private isTokenExpired(token: OAuthToken): boolean {
  const now = Date.now() / 1000;
  return token.expiry <= now + 30; // 30-second buffer
}
```

**Update getToken (Lines 135-137):**
```typescript
async getToken(): Promise<OAuthToken | null> {
  // If we have tokenStore, always get from there (source of truth)
  if (this.tokenStore) {
    return await this.tokenStore.getToken('anthropic');
  }
  return this.currentToken;
}
```

**Update refreshIfNeeded (Lines 139-160):**
```typescript
async refreshIfNeeded(): Promise<OAuthToken | null> {
  // Get current token from storage if available
  const currentToken = this.tokenStore 
    ? await this.tokenStore.getToken('anthropic')
    : this.currentToken;
    
  if (!currentToken) {
    return null;
  }
  
  const now = Date.now() / 1000;
  const expiresAt = currentToken.expiry;
  
  if (expiresAt && expiresAt - now < 30) {
    if (currentToken.refresh_token) {
      try {
        const refreshedToken = await this.deviceFlow.refreshToken(
          currentToken.refresh_token,
        );
        
        // ✅ NEW: Save refreshed token
        if (this.tokenStore) {
          await this.tokenStore.saveToken('anthropic', refreshedToken);
        } else {
          this.currentToken = refreshedToken;
        }
        
        return refreshedToken;
      } catch (error) {
        console.error('Failed to refresh Anthropic token:', error);
        // ✅ NEW: Remove invalid token
        if (this.tokenStore) {
          await this.tokenStore.removeToken('anthropic');
        }
        this.currentToken = null;
        return null;
      }
    }
  }
  
  return currentToken;
}
```

### 2. Add Logout Functionality

#### File: `/packages/cli/src/auth/anthropic-oauth-provider.ts`

**Add New Method (after line 162):**
```typescript
async logout(): Promise<void> {
  // Clear in-memory token
  this.currentToken = null;
  
  // Clear from persistent storage if available
  if (this.tokenStore) {
    await this.tokenStore.removeToken('anthropic');
  }
  
  console.log('Successfully logged out from Anthropic');
}

async revokeToken(): Promise<void> {
  const token = this.tokenStore 
    ? await this.tokenStore.getToken('anthropic')
    : this.currentToken;
    
  if (!token) {
    throw new Error('No token to revoke');
  }
  
  // Note: Anthropic may not have a revocation endpoint yet
  // This is a placeholder for when they add one
  try {
    await this.deviceFlow.revokeToken(token.access_token);
  } catch (error) {
    console.warn('Token revocation not supported or failed:', error);
  }
  
  await this.logout();
}
```

### 3. Add Token Revocation to Device Flow

#### File: `/packages/core/src/auth/anthropic-device-flow.ts`

**Add New Method (after line 261):**
```typescript
/**
 * Revokes an access token with Anthropic
 * NOTE: This endpoint may not exist yet - placeholder for future API
 */
async revokeToken(accessToken: string): Promise<void> {
  // Anthropic doesn't document a revocation endpoint yet
  // This is a placeholder for when they add one
  const revokeEndpoint = 'https://console.anthropic.com/v1/oauth/revoke';
  
  try {
    const response = await fetch(revokeEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: accessToken,
        client_id: this.config.clientId,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to revoke Anthropic token: ${error}`);
    }
  } catch (error) {
    // If revocation fails, log but don't throw
    // Token will expire naturally
    console.warn('Token revocation failed or not supported:', error);
  }
}
```

### 4. Update OAuth Manager

#### File: `/packages/cli/src/auth/oauth-manager.ts`

**Update registerProviders (Lines 68-80):**
```typescript
private registerProviders(): void {
  // ✅ NEW: Pass tokenStore to providers
  this.providers.set('qwen', new QwenOAuthProvider(this.tokenStore));
  this.providers.set('anthropic', new AnthropicOAuthProvider(this.tokenStore));
  this.providers.set('gemini', new GeminiOAuthProvider(this.tokenStore));
}
```

**Add logout method (after line 425):**
```typescript
async logout(providerName: string): Promise<void> {
  const provider = this.providers.get(providerName);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerName}`);
  }
  
  // Call provider's logout if it exists
  if ('logout' in provider && typeof provider.logout === 'function') {
    await provider.logout();
  } else {
    // Fallback to just removing token
    await this.tokenStore.removeToken(providerName);
  }
  
  // Update settings to disable OAuth for this provider
  const settingsService = getSettingsService();
  await settingsService.updateSetting(
    `auth.${providerName}.oauth.enabled`,
    false,
  );
}
```

### 5. Improve Error Handling in Provider

#### File: `/packages/core/src/providers/anthropic/AnthropicProvider.ts`

**Update updateClientWithResolvedAuth (Lines 99-104):**
```typescript
private async updateClientWithResolvedAuth(): Promise<void> {
  const resolvedToken = await this.getAuthToken();
  
  if (!resolvedToken) {
    const isOAuthEnabled = this.baseProviderConfig.oauthManager?.isOAuthEnabled?.('anthropic');
    
    if (isOAuthEnabled) {
      throw new Error(
        'Anthropic OAuth session expired or not authenticated.\n' +
        'Use `/auth anthropic` to authenticate or `/auth anthropic logout` to clear session.'
      );
    } else {
      throw new Error(
        'No Anthropic API key found.\n' +
        'Provide an API key with --key, ANTHROPIC_API_KEY env var, or enable OAuth with `/auth anthropic enable`'
      );
    }
  }
  
  // ... rest of method
}
```

## Integration Points and Dependencies

### 1. Authentication Precedence Chain
```
Command Key (/key)
    ↓
CLI Argument (--key)
    ↓
Environment Variable (ANTHROPIC_API_KEY)
    ↓
OAuth Token (if enabled)
```

### 2. Token Storage Chain
```
AnthropicOAuthProvider
    ↓ (saves/retrieves via)
OAuthManager
    ↓ (delegates to)
MultiProviderTokenStore
    ↓ (reads/writes)
~/.llxprt/oauth/anthropic.json
```

### 3. API Integration
```
AnthropicProvider.getAuthToken()
    ↓ (resolves via)
BaseProvider.getAuthToken()
    ↓ (uses)
AuthPrecedenceResolver
    ↓ (checks OAuth via)
OAuthManager.getOAuthToken()
```

## Testing Requirements

### New Test Cases Needed

#### File: `/packages/cli/test/auth/anthropic-oauth-provider.test.ts` (NEW)
```typescript
describe('AnthropicOAuthProvider with persistence', () => {
  it('should load persisted token on initialization');
  it('should save token after successful authentication');
  it('should persist refreshed tokens');
  it('should remove token on logout');
  it('should handle token revocation gracefully');
  it('should fall back to in-memory if no tokenStore provided');
});
```

#### Update: `/packages/core/src/providers/anthropic/AnthropicProvider.oauth.test.ts`
- Add test for expired token error messages
- Add test for logout functionality
- Add test for token persistence across provider instances

## Risks and Mitigations

### 1. Breaking Constructor Change
**Risk**: Existing instantiations need updating
**Mitigation**: 
- Make `tokenStore` optional parameter
- Fall back to in-memory storage if not provided
- Update `OAuthManager.registerProviders()`

### 2. Token Revocation API
**Risk**: Anthropic may not have revocation endpoint
**Mitigation**: 
- Implement graceful fallback
- Log warning but don't fail logout
- Document limitation

### 3. OAuth Beta Header
**Risk**: Beta API may change
**Mitigation**: 
- Keep `anthropic-beta: oauth-2025-04-20` header
- Monitor Anthropic API updates
- Version-specific handling if needed

### 4. PKCE State Management
**Risk**: State mismatch in authorization flow
**Mitigation**: 
- Current implementation uses verifier as state
- Maintain backward compatibility

## Implementation Checklist

### Phase 1: Core Changes
- [ ] Update `AnthropicOAuthProvider` constructor to accept optional `TokenStore`
- [ ] Add `initializeToken()` method
- [ ] Update `getToken()` to use storage
- [ ] Update `refreshIfNeeded()` to persist refreshed tokens
- [ ] Add `logout()` method

### Phase 2: Integration
- [ ] Update `OAuthManager.registerProviders()` to pass `TokenStore`
- [ ] Add `logout()` method to `OAuthManager`
- [ ] Update auth command to support logout
- [ ] Improve error messages in `AnthropicProvider`

### Phase 3: Testing
- [ ] Add unit tests for persistence
- [ ] Add integration tests for full flow
- [ ] Test token revocation (when available)
- [ ] Manual testing with real Anthropic OAuth

## Special Considerations

### 1. OAuth Token Format
Anthropic OAuth tokens start with `sk-ant-oat` prefix, which is used to detect OAuth vs API key authentication.

### 2. JSON vs Form-Encoded
Unlike standard OAuth, Anthropic uses JSON for token exchange requests, not form-encoded data.

### 3. Beta API Status
OAuth is still in beta (`anthropic-beta: oauth-2025-04-20` header required), so API may change.

### 4. No True Device Flow
Anthropic simulates device flow with authorization code + PKCE, not true RFC 8628 device flow.

## Summary

The Anthropic provider has a well-structured OAuth implementation but lacks:
1. **Token persistence usage** - Tokens saved but not loaded on restart
2. **Logout functionality** - No way to clear sessions
3. **Token revocation** - No API endpoint documented yet
4. **Better error messages** - Generic errors don't guide users

The proposed changes maintain backward compatibility while adding essential session management features.