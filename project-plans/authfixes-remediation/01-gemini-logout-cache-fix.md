# Phase 1: Gemini OAuth Logout Cache Fix (P1 - Critical Security Issue)

## Problem Analysis

**Issue**: When users logout from Gemini OAuth, the in-memory cache `oauthClientPromises` in `/packages/core/src/code_assist/oauth2.ts` is not cleared, causing:
- Stale OAuth clients to remain in memory
- Potential token leakage between users
- Incorrect authentication state after logout
- Security vulnerability where old sessions aren't properly invalidated

**Root Cause**: The `oauthClientPromises` Map at line 70 in `oauth2.ts` caches OAuth2Client instances but has no cleanup mechanism when logout occurs.

## Technical Solution

### Step 1: Add Cache Clearing Function

**File**: `/packages/core/src/code_assist/oauth2.ts`

Add new function after line 503:

```typescript
/**
 * Clear cached OAuth client for a specific auth type
 * Used during logout to ensure complete session cleanup
 */
export function clearOauthClientCache(authType?: AuthType): void {
  if (authType) {
    // Clear specific auth type
    oauthClientPromises.delete(authType);
  } else {
    // Clear all cached clients (full logout)
    oauthClientPromises.clear();
  }
}
```

### Step 2: Update GeminiOAuthProvider Logout

**File**: `/packages/cli/src/auth/gemini-oauth-provider.ts`

Update the `logout()` method (lines 74-86):

```typescript
async logout(): Promise<void> {
  // Clear current token
  this.currentToken = null;
  
  // Remove from storage if available
  if (this.tokenStore) {
    try {
      await this.tokenStore.removeToken('gemini');
    } catch (error) {
      console.debug('Failed to remove Gemini token from storage:', error);
    }
  }
  
  // CRITICAL: Clear OAuth client cache to prevent session leakage
  const { clearOauthClientCache } = await import('@vybestack/llxprt-code-core');
  try {
    clearOauthClientCache(); // Clear all cached clients for complete logout
    console.debug('Cleared Gemini OAuth client cache');
  } catch (error) {
    console.warn('Failed to clear OAuth client cache:', error);
  }
}
```

### Step 3: Update OAuth Manager Logout

**File**: `/packages/cli/src/auth/oauth-manager.ts`

Update the Gemini-specific logout section (around lines 248-279):

```typescript
// Special handling for Gemini - clear all Google OAuth related files
if (providerName === 'gemini') {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const llxprtDir = path.join(os.homedir(), '.llxprt');
    
    // Clear the OAuth credentials
    const legacyCredsPath = path.join(llxprtDir, 'oauth_creds.json');
    try {
      await fs.unlink(legacyCredsPath);
      console.log('Cleared Gemini OAuth credentials');
    } catch {
      // File might not exist
    }
    
    // Clear the Google accounts file
    const googleAccountsPath = path.join(llxprtDir, 'google_accounts.json');
    try {
      await fs.unlink(googleAccountsPath);
      console.log('Cleared Google account info');
    } catch {
      // File might not exist
    }
    
    // CRITICAL: Clear OAuth client cache to prevent session leakage
    try {
      const { clearOauthClientCache } = await import('@vybestack/llxprt-code-core');
      clearOauthClientCache(); // Clear all cached OAuth clients
      console.debug('Cleared OAuth client cache for Gemini logout');
    } catch (error) {
      console.warn('Failed to clear OAuth client cache:', error);
    }
    
    // Force the OAuth client to re-authenticate by clearing any cached state
    // The next request will need to re-authenticate
  } catch (error) {
    console.debug('Error clearing Gemini credentials:', error);
  }
}
```

## Implementation Details

### Function Signature
```typescript
export function clearOauthClientCache(authType?: AuthType): void
```

### Parameters
- `authType` (optional): Specific auth type to clear. If omitted, clears all cached clients.

### Side Effects
- Removes OAuth2Client instances from memory
- Forces re-authentication on next OAuth request
- Prevents token leakage between sessions

## Testing Requirements

### Unit Tests
**File**: `/packages/core/src/code_assist/oauth2.test.ts`

Add test cases:
```typescript
describe('clearOauthClientCache', () => {
  beforeEach(() => {
    resetOauthClientForTesting();
  });

  it('should clear specific auth type from cache', async () => {
    // Setup: Create cached client
    const config = new Config();
    await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
    
    // Verify cached
    expect(oauthClientPromises.has(AuthType.LOGIN_WITH_GOOGLE)).toBe(true);
    
    // Clear specific type
    clearOauthClientCache(AuthType.LOGIN_WITH_GOOGLE);
    
    // Verify cleared
    expect(oauthClientPromises.has(AuthType.LOGIN_WITH_GOOGLE)).toBe(false);
  });

  it('should clear all auth types when no parameter provided', async () => {
    const config = new Config();
    await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
    await getOauthClient(AuthType.CLOUD_SHELL, config);
    
    expect(oauthClientPromises.size).toBeGreaterThan(0);
    
    clearOauthClientCache(); // Clear all
    
    expect(oauthClientPromises.size).toBe(0);
  });
});
```

### Integration Tests
**File**: `/packages/cli/test/auth/gemini-oauth-provider.test.ts`

Add test case:
```typescript
describe('GeminiOAuthProvider logout', () => {
  it('should clear OAuth client cache on logout', async () => {
    const tokenStore = new MockTokenStore();
    const provider = new GeminiOAuthProvider(tokenStore);
    
    // Mock the cache clearing function
    const clearCacheSpy = jest.fn();
    jest.doMock('@vybestack/llxprt-code-core', () => ({
      clearOauthClientCache: clearCacheSpy
    }));
    
    await provider.logout();
    
    expect(clearCacheSpy).toHaveBeenCalledWith(); // Called with no args (clear all)
  });
});
```

## Security Impact

### Before Fix
- OAuth clients remain in memory after logout
- Potential for cross-session token leakage
- Incomplete logout leaves authentication state

### After Fix
- Complete session cleanup
- No cached OAuth clients after logout
- Proper security boundary enforcement

## Performance Impact
- Minimal: Cache clearing is O(1) or O(n) for full clear
- Next authentication will recreate client (acceptable cost)
- No network calls involved in cache clearing

## Rollback Plan
If issues occur:
1. Remove `clearOauthClientCache()` calls from logout methods
2. Revert to original logout implementation
3. OAuth clients will still be cleared on process restart

## Success Criteria
1. `oauthClientPromises.size` is 0 after Gemini logout
2. Next Gemini authentication creates fresh OAuth client
3. No token leakage between different user sessions
4. All existing logout functionality still works
5. Integration tests pass with cache clearing

## Dependencies
- No new dependencies required
- Uses existing `AuthType` enum
- Compatible with existing OAuth2Client infrastructure

## Deployment Notes
- This is a pure internal fix with no external API changes
- Safe to deploy without coordination
- Should be deployed ASAP due to security implications