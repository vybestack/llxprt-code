# Phase 2: Token Persistence Implementation Fix (P2)

## Implementation Strategy

Fix the broken token persistence by addressing the root causes identified in the analysis:
1. Fix fire-and-forget async initialization
2. Pass TokenStore to all OAuth providers  
3. Add proper error handling and logging
4. Implement consistent initialization patterns

## Technical Implementation

### Step 1: Fix OAuthManager Provider Registration

**File**: `/packages/cli/src/auth/oauth-manager.ts`

**Problem**: TokenStore exists but not passed to providers during registration.

**Fix**: Update `registerProvider()` method around lines 59-82:

```typescript
/**
 * Register an OAuth provider with the manager
 * @param provider - The OAuth provider to register
 */
registerProvider(provider: OAuthProvider): void {
  if (!provider) {
    throw new Error('Provider cannot be null or undefined');
  }

  if (!provider.name || typeof provider.name !== 'string') {
    throw new Error('Provider must have a valid name');
  }

  // Validate provider has required methods
  if (typeof provider.initiateAuth !== 'function') {
    throw new Error('Provider must implement initiateAuth method');
  }

  if (typeof provider.getToken !== 'function') {
    throw new Error('Provider must implement getToken method');
  }

  if (typeof provider.refreshIfNeeded !== 'function') {
    throw new Error('Provider must implement refreshIfNeeded method');
  }

  // CRITICAL FIX: Ensure provider has token store for persistence
  if ('setTokenStore' in provider && typeof provider.setTokenStore === 'function') {
    provider.setTokenStore(this.tokenStore);
    console.debug(`Set TokenStore for provider: ${provider.name}`);
  } else {
    console.warn(`Provider ${provider.name} does not support token persistence`);
  }

  this.providers.set(provider.name, provider);
  console.debug(`Registered OAuth provider: ${provider.name}`);
}
```

**Alternative Approach**: Update provider creation to pass TokenStore directly:

```typescript
// In the code that creates and registers providers
const qwenProvider = new QwenOAuthProvider(this.tokenStore);
const anthropicProvider = new AnthropicOAuthProvider(this.tokenStore); 
const geminiProvider = new GeminiOAuthProvider(this.tokenStore);

oauthManager.registerProvider(qwenProvider);
oauthManager.registerProvider(anthropicProvider);
oauthManager.registerProvider(geminiProvider);
```

### Step 2: Fix Async Initialization in Providers

#### Qwen OAuth Provider Fix

**File**: `/packages/cli/src/auth/qwen-oauth-provider.ts`

**Problem**: Fire-and-forget async call at line 58.

**Fix**: Make initialization synchronous or properly handle async:

```typescript
export class QwenOAuthProvider implements OAuthProvider {
  name = 'qwen';
  private deviceFlow: QwenDeviceFlow;
  private initialized = false;
  private initializationPromise?: Promise<void>;

  constructor(private tokenStore?: TokenStore) {
    this.tokenStore = tokenStore;

    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }

    const config: DeviceFlowConfig = {
      clientId: 'f0304373b74a44d2b584a3fb70ca9e56',
      authorizationEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/device/code',
      tokenEndpoint: 'https://chat.qwen.ai/api/v1/oauth2/token',
      scopes: ['openid', 'profile', 'email', 'model.completion'],
    };

    this.deviceFlow = new QwenDeviceFlow(config);

    // CRITICAL FIX: Start initialization but don't block constructor
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
   * Initialize token from storage
   */
  private async initializeToken(): Promise<void> {
    if (!this.tokenStore) {
      this.initialized = true;
      return;
    }

    try {
      console.debug(`Loading saved token for ${this.name}`);
      const savedToken = await this.tokenStore.getToken('qwen');

      if (savedToken && !this.isTokenExpired(savedToken)) {
        console.debug(`Found valid saved token for ${this.name}, expires at: ${new Date(savedToken.expiry * 1000).toISOString()}`);
        // Token is valid, provider is ready
      } else if (savedToken) {
        console.debug(`Found expired token for ${this.name}, will need refresh`);
        // Token exists but expired, will be refreshed on first use
      } else {
        console.debug(`No saved token found for ${this.name}`);
      }
      
      this.initialized = true;
    } catch (error) {
      console.error(`Failed to load saved token for ${this.name}:`, error);
      this.initialized = true; // Continue with no token
    }
  }

  /**
   * Get token - ensures initialization is complete
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
   * Other methods updated similarly...
   */
  async refreshIfNeeded(): Promise<OAuthToken | null> {
    await this.ensureInitialized();
    // ... existing implementation but with proper TokenStore usage
  }

  async initiateAuth(): Promise<void> {
    await this.ensureInitialized();
    // ... existing implementation
    
    // CRITICAL FIX: Save token after successful authentication
    const token = await this.deviceFlow.pollForToken(deviceCode);
    if (token && this.tokenStore) {
      try {
        await this.tokenStore.saveToken(this.name, token);
        console.debug(`Saved token for ${this.name}`);
      } catch (error) {
        console.error(`Failed to save token for ${this.name}:`, error);
        // Don't throw - token is still valid in memory
      }
    }
  }
}
```

#### Anthropic OAuth Provider Fix

**File**: `/packages/cli/src/auth/anthropic-oauth-provider.ts`

Apply similar pattern:

```typescript
export class AnthropicOAuthProvider implements OAuthProvider {
  name = 'anthropic';
  private deviceFlow: AnthropicDeviceFlow;
  private initialized = false;
  private initializationPromise?: Promise<void>;

  constructor(private tokenStore?: TokenStore) {
    // Similar initialization pattern as Qwen
    this.tokenStore = tokenStore;
    
    if (!tokenStore) {
      console.warn(
        `DEPRECATION: ${this.name} OAuth provider created without TokenStore. ` +
          `Token persistence will not work. Please update your code.`,
      );
    }

    // Initialize config
    const config = {
      clientId: 'claude-cli',
      authorizationEndpoint: 'https://claude.ai/oauth/authorize',
      tokenEndpoint: 'https://claude.ai/api/oauth/token',
      scopes: ['read', 'write'],
    };

    this.deviceFlow = new AnthropicDeviceFlow(config);
    this.initializationPromise = this.initializeToken();
  }

  // Similar ensureInitialized() and initializeToken() patterns
  // ... rest similar to Qwen implementation
}
```

### Step 3: Enhanced MultiProviderTokenStore with Logging

**File**: `/packages/core/src/auth/token-store.ts`

Add debug logging to track persistence issues:

```typescript
/**
 * Save an OAuth token for a specific provider
 */
async saveToken(provider: string, token: OAuthToken): Promise<void> {
  console.debug(`Attempting to save token for provider: ${provider}`);
  
  // Validate provider name
  if (!provider || provider.trim() === '') {
    const error = new Error('Provider name cannot be empty');
    console.error('Token save failed:', error.message);
    throw error;
  }

  // Validate token structure
  let validatedToken: OAuthToken;
  try {
    validatedToken = OAuthTokenSchema.parse(token);
    console.debug(`Token validation successful for provider: ${provider}`);
  } catch (error) {
    console.error(`Token validation failed for provider ${provider}:`, error);
    throw error;
  }

  // Ensure directory exists with secure permissions
  try {
    await this.ensureDirectory();
    console.debug(`Directory ensured for token storage: ${this.basePath}`);
  } catch (error) {
    console.error(`Failed to ensure token directory: ${this.basePath}`, error);
    throw error;
  }

  // Generate file paths
  const tokenPath = this.getTokenPath(provider);
  const tempPath = `${tokenPath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  try {
    console.debug(`Writing token to temp file: ${tempPath}`);
    // Write to temporary file first (atomic operation)
    await fs.writeFile(tempPath, JSON.stringify(validatedToken, null, 2), {
      mode: 0o600,
    });

    // Set secure permissions explicitly (skip on Windows)
    if (process.platform !== 'win32') {
      await fs.chmod(tempPath, 0o600);
    }

    console.debug(`Atomically moving temp file to final location: ${tokenPath}`);
    // Atomic rename to final location
    await fs.rename(tempPath, tokenPath);
    
    console.debug(`Successfully saved token for provider: ${provider}`);
  } catch (error) {
    console.error(`Failed to save token for provider ${provider}:`, error);
    
    // Cleanup temp file if it exists
    try {
      await fs.unlink(tempPath);
      console.debug(`Cleaned up temp file: ${tempPath}`);
    } catch (cleanupError) {
      console.debug(`Temp file cleanup failed (file may not exist): ${tempPath}`);
    }
    throw error;
  }
}

/**
 * Retrieve an OAuth token for a specific provider
 */
async getToken(provider: string): Promise<OAuthToken | null> {
  console.debug(`Attempting to load token for provider: ${provider}`);
  
  try {
    const tokenPath = this.getTokenPath(provider);
    console.debug(`Reading token from: ${tokenPath}`);
    
    const content = await fs.readFile(tokenPath, 'utf8');
    const parsed = JSON.parse(content);

    // Validate token structure
    const validatedToken = OAuthTokenSchema.parse(parsed);
    console.debug(`Successfully loaded and validated token for provider: ${provider}`);
    return validatedToken;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      console.debug(`No token file found for provider: ${provider}`);
    } else {
      console.error(`Failed to load token for provider ${provider}:`, error);
    }
    return null;
  }
}
```

## Testing Implementation

### Unit Tests

**File**: `/packages/cli/test/auth/oauth-provider-persistence.test.ts` (new)

```typescript
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

describe('OAuth Provider Token Persistence', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `oauth-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // Mock the token store to use temp directory
    tokenStore = new MultiProviderTokenStore();
    (tokenStore as any).basePath = join(tempDir, 'oauth');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should load saved tokens on initialization', async () => {
    // Save a token first
    const validToken = {
      access_token: 'test-access-token',
      expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      token_type: 'Bearer' as const,
    };
    
    await tokenStore.saveToken('qwen', validToken);
    
    // Create provider with token store
    const provider = new QwenOAuthProvider(tokenStore);
    
    // Wait for initialization to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Get token should return the saved token
    const loadedToken = await provider.getToken();
    expect(loadedToken).toEqual(validToken);
  });

  it('should not crash when TokenStore is missing', () => {
    expect(() => new QwenOAuthProvider()).not.toThrow();
  });

  it('should show deprecation warning when TokenStore is missing', () => {
    const consoleSpy = jest.spyOn(console, 'warn');
    new QwenOAuthProvider();
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEPRECATION: qwen OAuth provider created without TokenStore')
    );
  });
});
```

### Integration Tests

**File**: `/packages/cli/test/auth/oauth-manager-persistence.integration.test.ts` (new)

```typescript
describe('OAuthManager Token Persistence Integration', () => {
  it('should persist tokens across provider recreations', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const manager = new OAuthManager(tokenStore);
    
    // Create and register provider
    const provider1 = new QwenOAuthProvider(tokenStore);
    manager.registerProvider(provider1);
    
    // Mock successful authentication
    const validToken = {
      access_token: 'test-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    };
    
    await tokenStore.saveToken('qwen', validToken);
    
    // Create new manager and provider (simulates restart)
    const manager2 = new OAuthManager(tokenStore);
    const provider2 = new QwenOAuthProvider(tokenStore);
    manager2.registerProvider(provider2);
    
    // Token should be available in new provider
    const loadedToken = await provider2.getToken();
    expect(loadedToken).toEqual(validToken);
  });
});
```

## Deployment Strategy

### Phase 1: Infrastructure Fix
1. Deploy TokenStore logging enhancements
2. Update OAuthManager to pass TokenStore to providers
3. Verify no regressions in existing functionality

### Phase 2: Provider Updates
1. Deploy Qwen provider fixes
2. Deploy Anthropic provider fixes  
3. Test token persistence with real OAuth flows

### Phase 3: Validation
1. Full integration testing
2. User acceptance testing
3. Monitor error logs for persistence issues

## Success Criteria

1. **Token Loading**: Saved tokens are loaded on CLI startup
2. **Token Saving**: New tokens are persisted to disk immediately
3. **Error Handling**: Clear error messages for persistence failures
4. **Logging**: Debug logs show token load/save operations
5. **Backward Compatibility**: Existing auth flows continue working
6. **Performance**: No significant delay in CLI startup

## Risk Mitigation

### Risk: Initialization timing issues
**Mitigation**: Use proper async/await patterns and initialization promises

### Risk: Token validation failures
**Mitigation**: Graceful degradation when tokens are corrupted

### Risk: File system permission issues
**Mitigation**: Clear error messages and fallback to memory-only mode

### Risk: Concurrent access to token files
**Mitigation**: Atomic file operations with temporary files