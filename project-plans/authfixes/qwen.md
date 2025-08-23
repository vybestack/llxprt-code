# Qwen Provider Authentication - Deep Analysis

## Current Implementation Overview

### Key Files
- **OAuth Provider**: `/packages/cli/src/auth/qwen-oauth-provider.ts`
- **Device Flow**: `/packages/core/src/auth/qwen-device-flow.ts`
- **Integration**: `/packages/core/src/providers/openai/OpenAIProvider.ts` (Qwen uses OpenAI provider)
- **Tests**: `/packages/cli/test/integration/qwen-oauth-e2e.integration.test.ts`

## Current Authentication Flow

### 1. OAuth Initialization (`qwen-oauth-provider.ts`)

```typescript
// Lines 14-27: Current implementation
export class QwenOAuthProvider implements OAuthProvider {
  name = 'qwen';
  private deviceFlow: QwenDeviceFlow;
  private currentToken: OAuthToken | null = null; // ❌ PROBLEM: In-memory only

  constructor() {
    const config: DeviceFlowConfig = {
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    };
    this.deviceFlow = new QwenDeviceFlow(config);
  }
```

**Issues:**
- Token stored only in `currentToken` variable
- No `TokenStore` integration
- Lost on process exit

### 2. Token Retrieval (`qwen-oauth-provider.ts:69-71`)

```typescript
async getToken(): Promise<OAuthToken | null> {
  return this.currentToken; // ❌ PROBLEM: Returns in-memory token only
}
```

**Issues:**
- Doesn't check persisted tokens
- No fallback to stored tokens

### 3. Token Refresh (`qwen-oauth-provider.ts:73-97`)

```typescript
async refreshIfNeeded(): Promise<OAuthToken | null> {
  if (!this.currentToken) {
    return null;
  }

  // Check if token needs refresh (30 second buffer)
  const now = Date.now() / 1000;
  const expiresAt = this.currentToken.expiry;

  if (expiresAt && expiresAt - now < 30) {
    if (this.currentToken.refresh_token) {
      try {
        this.currentToken = await this.deviceFlow.refreshToken(
          this.currentToken.refresh_token,
        ); // ❌ PROBLEM: Doesn't persist refreshed token
      } catch (error) {
        console.error('Failed to refresh Qwen token:', error);
        return null;
      }
    }
  }

  return this.currentToken;
}
```

**Issues:**
- Refreshed token not saved to storage
- Error handling loses authentication state

## Required Changes

### 1. Add Token Persistence

#### File: `/packages/cli/src/auth/qwen-oauth-provider.ts`

**Current Constructor (Lines 19-27):**
```typescript
constructor() {
  const config: DeviceFlowConfig = {
    // ... config
  };
  this.deviceFlow = new QwenDeviceFlow(config);
}
```

**Required Change:**
```typescript
constructor(private tokenStore: TokenStore) {
  const config: DeviceFlowConfig = {
    // ... config
  };
  this.deviceFlow = new QwenDeviceFlow(config);
  // Load persisted token on initialization
  this.initializeToken();
}

private async initializeToken(): Promise<void> {
  const savedToken = await this.tokenStore.getToken('qwen');
  if (savedToken && !this.isTokenExpired(savedToken)) {
    // Token is valid, no need to re-authenticate
    return;
  }
}

private isTokenExpired(token: OAuthToken): boolean {
  const now = Date.now() / 1000;
  return token.expiry <= now + 30; // 30-second buffer
}
```

**Update initiateAuth (Lines 29-67):**
```typescript
async initiateAuth(): Promise<void> {
  // ... existing device flow code ...
  
  // Poll for token
  const token = await this.deviceFlow.pollForToken(
    deviceCodeResponse.device_code,
  );
  
  // ✅ NEW: Save token to persistent storage
  await this.tokenStore.saveToken('qwen', token);
}
```

**Update getToken (Lines 69-71):**
```typescript
async getToken(): Promise<OAuthToken | null> {
  // ✅ NEW: Get from persistent storage
  return await this.tokenStore.getToken('qwen');
}
```

**Update refreshIfNeeded (Lines 73-97):**
```typescript
async refreshIfNeeded(): Promise<OAuthToken | null> {
  const currentToken = await this.tokenStore.getToken('qwen');
  
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
        await this.tokenStore.saveToken('qwen', refreshedToken);
        return refreshedToken;
      } catch (error) {
        console.error('Failed to refresh Qwen token:', error);
        // ✅ NEW: Remove invalid token
        await this.tokenStore.removeToken('qwen');
        return null;
      }
    }
  }

  return currentToken;
}
```

### 2. Add Logout Functionality

#### File: `/packages/cli/src/auth/qwen-oauth-provider.ts`

**Add New Method:**
```typescript
async logout(): Promise<void> {
  // Clear from persistent storage
  await this.tokenStore.removeToken('qwen');
  console.log('Successfully logged out from Qwen');
}
```

### 3. Update OAuth Manager Integration

#### File: `/packages/cli/src/auth/oauth-manager.ts`

**Current authenticate method (Lines 97-128):**
```typescript
async authenticate(providerName: string): Promise<OAuthToken | null> {
  // ... existing code ...
  
  // ❌ PROBLEM: Provider instantiated without TokenStore
  const provider = this.providers.get(providerName);
}
```

**Required Change in registerProvider:**
```typescript
private registerProviders(): void {
  // ✅ NEW: Pass tokenStore to providers
  this.providers.set('qwen', new QwenOAuthProvider(this.tokenStore));
  this.providers.set('anthropic', new AnthropicOAuthProvider(this.tokenStore));
  this.providers.set('gemini', new GeminiOAuthProvider(this.tokenStore));
}
```

### 4. Update OpenAI Provider Integration

#### File: `/packages/core/src/providers/openai/OpenAIProvider.ts`

**Current OAuth check (Lines 176-240):**
```typescript
private async updateClientWithResolvedAuth(): Promise<void> {
  const resolvedToken = await this.getAuthToken();
  
  if (this.isQwenEndpoint(this.baseURL)) {
    // Handle Qwen OAuth token
    const oauthToken = await this.getOAuthTokenIfEnabled();
    if (oauthToken?.resource_url) {
      this.baseURL = oauthToken.resource_url;
    }
  }
}
```

**No changes needed here** - This will continue to work with persisted tokens.

## Integration Points and Dependencies

### 1. Token Store Chain
```
QwenOAuthProvider 
  ↓ (saves/retrieves)
MultiProviderTokenStore
  ↓ (reads/writes)
~/.llxprt/oauth/qwen.json
```

### 2. Authentication Flow
```
User Command → OAuthManager → QwenOAuthProvider → QwenDeviceFlow
                    ↓                   ↓
              TokenStore         Browser Auth
```

### 3. Provider Manager Integration
```
OpenAIProvider.isQwenEndpoint() 
  ↓ (checks)
BaseProvider.getAuthToken()
  ↓ (resolves)
AuthPrecedenceResolver
  ↓ (fallback to)
OAuth Authentication
```

## Testing Requirements

### New Test Cases Needed

#### File: `/packages/cli/test/auth/qwen-oauth-provider.test.ts` (NEW)
```typescript
describe('QwenOAuthProvider with persistence', () => {
  it('should load persisted token on initialization');
  it('should save token after successful authentication');
  it('should persist refreshed tokens');
  it('should remove token on logout');
  it('should handle corrupted token files gracefully');
});
```

#### Update: `/packages/cli/test/integration/qwen-oauth-e2e.integration.test.ts`
- Add test for token persistence across process restarts
- Add test for logout functionality
- Add test for expired token refresh with persistence

## Risks and Mitigations

### 1. Breaking Constructor Change
**Risk**: All instantiations of `QwenOAuthProvider` need updating
**Mitigation**: 
- Search for all usages: `new QwenOAuthProvider()`
- Update in `OAuthManager.registerProviders()`
- Update test files

### 2. Token File Corruption
**Risk**: Corrupted JSON in token file crashes provider
**Mitigation**: 
- `MultiProviderTokenStore` already handles JSON parse errors
- Returns `null` for invalid tokens

### 3. Concurrent CLI Instances
**Risk**: Multiple CLI processes accessing same token file
**Mitigation**: 
- `MultiProviderTokenStore` uses atomic file operations
- Write to temp file then rename

### 4. Server-Side Token Invalidation
**Risk**: Logout doesn't invalidate token on Qwen servers
**Mitigation**: 
- Document that tokens remain valid until expiry
- Consider adding server-side revocation in future

## Implementation Checklist

### Phase 1: Core Changes
- [ ] Update `QwenOAuthProvider` constructor to accept `TokenStore`
- [ ] Add `initializeToken()` method
- [ ] Update `initiateAuth()` to save tokens
- [ ] Update `getToken()` to read from storage
- [ ] Update `refreshIfNeeded()` to persist refreshed tokens
- [ ] Add `logout()` method

### Phase 2: Integration
- [ ] Update `OAuthManager.registerProviders()` to pass `TokenStore`
- [ ] Add logout command to CLI
- [ ] Update auth status command to show token expiry

### Phase 3: Testing
- [ ] Add unit tests for persistence
- [ ] Add integration tests for full flow
- [ ] Add tests for error scenarios
- [ ] Manual testing with real Qwen OAuth

## Migration Path

### For Existing Users
1. Check for tokens in memory (backward compatibility)
2. If found, save to persistent storage
3. Future runs use persisted tokens

### Code Example:
```typescript
private async migrateInMemoryToken(): Promise<void> {
  if (this.currentToken && !(await this.tokenStore.getToken('qwen'))) {
    await this.tokenStore.saveToken('qwen', this.currentToken);
    this.currentToken = null; // Clear in-memory storage
  }
}
```

## Summary

The Qwen provider requires minimal but critical changes:
1. **Constructor change** to accept `TokenStore`
2. **Token operations** to use persistent storage instead of memory
3. **Logout method** to clear stored tokens
4. **Error handling** improvements for token refresh failures

These changes will make Qwen authentication persist across CLI restarts and allow users to logout without exiting the application.