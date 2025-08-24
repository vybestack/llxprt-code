# Phase 3B: Gemini OAuth Integration Strategy (P3)

## Integration Challenge

**Problem**: The new `GeminiOAuthProvider` must coexist with the existing Google OAuth system in `oauth2.ts` without breaking existing functionality or creating conflicts.

**Key Challenge**: The existing system uses `AuthType.LOGIN_WITH_GOOGLE` and stores tokens in `oauth_creds.json`, while the new system uses provider-specific storage in `~/.llxprt/oauth/gemini.json`.

## Integration Architecture

### Dual-Path Authentication Strategy

Instead of replacing the existing system immediately, implement a dual-path approach:

1. **New Path**: Use GeminiOAuthProvider for new OAuth flows
2. **Legacy Path**: Continue supporting existing LOGIN_WITH_GOOGLE flows  
3. **Migration Path**: Gradually migrate users from legacy to new system

### Integration Points

#### Point 1: OAuth Manager Token Resolution

**File**: `/packages/cli/src/auth/oauth-manager.ts`

Update `getToken()` method to handle both paths:

```typescript
async getToken(providerName: string): Promise<string | null> {
  // Check if OAuth is enabled for this provider
  if (!this.isOAuthEnabled(providerName)) {
    return null;
  }

  // Try new OAuth provider system first
  const token = await this.getOAuthToken(providerName);
  if (token) {
    return token.access_token;
  }

  // For Gemini, fall back to legacy LOGIN_WITH_GOOGLE if new system fails
  if (providerName === 'gemini') {
    try {
      const legacyToken = await this.getLegacyGeminiToken();
      if (legacyToken) {
        // Migrate legacy token to new system for future use
        await this.migrateLegacyGeminiToken(legacyToken);
        return legacyToken.access_token;
      }
    } catch (error) {
      console.debug('Legacy Gemini token not available:', error);
    }
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

/**
 * Get legacy Gemini token from oauth_creds.json
 */
private async getLegacyGeminiToken(): Promise<OAuthToken | null> {
  try {
    const path = await import('path');
    const os = await import('os');
    const fs = await import('fs/promises');
    
    const legacyPath = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
    const credentialsData = await fs.readFile(legacyPath, 'utf8');
    const credentials = JSON.parse(credentialsData);
    
    if (credentials.access_token && credentials.expiry_date) {
      return {
        access_token: credentials.access_token,
        refresh_token: credentials.refresh_token,
        expiry: Math.floor(credentials.expiry_date / 1000),
        token_type: 'Bearer',
        scope: credentials.scope || null,
      };
    }
    
    return null;
  } catch (error) {
    return null; // Legacy token not available
  }
}

/**
 * Migrate legacy token to new provider storage
 */
private async migrateLegacyGeminiToken(legacyToken: OAuthToken): Promise<void> {
  try {
    if (!this.isTokenExpired(legacyToken)) {
      await this.tokenStore.saveToken('gemini', legacyToken);
      console.debug('Migrated legacy Gemini token to new storage');
    }
  } catch (error) {
    console.warn('Failed to migrate legacy Gemini token:', error);
  }
}

/**
 * Check if token is expired with 30-second buffer
 */
private isTokenExpired(token: OAuthToken): boolean {
  const now = Math.floor(Date.now() / 1000);
  return token.expiry <= (now + 30);
}
```

#### Point 2: Gemini Provider Authentication Selection

**File**: `/packages/core/src/providers/gemini/GeminiProvider.ts`

Update `determineBestAuth()` to handle both OAuth paths:

```typescript
private async determineBestAuth(): Promise<string> {
  this.updateOAuthState();

  try {
    const token = await this.getAuthToken();

    // Check OAuth enablement
    const authMethodName = await this.getAuthMethodName();
    const manager = this.geminiOAuthManager as OAuthManager & {
      isOAuthEnabled?(provider: string): boolean;
    };
    const isOAuthEnabled = manager?.isOAuthEnabled && 
                          typeof manager.isOAuthEnabled === 'function' &&
                          manager.isOAuthEnabled('gemini');
    
    // New OAuth provider path
    if (authMethodName?.startsWith('oauth-') || 
        (this.geminiOAuthManager && isOAuthEnabled)) {
      this.authMode = 'oauth';
      
      // If we have a token from new system, use it
      if (token && token !== 'USE_LOGIN_WITH_GOOGLE') {
        return token;
      }
      
      // No token from new system, check legacy system
      if (await this.hasLegacyOAuthToken()) {
        console.debug('Using legacy Google OAuth token for Gemini');
        return 'USE_LOGIN_WITH_GOOGLE';
      }
      
      // No tokens available - trigger new OAuth flow
      console.debug('No OAuth tokens available, will trigger authentication');
      return 'USE_LOGIN_WITH_GOOGLE'; // Will be handled by new provider
    }

    // Non-OAuth auth paths
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
    // Fallback to legacy OAuth if new system fails
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
    
    throw error;
  }
}

/**
 * Check if legacy OAuth token exists
 */
private async hasLegacyOAuthToken(): Promise<boolean> {
  try {
    const path = await import('path');
    const os = await import('os');
    const fs = await import('fs/promises');
    
    const legacyPath = path.join(os.homedir(), '.llxprt', 'oauth_creds.json');
    const credentialsData = await fs.readFile(legacyPath, 'utf8');
    const credentials = JSON.parse(credentialsData);
    
    if (credentials.access_token && credentials.expiry_date) {
      const expiry = Math.floor(credentials.expiry_date / 1000);
      const now = Math.floor(Date.now() / 1000);
      return expiry > (now + 30); // 30-second buffer
    }
    
    return false;
  } catch {
    return false;
  }
}
```

#### Point 3: Seamless Authentication Flow

When `USE_LOGIN_WITH_GOOGLE` is returned, it should trigger the appropriate authentication:

**Integration Flow**:
1. OAuth Manager detects Gemini needs authentication
2. If new GeminiOAuthProvider is available, use it
3. GeminiOAuthProvider uses existing Google OAuth infrastructure
4. Token is saved to new storage format
5. Legacy token is maintained for compatibility

## Migration Timeline

### Phase 1: Dual System (Week 1)
- Deploy new GeminiOAuthProvider alongside existing system
- Both systems work independently
- New users get new system, existing users continue with legacy

### Phase 2: Gradual Migration (Week 2-3)
- New authentication flows use new system
- Legacy tokens migrated to new system on access
- Both storage formats maintained

### Phase 3: Legacy Deprecation (Week 4-6)
- All new tokens saved only to new system
- Legacy system maintained for reading only
- Deprecation warnings for legacy usage

### Phase 4: Legacy Removal (Future release)
- Remove legacy oauth_creds.json support
- Clean up dual-path code
- Single unified OAuth system

## Implementation Details

### Token Storage Strategy

**New System Storage**: `~/.llxprt/oauth/gemini.json`
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//04...",
  "expiry": 1735689600,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/cloud-platform"
}
```

**Legacy System Storage**: `~/.llxprt/oauth_creds.json`
```json
{
  "access_token": "ya29.a0...",
  "refresh_token": "1//04...",
  "expiry_date": 1735689600000,
  "token_type": "Bearer",
  "scope": "https://www.googleapis.com/auth/cloud-platform"
}
```

### Authentication Flow Decision Tree

```
User triggers Gemini authentication
│
├── OAuth enabled?
│   │
│   ├── No → Use API key/Vertex AI
│   │
│   └── Yes → Check new OAuth storage
│       │
│       ├── Valid token found → Use new token
│       │
│       └── No valid token → Check legacy storage
│           │
│           ├── Valid legacy token → Migrate to new system
│           │
│           └── No valid token → Start new OAuth flow
│
└── Use appropriate authentication method
```

### Error Handling Strategy

```typescript
try {
  // Try new OAuth system
  const token = await this.getOAuthToken('gemini');
  if (token) return token.access_token;
} catch (newSystemError) {
  console.debug('New OAuth system failed:', newSystemError);
  
  try {
    // Fall back to legacy system
    const legacyToken = await this.getLegacyGeminiToken();
    if (legacyToken) {
      // Migrate token for future use
      await this.migrateLegacyGeminiToken(legacyToken);
      return legacyToken.access_token;
    }
  } catch (legacySystemError) {
    console.debug('Legacy OAuth system failed:', legacySystemError);
  }
  
  // Both systems failed - trigger new authentication
  throw new AuthenticationRequiredError('OAuth authentication required');
}
```

## Testing Strategy

### Integration Tests

**File**: `/packages/cli/test/auth/gemini-oauth-dual-system.integration.test.ts`

```typescript
describe('Gemini OAuth Dual System Integration', () => {
  it('should prefer new system when both tokens exist', async () => {
    // Setup both legacy and new tokens
    await setupLegacyToken();
    await setupNewToken();
    
    const token = await oauthManager.getToken('gemini');
    
    // Should use new system token
    expect(token).toBe(newSystemToken.access_token);
  });

  it('should fall back to legacy system when new system fails', async () => {
    // Setup only legacy token
    await setupLegacyToken();
    
    const token = await oauthManager.getToken('gemini');
    
    // Should use legacy token
    expect(token).toBe(legacyToken.access_token);
    
    // Should migrate token to new system
    const migratedToken = await tokenStore.getToken('gemini');
    expect(migratedToken).toBeTruthy();
  });

  it('should handle migration errors gracefully', async () => {
    // Setup corrupted legacy token
    await setupCorruptedLegacyToken();
    
    // Should not crash
    const token = await oauthManager.getToken('gemini');
    expect(token).toBeNull();
  });
});
```

### E2E Tests

**File**: `/packages/cli/test/auth/gemini-oauth-e2e.test.ts`

```typescript
describe('Gemini OAuth E2E Integration', () => {
  it('should work end-to-end with new system', async () => {
    // Enable Gemini OAuth
    await oauthManager.toggleOAuthEnabled('gemini');
    
    // Mock Google OAuth flow
    mockGoogleOAuth();
    
    // Trigger authentication
    await oauthManager.authenticate('gemini');
    
    // Should save token to new storage
    const savedToken = await tokenStore.getToken('gemini');
    expect(savedToken).toBeTruthy();
    
    // Should work with Gemini provider
    const geminiProvider = new GeminiProvider(undefined, undefined, undefined, oauthManager);
    const authToken = await geminiProvider.getAuthToken();
    expect(authToken).toBe(savedToken.access_token);
  });
});
```

## Success Criteria

1. **Backward Compatibility**: Existing users continue to work without changes
2. **Forward Progress**: New users get improved OAuth system
3. **Seamless Migration**: Legacy tokens automatically migrated
4. **Error Resilience**: System gracefully handles failures in either path
5. **Token Consistency**: All tokens work regardless of storage location
6. **Performance**: No significant slowdown from dual-system checks

## Risk Assessment

### Risk: Token Confusion
**Likelihood**: Medium
**Impact**: High
**Mitigation**: Clear precedence rules, extensive testing

### Risk: Migration Failures  
**Likelihood**: Low
**Impact**: Medium
**Mitigation**: Graceful degradation, maintain legacy system

### Risk: Authentication Loops
**Likelihood**: Low  
**Impact**: High
**Mitigation**: Careful flow control, circuit breakers

### Risk: Security Issues
**Likelihood**: Low
**Impact**: Critical  
**Mitigation**: Maintain same security standards as existing system

## Next Steps

1. Implement dual-path OAuth Manager changes
2. Update Gemini Provider integration
3. Add comprehensive testing
4. Deploy with feature flag for gradual rollout
5. Monitor error rates and user experience
6. Begin gradual migration of legacy users