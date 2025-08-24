# Phase 4: Fix Gemini Logout

## Problem
Gemini logout may have similar issues to Anthropic:
1. Auth cache not cleared
2. Error handling may suppress failures
3. Special Google OAuth files need cleanup

## Current State
Gemini logout already has special handling for clearing Google OAuth files, but needs to ensure:
1. Auth cache is cleared
2. Errors aren't suppressed
3. OAuth client cache is properly cleared

## Solution

### 1. Ensure Cache Clearing
**File**: `packages/cli/src/auth/gemini-oauth-provider.ts`

**Current** (lines ~244-290):
```typescript
async logout(): Promise<void> {
  await this.ensureInitialized();
  
  return this.errorHandler.handleGracefully(
    async () => {
      // Clear current token
      this.currentToken = null;
      
      // Remove from token storage
      if (this.tokenStore) {
        await this.tokenStore.removeToken('gemini');
      }
      
      // Clear legacy files...
      // Clear OAuth client cache...
    },
    // ...
  );
}
```

**Fixed**:
```typescript
async logout(): Promise<void> {
  await this.ensureInitialized();
  
  // NO ERROR SUPPRESSION for critical operations
  
  // Clear current token
  this.currentToken = null;
  
  // Remove from token storage - MUST SUCCEED
  if (this.tokenStore) {
    await this.tokenStore.removeToken('gemini');
  }
  
  // Clear legacy Google OAuth files (best effort)
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    const llxprtDir = path.join(os.homedir(), '.llxprt');
    
    // Clear OAuth credentials
    try {
      await fs.unlink(path.join(llxprtDir, 'oauth_creds.json'));
    } catch {
      // File might not exist
    }
    
    // Clear Google accounts
    try {
      await fs.unlink(path.join(llxprtDir, 'google_accounts.json'));
    } catch {
      // File might not exist
    }
  } catch (error) {
    console.debug('Error clearing legacy files:', error);
  }
  
  // Clear OAuth client cache - CRITICAL
  try {
    const { clearOauthClientCache } = await import('@vybestack/llxprt-code-core');
    clearOauthClientCache();
  } catch (error) {
    // Log but continue - cache clearing failed
    console.error('Failed to clear OAuth client cache:', error);
  }
  
  // Signal provider to clear auth cache
  this.clearProviderAuthCache();
}
```

### 2. Ensure GeminiProvider Clears Cache
**File**: `packages/core/src/providers/gemini/GeminiProvider.ts`

Similar to Anthropic, need to:
1. Add `clearAuthCache()` method call
2. Track cached auth key
3. Recreate client when auth changes

## Testing
1. Login with Gemini OAuth
2. Verify can make API calls
3. Logout
4. Verify all files are cleaned up
5. Immediately try API call → should fail
6. Verify can re-login successfully