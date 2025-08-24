# Phase 3: Fix Anthropic Logout

## Problem
Anthropic logout doesn't work because:
1. BaseProvider caches auth token for 1 minute
2. Error handling swallows failures
3. Client isn't recreated when auth becomes null

## Solution

### 1. Add Cache Clearing to BaseProvider
**File**: `packages/core/src/providers/BaseProvider.ts`

**Add method**:
```typescript
/**
 * Clear cached authentication token
 * Called on logout to ensure immediate effect
 */
protected clearAuthCache(): void {
  this.cachedAuthToken = undefined;
  this.authCacheTimestamp = undefined;
}
```

### 2. Fix AnthropicProvider Client Management
**File**: `packages/core/src/providers/anthropic/AnthropicProvider.ts`

**Add cached key tracking**:
```typescript
export class AnthropicProvider extends BaseProvider {
  private anthropic: Anthropic;
  private _cachedAuthKey?: string; // ADD THIS
  
  // In updateClientWithResolvedAuth():
  async updateClientWithResolvedAuth(): Promise<void> {
    const resolvedToken = await this.getAuthToken();
    
    // Only recreate client if auth changed
    if (this._cachedAuthKey !== resolvedToken) {
      if (!resolvedToken) {
        // Create client with no auth after logout
        this.anthropic = new Anthropic({
          apiKey: '', // Empty key for no auth
          baseURL: this.baseURL,
          dangerouslyAllowBrowser: true,
        });
      } else if (resolvedToken.startsWith('sk-ant-oat')) {
        // OAuth token handling...
        this.anthropic = new Anthropic({
          authToken: resolvedToken,
          // ...
        });
      } else {
        // API key handling...
        this.anthropic = new Anthropic({
          apiKey: resolvedToken,
          // ...
        });
      }
      
      this._cachedAuthKey = resolvedToken; // Track the key
    }
  }
```

### 3. Fix Logout Error Handling
**File**: `packages/cli/src/auth/anthropic-oauth-provider.ts`

**Current** (lines ~400-453):
```typescript
async logout(): Promise<void> {
  await this.ensureInitialized();
  
  return this.errorHandler.handleGracefully(
    async () => {
      // ... logout logic ...
    },
    undefined, // Swallows errors!
    this.name,
    'logout',
  );
}
```

**Fixed**:
```typescript
async logout(): Promise<void> {
  await this.ensureInitialized();
  
  // NO ERROR SUPPRESSION - let it fail loudly
  if (this._tokenStore) {
    // Try to revoke token with provider (optional)
    let token: OAuthToken | null = null;
    try {
      token = await this._tokenStore.getToken('anthropic');
      if (token && this.deviceFlow.revokeToken) {
        await this.deviceFlow.revokeToken(token.access_token);
      }
    } catch (error) {
      // Log but don't fail - revocation is optional
      console.debug('Token revocation failed (continuing):', error);
    }
    
    // Remove token from storage - THIS MUST SUCCEED
    await this._tokenStore.removeToken('anthropic');
  }
  
  // Clear the auth cache in the provider
  // This requires the provider to expose a method
  this.clearProviderAuthCache();
}

// Add method to clear provider cache
private clearProviderAuthCache(): void {
  // This needs to trigger cache clearing in the AnthropicProvider
  // Could be done via event or callback
}
```

### 4. Connect OAuth Provider to API Provider
Need a mechanism for the OAuth provider to signal the API provider to clear cache.

**Option A: Event-based**
```typescript
// In OAuth provider logout
this.emit('logout', 'anthropic');

// In AnthropicProvider constructor
oauthManager.on('logout', (provider) => {
  if (provider === 'anthropic') {
    this.clearAuthCache();
    this._cachedAuthKey = undefined;
  }
});
```

**Option B: Direct callback**
```typescript
// Pass callback during OAuth provider creation
new AnthropicOAuthProvider(tokenStore, {
  onLogout: () => anthropicProvider.clearAuthCache()
});
```

## Testing
1. Login with Anthropic OAuth
2. Verify can make API calls
3. Logout
4. Immediately try API call → should fail
5. No 1-minute delay for logout to take effect