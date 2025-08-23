# Authentication Fixes Overview

## Current Issues

### 1. No Logout Functionality
- **Problem**: Users cannot logout from Gemini, Anthropic, or Qwen providers
- **Impact**: Users must exit the application to switch accounts
- **Affected Providers**: All OAuth-enabled providers (Gemini, Anthropic, Qwen)

### 2. OAuth Token Persistence Not Utilized
- **Problem**: OAuth providers don't load persisted tokens on startup
- **Current Behavior**: 
  - Tokens are saved to `~/.llxprt/oauth/` via `MultiProviderTokenStore`
  - But providers only use in-memory `currentToken` variable
  - On restart, users must re-authenticate even with valid saved tokens
- **Affected Files**:
  - `/packages/cli/src/auth/qwen-oauth-provider.ts`
  - `/packages/cli/src/auth/anthropic-oauth-provider.ts`
  - `/packages/cli/src/auth/gemini-oauth-provider.ts`

### 3. OAuth Expiry Handling Status
- **Good News**: All providers DO handle token expiry correctly
- **Implementation**: 
  - 30-second buffer before expiry triggers refresh
  - Refresh tokens are used when available
  - Gemini uses complex auth precedence chain
- **Issue**: After refresh token expires, no graceful re-authentication flow

## Proposed Solutions

### Solution 1: Add Logout Command/Functionality

#### Implementation Steps:
1. Add `logout()` method to `OAuthProvider` interface
2. Implement logout in each provider class
3. Add CLI command: `llxprt logout --provider <provider>`
4. Clear both in-memory and persisted tokens

#### Code Structure:
```typescript
interface OAuthProvider {
  // ... existing methods
  logout(): Promise<void>;
}

class QwenOAuthProvider implements OAuthProvider {
  async logout(): Promise<void> {
    this.currentToken = null;
    await this.tokenStore.removeToken(this.name);
    console.log(`Logged out from ${this.name}`);
  }
}
```

### Solution 2: Implement OAuth Token Persistence & Restoration

#### Implementation Steps:
1. Inject `TokenStore` into OAuth provider constructors
2. On provider initialization, check for persisted tokens
3. Validate token expiry before using persisted tokens
4. Only initiate new auth if no valid token exists

#### Code Structure:
```typescript
class QwenOAuthProvider implements OAuthProvider {
  constructor(private tokenStore: TokenStore) {
    // ... existing setup
    this.loadPersistedToken();
  }
  
  private async loadPersistedToken(): Promise<void> {
    const savedToken = await this.tokenStore.getToken(this.name);
    if (savedToken && !this.isExpired(savedToken)) {
      this.currentToken = savedToken;
    }
  }
  
  async initiateAuth(): Promise<void> {
    // ... existing flow
    // After successful auth:
    await this.tokenStore.saveToken(this.name, this.currentToken);
  }
}
```

### Solution 3: Unified Token Management Architecture

#### Create Base OAuth Provider Class:
```typescript
abstract class BaseOAuthProvider implements OAuthProvider {
  protected tokenStore: TokenStore;
  protected currentToken: OAuthToken | null = null;
  
  constructor(
    protected name: string,
    tokenStore: TokenStore
  ) {
    this.tokenStore = tokenStore;
  }
  
  async initialize(): Promise<void> {
    // Load persisted token
    const saved = await this.tokenStore.getToken(this.name);
    if (saved && !this.isTokenExpired(saved)) {
      this.currentToken = saved;
    }
  }
  
  async logout(): Promise<void> {
    this.currentToken = null;
    await this.tokenStore.removeToken(this.name);
  }
  
  protected isTokenExpired(token: OAuthToken): boolean {
    const now = Date.now() / 1000;
    return token.expiry <= now + 30; // 30-second buffer
  }
  
  async getToken(): Promise<OAuthToken | null> {
    if (!this.currentToken) {
      // Try loading from store
      await this.initialize();
    }
    return this.currentToken;
  }
  
  abstract initiateAuth(): Promise<void>;
  abstract refreshIfNeeded(): Promise<OAuthToken | null>;
}
```

### Solution 4: Multi-Account Support (Future Enhancement)

#### Extended Token Storage:
```typescript
interface MultiAccountTokenStore {
  saveToken(provider: string, accountId: string, token: OAuthToken): Promise<void>;
  getToken(provider: string, accountId: string): Promise<OAuthToken | null>;
  listAccounts(provider: string): Promise<string[]>;
  setActiveAccount(provider: string, accountId: string): Promise<void>;
  getActiveAccount(provider: string): Promise<string | null>;
}
```

#### CLI Commands:
- `llxprt login --provider anthropic --account work`
- `llxprt switch --provider anthropic --account personal`
- `llxprt accounts --provider anthropic` (list all accounts)

### Solution 5: Improved Token Lifecycle Management

#### Enhancements:
1. **Proactive Refresh**: Check token expiry before each API call
2. **Token Validation**: Validate token with provider on load
3. **Graceful Degradation**: If refresh fails, prompt for re-auth
4. **Auto-cleanup**: Remove invalid tokens automatically

#### Implementation:
```typescript
async validateToken(token: OAuthToken): Promise<boolean> {
  try {
    // Make a simple API call to validate token
    const response = await this.makeValidationRequest(token);
    return response.ok;
  } catch {
    return false;
  }
}

async getValidToken(): Promise<OAuthToken | null> {
  let token = await this.getToken();
  
  if (!token) return null;
  
  // Proactive refresh
  if (this.isNearExpiry(token)) {
    token = await this.refreshIfNeeded();
  }
  
  // Validate with provider
  if (token && !(await this.validateToken(token))) {
    await this.logout();
    return null;
  }
  
  return token;
}
```

## Implementation Priority

### Phase 1: Critical Fixes (Immediate)
1. **Fix Token Persistence Usage** 
   - Load persisted tokens on provider initialization
   - Minimal code changes, high impact
   - Estimated effort: 2-4 hours

2. **Add Logout Functionality**
   - User-requested feature
   - Add logout method to providers
   - Add CLI command
   - Estimated effort: 3-5 hours

### Phase 2: Architecture Improvements (Next Sprint)
3. **Unify Token Management**
   - Create BaseOAuthProvider class
   - Refactor providers to extend base
   - Consistent error handling
   - Estimated effort: 1-2 days

### Phase 3: Enhancements (Future)
4. **Multi-Account Support**
   - Extend token storage
   - Add account management commands
   - Estimated effort: 2-3 days

5. **Advanced Token Lifecycle**
   - Proactive refresh
   - Token validation
   - Auto-cleanup
   - Estimated effort: 1-2 days

## Testing Requirements

### Unit Tests:
- Token persistence and loading
- Logout functionality
- Token expiry detection
- Refresh flow

### Integration Tests:
- Full OAuth flow with persistence
- Logout and re-login
- Token refresh scenarios
- Multi-provider scenarios

### Manual Testing:
- Test with real OAuth providers
- Verify token persistence across restarts
- Test account switching
- Verify error handling

## Files to Modify

### Core Changes:
- `/packages/cli/src/auth/oauth-manager.ts` - Add logout support
- `/packages/cli/src/auth/qwen-oauth-provider.ts` - Add persistence & logout
- `/packages/cli/src/auth/anthropic-oauth-provider.ts` - Add persistence & logout
- `/packages/cli/src/auth/gemini-oauth-provider.ts` - Add persistence & logout
- `/packages/core/src/auth/token-store.ts` - Already implemented, may need extensions

### CLI Changes:
- Add logout command handler
- Update help documentation
- Add account management commands (Phase 3)

### Test Files:
- Update existing OAuth test files
- Add new test cases for persistence
- Add logout tests

## Success Criteria

1. Users can logout without exiting application
2. Tokens persist across application restarts
3. Expired tokens are refreshed automatically
4. Clear error messages for auth failures
5. All existing OAuth flows continue to work
6. No regression in current functionality

## Risks and Mitigations

### Risk 1: Breaking Existing Auth Flows
- **Mitigation**: Extensive testing, feature flags for rollout

### Risk 2: Token Security
- **Mitigation**: Maintain secure file permissions (0600), encrypt sensitive data

### Risk 3: Provider API Changes
- **Mitigation**: Graceful degradation, clear error messages

### Risk 4: Refresh Token Expiry
- **Mitigation**: Detect and prompt for re-authentication

## Notes

- The `MultiProviderTokenStore` infrastructure is already in place and working
- The main issue is that OAuth providers aren't utilizing it properly
- Gemini provider has more complex auth due to multiple auth methods (OAuth, API key, Vertex AI)
- All providers currently handle token refresh correctly with 30-second buffer
- Solution should maintain backward compatibility with existing configurations