# Phase 3: Gemini OAuth Real Implementation (P3)

## Problem Analysis

**Current State**: The `GeminiOAuthProvider` in `/packages/cli/src/auth/gemini-oauth-provider.ts` is a placeholder that throws errors:

```typescript
async initiateAuth(): Promise<void> {
  // Signal that the existing LOGIN_WITH_GOOGLE flow should be used
  // The GeminiProvider will handle this through its own OAuth mechanism
  throw new Error('USE_EXISTING_GEMINI_OAUTH');
}
```

**Issues**:
1. Provider throws errors instead of implementing OAuth
2. Relies on magic string `USE_EXISTING_GEMINI_OAUTH` 
3. No integration with the existing Google OAuth infrastructure
4. Breaks OAuth Manager's expectation of working providers

**Impact**: Users cannot use consistent OAuth flows for Gemini, and the OAuth Manager breaks when trying to use Gemini authentication.

## Technical Analysis

### Existing Gemini OAuth Infrastructure

The codebase already has working Google OAuth in `/packages/core/src/code_assist/oauth2.ts`:
- OAuth2Client from google-auth-library
- Client ID: `681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com`
- Working auth flows: web-based and device code
- Token caching in `oauth_creds.json`
- Account management in `google_accounts.json`

### Integration Strategy

Instead of replacing the existing OAuth system, integrate with it:
1. Remove placeholder implementation
2. Bridge GeminiOAuthProvider to existing Google OAuth
3. Maintain backward compatibility with LOGIN_WITH_GOOGLE
4. Handle token storage consistently

## Implementation Plan

### Step 1: Real GeminiOAuthProvider Implementation

**File**: `/packages/cli/src/auth/gemini-oauth-provider.ts`

Replace entire file:

```typescript
/**
 * Gemini OAuth Provider Implementation
 * 
 * Integrates with existing Google OAuth infrastructure while providing
 * consistent OAuth provider interface for the OAuth Manager.
 */

import { OAuthProvider } from './oauth-manager.js';
import { OAuthToken, TokenStore } from './types.js';
import { AuthType, Config } from '@vybestack/llxprt-code-core';
import { OAuth2Client, Credentials } from 'google-auth-library';

export class GeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private initialized = false;
  private initializationPromise?: Promise<void>;
  private config?: Config;
  
  constructor(private tokenStore?: TokenStore, config?: Config) {
    this.tokenStore = tokenStore;
    this.config = config;
    
    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
        `Token persistence will not work. Please update your code.`
      );
    }
    
    // Initialize provider asynchronously
    this.initializationPromise = this.initializeToken();
  }

  /**
   * Ensure provider is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized && this.initializationPromise) {
      await this.initializationPromise;
    }
  }

  /**
   * Initialize token from storage or legacy sources
   */
  private async initializeToken(): Promise<void> {
    try {
      console.debug(`Initializing Gemini OAuth provider`);
      
      // Try to load from new token store first
      if (this.tokenStore) {
        const savedToken = await this.tokenStore.getToken('gemini');
        if (savedToken && !this.isTokenExpired(savedToken)) {
          console.debug(`Found valid saved token for ${this.name}`);
          this.initialized = true;
          return;
        }
      }
      
      // Try to load from legacy OAuth system
      await this.migrateLegacyToken();
      
      this.initialized = true;
    } catch (error) {
      console.error(`Failed to initialize Gemini OAuth:`, error);
      this.initialized = true; // Continue with no token
    }
  }

  /**
   * Migrate token from legacy oauth_creds.json to new storage
   */
  private async migrateLegacyToken(): Promise<void> {
    try {
      const path = await import('path');
      const os = await import('os');
      const fs = await import('fs/promises');
      
      const legacyPath = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
      const credentialsData = await fs.readFile(legacyPath, 'utf8');
      const credentials = JSON.parse(credentialsData) as Credentials;
      
      if (credentials.access_token && credentials.expiry_date) {
        const oauthToken: OAuthToken = {
          access_token: credentials.access_token,
          refresh_token: credentials.refresh_token,
          expiry: Math.floor(credentials.expiry_date / 1000), // Convert ms to seconds
          token_type: 'Bearer',
          scope: credentials.scope || null,
        };
        
        if (this.tokenStore && !this.isTokenExpired(oauthToken)) {
          await this.tokenStore.saveToken('gemini', oauthToken);
          console.debug('Migrated legacy Gemini OAuth token to new storage');
        }
      }
    } catch (error) {
      // Legacy file doesn't exist or is invalid - that's okay
      console.debug('No legacy Gemini OAuth token found:', error);
    }
  }

  /**
   * Check if token is expired with 30-second buffer
   */
  private isTokenExpired(token: OAuthToken): boolean {
    const now = Math.floor(Date.now() / 1000);
    return token.expiry <= (now + 30);
  }

  /**
   * Convert Google OAuth credentials to standard OAuth token format
   */
  private credentialsToOAuthToken(credentials: Credentials): OAuthToken {
    if (!credentials.access_token || !credentials.expiry_date) {
      throw new Error('Invalid credentials: missing access_token or expiry_date');
    }
    
    return {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry: Math.floor(credentials.expiry_date / 1000),
      token_type: 'Bearer',
      scope: credentials.scope || null,
    };
  }

  /**
   * Initiate Google OAuth authentication
   */
  async initiateAuth(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Use existing Google OAuth infrastructure
      const { getOauthClient } = await import('@vybestack/llxprt-code-core');
      const config = this.config || new Config();
      
      console.log('\nGemini (Google) OAuth Authentication');
      console.log('─'.repeat(40));
      
      // Get OAuth client using existing infrastructure
      const oauthClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
      const credentials = oauthClient.credentials;
      
      if (credentials.access_token && credentials.expiry_date) {
        const oauthToken = this.credentialsToOAuthToken(credentials);
        
        // Save to new token storage
        if (this.tokenStore) {
          await this.tokenStore.saveToken('gemini', oauthToken);
          console.debug('Saved Gemini OAuth token to storage');
        }
        
        console.log('✅ Gemini OAuth authentication successful');
      } else {
        throw new Error('OAuth client did not provide valid credentials');
      }
    } catch (error) {
      console.error('Gemini OAuth authentication failed:', error);
      throw error;
    }
  }

  /**
   * Get current OAuth token
   */
  async getToken(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    
    if (!this.tokenStore) {
      return null;
    }

    try {
      const token = await this.tokenStore.getToken(this.name);
      if (token && !this.isTokenExpired(token)) {
        return token;
      }
      return null;
    } catch (error) {
      console.error(`Failed to get token for ${this.name}:`, error);
      return null;
    }
  }

  /**
   * Refresh token if needed
   */
  async refreshIfNeeded(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    
    const currentToken = await this.getToken();
    if (!currentToken) {
      return null;
    }

    // If token is not near expiry, return it as-is
    if (!this.isTokenExpired(currentToken)) {
      return currentToken;
    }

    // Try to refresh using Google OAuth infrastructure
    try {
      const { getOauthClient } = await import('@vybestack/llxprt-code-core');
      const config = this.config || new Config();
      
      const oauthClient = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);
      
      // Set current credentials for refresh
      oauthClient.setCredentials({
        access_token: currentToken.access_token,
        refresh_token: currentToken.refresh_token,
        expiry_date: currentToken.expiry * 1000, // Convert to ms
      });
      
      // Trigger refresh
      const { credentials } = await oauthClient.refreshAccessToken();
      
      if (credentials.access_token && credentials.expiry_date) {
        const refreshedToken = this.credentialsToOAuthToken(credentials);
        
        // Save refreshed token
        if (this.tokenStore) {
          await this.tokenStore.saveToken('gemini', refreshedToken);
          console.debug('Refreshed and saved Gemini OAuth token');
        }
        
        return refreshedToken;
      }
      
      return null;
    } catch (error) {
      console.warn('Failed to refresh Gemini OAuth token:', error);
      // Clear invalid token from storage
      if (this.tokenStore) {
        await this.tokenStore.removeToken('gemini');
      }
      return null;
    }
  }

  /**
   * Logout - clear all tokens and cached state
   */
  async logout(): Promise<void> {
    await this.ensureInitialized();
    
    try {
      // Clear from new token storage
      if (this.tokenStore) {
        await this.tokenStore.removeToken('gemini');
        console.debug('Cleared Gemini token from storage');
      }
      
      // Clear legacy OAuth files
      await this.clearLegacyTokens();
      
      // Clear OAuth client cache to prevent session leakage
      try {
        const { clearOauthClientCache } = await import('@vybestack/llxprt-code-core');
        clearOauthClientCache(); // Clear all cached OAuth clients
        console.debug('Cleared OAuth client cache for Gemini logout');
      } catch (error) {
        console.warn('Failed to clear OAuth client cache:', error);
      }
      
      console.log('✅ Logged out from Gemini OAuth');
    } catch (error) {
      console.error('Error during Gemini OAuth logout:', error);
      throw error;
    }
  }

  /**
   * Clear legacy OAuth token files
   */
  private async clearLegacyTokens(): Promise<void> {
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      const os = await import('os');
      const llxprtDir = path.join(os.homedir(), '.llxprt');
      
      // Clear the OAuth credentials
      const legacyCredsPath = path.join(llxprtDir, 'oauth_creds.json');
      try {
        await fs.unlink(legacyCredsPath);
        console.debug('Cleared legacy OAuth credentials');
      } catch {
        // File might not exist
      }
      
      // Clear the Google accounts file
      const googleAccountsPath = path.join(llxprtDir, 'google_accounts.json');
      try {
        await fs.unlink(googleAccountsPath);
        console.debug('Cleared Google account info');
      } catch {
        // File might not exist
      }
    } catch (error) {
      console.debug('Error clearing legacy Gemini tokens:', error);
    }
  }
}
```

### Step 2: Update OAuth Manager Magic String Handling

**File**: `/packages/cli/src/auth/oauth-manager.ts`

Remove magic string handling around lines 320-352:

```typescript
async getToken(providerName: string): Promise<string | null> {
  // Check if OAuth is enabled for this provider
  if (!this.isOAuthEnabled(providerName)) {
    return null;
  }

  const token = await this.getOAuthToken(providerName);

  // For Qwen, return the OAuth token to be used as API key
  if (providerName === 'qwen' && token) {
    return token.access_token;
  }

  if (token) {
    return token.access_token;
  }

  // For providers without valid tokens, trigger OAuth flow
  try {
    await this.authenticate(providerName);
    const newToken = await this.getOAuthToken(providerName);
    return newToken ? newToken.access_token : null;
  } catch (error) {
    console.error(`OAuth authentication failed for ${providerName}:`, error);
    throw error;
  }
}
```

### Step 3: Update Gemini Provider Integration

**File**: `/packages/core/src/providers/gemini/GeminiProvider.ts`

Remove magic string checks around lines 320-350:

```typescript
/**
 * Determines the best available authentication method based on environment variables
 * and existing configuration. Now uses lazy evaluation with proper precedence chain.
 */
private async determineBestAuth(): Promise<string> {
  // Re-check OAuth enablement state before determining auth
  this.updateOAuthState();

  // Use the base provider's auth precedence resolution
  try {
    const token = await this.getAuthToken();

    // Check if OAuth is enabled for Gemini
    const authMethodName = await this.getAuthMethodName();
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };
    const isOAuthEnabled = manager?.isOAuthEnabled && 
                          typeof manager.isOAuthEnabled === 'function' &&
                          manager.isOAuthEnabled('gemini');
    
    if (authMethodName?.startsWith('oauth-') || 
        (this.geminiOAuthManager && isOAuthEnabled)) {
      this.authMode = 'oauth';
      
      // If we have a token, use it directly
      if (token) {
        return token;
      }
      
      // No token but OAuth is enabled - use LOGIN_WITH_GOOGLE flow
      return 'USE_LOGIN_WITH_GOOGLE';
    }

    // Determine auth mode based on resolved authentication method
    if (this.hasVertexAICredentials()) {
      this.authMode = 'vertex-ai';
      this.setupVertexAIAuth();
    } else if (this.hasGeminiAPIKey() || authMethodName?.includes('key')) {
      this.authMode = 'gemini-api-key';
    } else {
      this.authMode = 'none';
    }

    return token;
  } catch (error) {
    // Check if OAuth is enabled for Gemini - if so, use LOGIN_WITH_GOOGLE
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };
    if (this.geminiOAuthManager && 
        manager.isOAuthEnabled && 
        typeof manager.isOAuthEnabled === 'function' &&
        manager.isOAuthEnabled('gemini')) {
      this.authMode = 'oauth';
      return 'USE_LOGIN_WITH_GOOGLE';
    }
    
    // Handle case where no auth is available
    const authType = this.geminiConfig?.getContentGeneratorConfig()?.authType;
    if (authType === AuthType.USE_NONE) {
      this.authMode = 'none';
      throw new AuthenticationRequiredError(
        'Authentication is set to USE_NONE but no credentials are available',
        this.authMode,
        ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      );
    }
    throw error;
  }
}
```

## Testing Strategy

### Unit Tests

**File**: `/packages/cli/test/auth/gemini-oauth-provider.test.ts`

```typescript
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';

describe('GeminiOAuthProvider', () => {
  let tokenStore: MultiProviderTokenStore;
  let provider: GeminiOAuthProvider;

  beforeEach(() => {
    tokenStore = new MultiProviderTokenStore();
    provider = new GeminiOAuthProvider(tokenStore);
  });

  it('should not throw errors on initialization', () => {
    expect(() => new GeminiOAuthProvider(tokenStore)).not.toThrow();
  });

  it('should implement all required OAuth methods', () => {
    expect(typeof provider.initiateAuth).toBe('function');
    expect(typeof provider.getToken).toBe('function');
    expect(typeof provider.refreshIfNeeded).toBe('function');
    expect(typeof provider.logout).toBe('function');
  });

  it('should migrate legacy tokens on initialization', async () => {
    // Mock legacy token file
    const mockCredentials = {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expiry_date: Date.now() + 3600000, // 1 hour from now
    };
    
    // Test migration logic
    // ... detailed test implementation
  });

  it('should handle logout completely', async () => {
    // Save a token first
    const validToken = {
      access_token: 'test-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    };
    
    await tokenStore.saveToken('gemini', validToken);
    
    // Verify token exists
    const beforeLogout = await provider.getToken();
    expect(beforeLogout).toBeTruthy();
    
    // Logout
    await provider.logout();
    
    // Verify token cleared
    const afterLogout = await provider.getToken();
    expect(afterLogout).toBeNull();
  });

  it('should handle token refresh correctly', async () => {
    // Mock expired token
    const expiredToken = {
      access_token: 'expired-token',
      refresh_token: 'refresh-token',
      expiry: Math.floor(Date.now() / 1000) - 100, // Expired
      token_type: 'Bearer' as const,
    };
    
    await tokenStore.saveToken('gemini', expiredToken);
    
    // Mock Google OAuth client refresh
    // ... test refresh logic
  });
});
```

### Integration Tests

**File**: `/packages/cli/test/auth/gemini-oauth-integration.test.ts`

```typescript
describe('Gemini OAuth Integration', () => {
  it('should integrate with OAuth Manager', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore);
    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    
    oauthManager.registerProvider(geminiProvider);
    
    // Test OAuth Manager can use Gemini provider
    const providers = oauthManager.getSupportedProviders();
    expect(providers).toContain('gemini');
  });

  it('should work with existing Gemini Provider', async () => {
    // Test integration with GeminiProvider class
    // Ensure OAuth tokens are properly resolved
    // ... integration test implementation
  });
});
```

## Migration Strategy

### Phase 1: Replace Placeholder
1. Deploy new GeminiOAuthProvider implementation
2. Ensure all existing functionality still works
3. Test OAuth Manager integration

### Phase 2: Remove Magic Strings
1. Update OAuth Manager to remove `USE_EXISTING_GEMINI_OAUTH` handling
2. Update Gemini Provider to use real OAuth tokens
3. Test end-to-end authentication flows

### Phase 3: Legacy Migration
1. Test legacy token migration
2. Ensure backward compatibility
3. Validate error handling

## Success Criteria

1. **No More Errors**: GeminiOAuthProvider doesn't throw placeholder errors
2. **Real OAuth**: Implements actual Google OAuth using existing infrastructure
3. **Token Persistence**: Saves and loads tokens consistently with other providers
4. **Legacy Migration**: Migrates existing oauth_creds.json tokens
5. **Complete Logout**: Clears all token storage and cache
6. **Integration**: Works seamlessly with OAuth Manager and Gemini Provider

## Risks and Mitigations

### Risk: Breaking existing Gemini authentication
**Mitigation**: Maintain backward compatibility with LOGIN_WITH_GOOGLE flow

### Risk: Token migration failures
**Mitigation**: Graceful fallback if legacy tokens are corrupted

### Risk: Google OAuth API changes
**Mitigation**: Use existing proven OAuth infrastructure

### Risk: Cache clearing issues
**Mitigation**: Extensive testing of logout functionality