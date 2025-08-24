# Phase 6: Integration Testing Strategy (Final Validation)

## Testing Overview

This comprehensive testing plan validates that all OAuth authentication fixes work together correctly and that the system is production-ready.

## Test Categories

### 1. Unit Tests (Provider Level)
- Individual OAuth provider functionality
- Error handling and recovery
- Token storage and retrieval
- Initialization patterns

### 2. Integration Tests (System Level)
- OAuth Manager with multiple providers
- Token persistence across restarts
- Legacy token migration
- Cross-provider authentication

### 3. End-to-End Tests (User Journey)
- Complete authentication flows
- Logout and re-authentication
- Error scenarios and recovery
- Multi-provider workflows

### 4. Regression Tests (Compatibility)
- Existing authentication continues working
- No breaking changes to API
- Performance impact validation
- Backward compatibility verification

## Detailed Test Plans

### Test Suite 1: Core OAuth Functionality

**File**: `/packages/cli/test/auth/oauth-core-integration.test.ts`

```typescript
import { OAuthManager } from '../../src/auth/oauth-manager.js';
import { QwenOAuthProvider } from '../../src/auth/qwen-oauth-provider.js';
import { AnthropicOAuthProvider } from '../../src/auth/anthropic-oauth-provider.js';  
import { GeminiOAuthProvider } from '../../src/auth/gemini-oauth-provider.js';
import { MultiProviderTokenStore } from '@vybestack/llxprt-code-core';
import { tmpdir } from 'os';
import { join } from 'path';
import { promises as fs } from 'fs';

describe('OAuth Core Integration Tests', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    // Setup isolated test environment
    tempDir = join(tmpdir(), `oauth-integration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    tokenStore = new MultiProviderTokenStore();
    (tokenStore as any).basePath = join(tempDir, 'oauth');
    
    oauthManager = new OAuthManager(tokenStore);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Provider Registration and Initialization', () => {
    it('should register all OAuth providers successfully', async () => {
      const qwenProvider = new QwenOAuthProvider(tokenStore);
      const anthropicProvider = new AnthropicOAuthProvider(tokenStore);
      const geminiProvider = new GeminiOAuthProvider(tokenStore);

      await oauthManager.registerProvider(qwenProvider);
      await oauthManager.registerProvider(anthropicProvider);
      await oauthManager.registerProvider(geminiProvider);

      const supportedProviders = oauthManager.getSupportedProviders();
      expect(supportedProviders).toContain('qwen');
      expect(supportedProviders).toContain('anthropic');
      expect(supportedProviders).toContain('gemini');
    });

    it('should initialize providers concurrently', async () => {
      const providers = [
        new QwenOAuthProvider(tokenStore),
        new AnthropicOAuthProvider(tokenStore),
        new GeminiOAuthProvider(tokenStore),
      ];

      const startTime = Date.now();
      await oauthManager.registerProviders(providers);
      const elapsed = Date.now() - startTime;

      // Should complete in reasonable time (parallel initialization)
      expect(elapsed).toBeLessThan(5000); // 5 seconds max

      // All providers should be registered
      expect(oauthManager.getSupportedProviders()).toHaveLength(3);
    });

    it('should handle provider initialization failures gracefully', async () => {
      // Mock provider that fails initialization
      class FailingProvider extends QwenOAuthProvider {
        constructor() {
          super(tokenStore);
        }

        protected async initializeToken(): Promise<void> {
          throw new Error('Initialization failed');
        }
      }

      const failingProvider = new FailingProvider();
      
      // Should not throw during registration
      await expect(oauthManager.registerProvider(failingProvider)).resolves.not.toThrow();

      // Provider should still be registered (graceful degradation)
      expect(oauthManager.getProvider('qwen')).toBeDefined();
    });
  });

  describe('Token Persistence and Loading', () => {
    it('should persist tokens across provider recreations', async () => {
      // Create provider and save token
      const provider1 = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider1);

      const validToken = {
        access_token: 'test-access-token',
        expiry: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
        token_type: 'Bearer' as const,
      };

      await tokenStore.saveToken('qwen', validToken);

      // Create new provider (simulates restart)
      const provider2 = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider2);

      // Token should be available in new provider
      const loadedToken = await provider2.getToken();
      expect(loadedToken).toEqual(validToken);
    });

    it('should handle multiple providers with different tokens', async () => {
      const providers = {
        qwen: new QwenOAuthProvider(tokenStore),
        anthropic: new AnthropicOAuthProvider(tokenStore),
        gemini: new GeminiOAuthProvider(tokenStore),
      };

      for (const provider of Object.values(providers)) {
        await oauthManager.registerProvider(provider);
      }

      // Save different tokens for each provider
      const tokens = {
        qwen: {
          access_token: 'qwen-token',
          expiry: Math.floor(Date.now() / 1000) + 3600,
          token_type: 'Bearer' as const,
        },
        anthropic: {
          access_token: 'anthropic-token',
          expiry: Math.floor(Date.now() / 1000) + 7200,
          token_type: 'Bearer' as const,
        },
        gemini: {
          access_token: 'gemini-token',
          expiry: Math.floor(Date.now() / 1000) + 1800,
          token_type: 'Bearer' as const,
        },
      };

      for (const [provider, token] of Object.entries(tokens)) {
        await tokenStore.saveToken(provider, token);
      }

      // Each provider should return its own token
      for (const [providerName, expectedToken] of Object.entries(tokens)) {
        const actualToken = await providers[providerName as keyof typeof providers].getToken();
        expect(actualToken).toEqual(expectedToken);
      }
    });

    it('should handle token expiry correctly', async () => {
      const provider = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider);

      // Save expired token
      const expiredToken = {
        access_token: 'expired-token',
        expiry: Math.floor(Date.now() / 1000) - 100, // Expired 100 seconds ago
        token_type: 'Bearer' as const,
      };

      await tokenStore.saveToken('qwen', expiredToken);

      // Provider should return null for expired token
      const retrievedToken = await provider.getToken();
      expect(retrievedToken).toBeNull();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle corrupted token storage', async () => {
      const provider = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider);

      // Create corrupted token file
      const tokenPath = join(tempDir, 'oauth', 'qwen.json');
      await fs.mkdir(join(tempDir, 'oauth'), { recursive: true });
      await fs.writeFile(tokenPath, 'invalid json content');

      // Should handle corruption gracefully
      const token = await provider.getToken();
      expect(token).toBeNull();
    });

    it('should handle missing token directory', async () => {
      // Don't create the oauth directory
      const provider = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider);

      // Should handle missing directory gracefully
      const token = await provider.getToken();
      expect(token).toBeNull();
    });

    it('should recover from file permission errors', async () => {
      if (process.platform === 'win32') {
        return; // Skip on Windows (no chmod)
      }

      const provider = new QwenOAuthProvider(tokenStore);
      await oauthManager.registerProvider(provider);

      // Create oauth directory with wrong permissions
      const oauthDir = join(tempDir, 'oauth');
      await fs.mkdir(oauthDir, { recursive: true });
      await fs.chmod(oauthDir, 0o000); // No permissions

      // Should handle permission error gracefully
      const token = await provider.getToken();
      expect(token).toBeNull();

      // Restore permissions for cleanup
      await fs.chmod(oauthDir, 0o755);
    });
  });
});
```

### Test Suite 2: Legacy Migration Integration

**File**: `/packages/cli/test/auth/legacy-migration-integration.test.ts`

```typescript
describe('Legacy Migration Integration Tests', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `legacy-migration-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    tokenStore = new MultiProviderTokenStore();
    (tokenStore as any).basePath = join(tempDir, 'oauth');
    
    oauthManager = new OAuthManager(tokenStore);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should migrate legacy Google OAuth tokens on first access', async () => {
    // Setup legacy token file
    const legacyToken = {
      access_token: 'ya29.legacy-google-token',
      refresh_token: '1//04-refresh-token',
      expiry_date: Date.now() + 3600000, // 1 hour from now
      token_type: 'Bearer',
      scope: 'https://www.googleapis.com/auth/cloud-platform',
    };

    await fs.writeFile(
      join(tempDir, 'oauth_creds.json'),
      JSON.stringify(legacyToken, null, 2)
    );

    // Mock legacy detector to use temp directory
    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    (geminiProvider as any).legacyDir = tempDir;
    
    await oauthManager.registerProvider(geminiProvider);

    // First token access should trigger migration
    const token = await oauthManager.getToken('gemini');
    
    expect(token).toBe('ya29.legacy-google-token');

    // Token should be migrated to new storage
    const migratedToken = await tokenStore.getToken('gemini');
    expect(migratedToken).toBeTruthy();
    expect(migratedToken!.access_token).toBe('ya29.legacy-google-token');
  });

  it('should prefer new storage over legacy', async () => {
    // Setup both legacy and new tokens
    const legacyToken = {
      access_token: 'legacy-token',
      expiry_date: Date.now() + 3600000,
    };

    const newToken = {
      access_token: 'new-token',
      expiry: Math.floor((Date.now() + 3600000) / 1000),
      token_type: 'Bearer' as const,
    };

    await fs.writeFile(
      join(tempDir, 'oauth_creds.json'),
      JSON.stringify(legacyToken, null, 2)
    );

    await tokenStore.saveToken('gemini', newToken);

    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    await oauthManager.registerProvider(geminiProvider);

    // Should prefer new storage
    const token = await oauthManager.getToken('gemini');
    expect(token).toBe('new-token');
  });

  it('should handle corrupted legacy tokens gracefully', async () => {
    // Setup corrupted legacy file
    await fs.writeFile(join(tempDir, 'oauth_creds.json'), 'invalid json');

    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    (geminiProvider as any).legacyDir = tempDir;
    
    await oauthManager.registerProvider(geminiProvider);

    // Should handle corruption without crashing
    const token = await oauthManager.getToken('gemini');
    expect(token).toBeNull();
  });
});
```

### Test Suite 3: End-to-End User Journeys

**File**: `/packages/cli/test/auth/oauth-e2e.test.ts`

```typescript
describe('OAuth End-to-End User Journeys', () => {
  let tempDir: string;
  let tokenStore: MultiProviderTokenStore;
  let oauthManager: OAuthManager;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `oauth-e2e-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    tokenStore = new MultiProviderTokenStore();
    (tokenStore as any).basePath = join(tempDir, 'oauth');
    
    oauthManager = new OAuthManager(tokenStore);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('should complete full authentication flow', async () => {
    const qwenProvider = new QwenOAuthProvider(tokenStore);
    
    // Mock device flow for testing
    (qwenProvider as any).deviceFlow = {
      initiateDeviceFlow: jest.fn().mockResolvedValue({
        device_code: 'test-device-code',
        user_code: 'TEST-CODE',
        verification_uri: 'https://example.com/verify',
        expires_in: 600,
      }),
      pollForToken: jest.fn().mockResolvedValue({
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
      }),
    };

    await oauthManager.registerProvider(qwenProvider);

    // Enable OAuth for provider
    await oauthManager.toggleOAuthEnabled('qwen');
    expect(oauthManager.isOAuthEnabled('qwen')).toBe(true);

    // Authenticate
    await oauthManager.authenticate('qwen');

    // Token should be available
    const token = await oauthManager.getToken('qwen');
    expect(token).toBe('test-access-token');

    // Check authentication status
    const statuses = await oauthManager.getAuthStatus();
    const qwenStatus = statuses.find(s => s.provider === 'qwen');
    
    expect(qwenStatus).toBeDefined();
    expect(qwenStatus!.authenticated).toBe(true);
    expect(qwenStatus!.authType).toBe('oauth');
    expect(qwenStatus!.expiresIn).toBeGreaterThan(3500); // ~1 hour
  });

  it('should handle complete logout flow', async () => {
    const qwenProvider = new QwenOAuthProvider(tokenStore);
    await oauthManager.registerProvider(qwenProvider);
    await oauthManager.toggleOAuthEnabled('qwen');

    // Setup authenticated state
    const validToken = {
      access_token: 'test-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer' as const,
    };
    
    await tokenStore.saveToken('qwen', validToken);

    // Verify authenticated
    const beforeLogout = await oauthManager.getToken('qwen');
    expect(beforeLogout).toBe('test-token');

    // Logout
    await oauthManager.logout('qwen');

    // Should be logged out
    const afterLogout = await oauthManager.getToken('qwen');
    expect(afterLogout).toBeNull();

    // Status should reflect logout
    const statuses = await oauthManager.getAuthStatus();
    const qwenStatus = statuses.find(s => s.provider === 'qwen');
    expect(qwenStatus!.authenticated).toBe(false);
  });

  it('should handle token refresh flow', async () => {
    const qwenProvider = new QwenOAuthProvider(tokenStore);
    
    // Mock refresh functionality
    (qwenProvider as any).deviceFlow = {
      refreshToken: jest.fn().mockResolvedValue({
        access_token: 'refreshed-access-token',
        refresh_token: 'refreshed-refresh-token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer',
      }),
    };

    await oauthManager.registerProvider(qwenProvider);

    // Setup token that needs refresh (expires in 10 seconds)
    const soonToExpireToken = {
      access_token: 'soon-to-expire',
      refresh_token: 'test-refresh-token',
      expiry: Math.floor(Date.now() / 1000) + 10,
      token_type: 'Bearer' as const,
    };

    await tokenStore.saveToken('qwen', soonToExpireToken);

    // Request refresh
    const refreshedToken = await qwenProvider.refreshIfNeeded();

    expect(refreshedToken).toBeTruthy();
    expect(refreshedToken!.access_token).toBe('refreshed-access-token');

    // Refreshed token should be persisted
    const storedToken = await tokenStore.getToken('qwen');
    expect(storedToken!.access_token).toBe('refreshed-access-token');
  });

  it('should support multiple concurrent providers', async () => {
    const providers = {
      qwen: new QwenOAuthProvider(tokenStore),
      anthropic: new AnthropicOAuthProvider(tokenStore),
      gemini: new GeminiOAuthProvider(tokenStore),
    };

    // Register all providers
    for (const provider of Object.values(providers)) {
      await oauthManager.registerProvider(provider);
    }

    // Enable OAuth for all providers
    for (const providerName of Object.keys(providers)) {
      await oauthManager.toggleOAuthEnabled(providerName);
    }

    // Setup tokens for all providers
    const tokens = {
      qwen: {
        access_token: 'qwen-token',
        expiry: Math.floor(Date.now() / 1000) + 3600,
        token_type: 'Bearer' as const,
      },
      anthropic: {
        access_token: 'anthropic-token', 
        expiry: Math.floor(Date.now() / 1000) + 7200,
        token_type: 'Bearer' as const,
      },
      gemini: {
        access_token: 'gemini-token',
        expiry: Math.floor(Date.now() / 1000) + 1800,
        token_type: 'Bearer' as const,
      },
    };

    for (const [provider, token] of Object.entries(tokens)) {
      await tokenStore.saveToken(provider, token);
    }

    // All providers should work independently
    for (const [providerName, expectedToken] of Object.entries(tokens)) {
      const actualToken = await oauthManager.getToken(providerName);
      expect(actualToken).toBe(expectedToken.access_token);
    }

    // Authentication status should show all providers
    const statuses = await oauthManager.getAuthStatus();
    expect(statuses).toHaveLength(3);
    
    for (const status of statuses) {
      expect(status.authenticated).toBe(true);
      expect(status.authType).toBe('oauth');
    }
  });
});
```

### Test Suite 4: Regression Testing

**File**: `/packages/cli/test/auth/oauth-regression.test.ts`

```typescript
describe('OAuth Regression Tests', () => {
  it('should maintain backward compatibility with existing OAuth flows', async () => {
    // Test that existing code patterns still work
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore);
    
    // Old-style provider creation (without TokenStore)
    const provider = new QwenOAuthProvider();
    
    // Should show deprecation warning but not crash
    const consoleSpy = jest.spyOn(console, 'warn');
    await oauthManager.registerProvider(provider);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('DEPRECATION')
    );
    
    // Provider should still be usable (memory-only mode)
    const token = await provider.getToken();
    expect(token).toBeNull(); // No token, but no crash
  });

  it('should handle OAuth Manager without settings', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore); // No settings parameter
    
    const provider = new QwenOAuthProvider(tokenStore);
    await oauthManager.registerProvider(provider);
    
    // Should work with in-memory OAuth state
    const enabled = await oauthManager.toggleOAuthEnabled('qwen');
    expect(enabled).toBe(true);
    expect(oauthManager.isOAuthEnabled('qwen')).toBe(true);
  });

  it('should not break existing authentication precedence', async () => {
    // Mock environment variable auth
    process.env.QWEN_API_KEY = 'env-api-key';
    
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore);
    const provider = new QwenOAuthProvider(tokenStore);
    
    await oauthManager.registerProvider(provider);
    
    // OAuth disabled - should use env var
    expect(oauthManager.isOAuthEnabled('qwen')).toBe(false);
    
    // Should check higher priority auth methods
    const higherPriorityAuth = await oauthManager.getHigherPriorityAuth('qwen');
    expect(higherPriorityAuth).toBe('Environment Variable');
    
    delete process.env.QWEN_API_KEY;
  });

  it('should maintain performance within acceptable limits', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore);
    
    const providers = Array.from({ length: 10 }, (_, i) => new QwenOAuthProvider(tokenStore));
    
    const startTime = Date.now();
    
    // Register multiple providers
    for (const provider of providers) {
      await oauthManager.registerProvider(provider);
    }
    
    const registrationTime = Date.now() - startTime;
    
    // Should complete within reasonable time
    expect(registrationTime).toBeLessThan(2000); // 2 seconds max
    
    // Token access should be fast after initialization
    const tokenStartTime = Date.now();
    
    for (let i = 0; i < providers.length; i++) {
      await providers[i].getToken();
    }
    
    const tokenAccessTime = Date.now() - tokenStartTime;
    expect(tokenAccessTime).toBeLessThan(100); // 100ms max for 10 providers
  });
});
```

### Test Suite 5: Cache Clearing Tests

**File**: `/packages/cli/test/auth/oauth-cache-clearing.test.ts`

```typescript
describe('OAuth Cache Clearing Tests', () => {
  it('should clear OAuth client cache on Gemini logout', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    
    // Mock the cache clearing function
    const mockClearCache = jest.fn();
    jest.doMock('@vybestack/llxprt-code-core', () => ({
      ...jest.requireActual('@vybestack/llxprt-code-core'),
      clearOauthClientCache: mockClearCache,
    }));
    
    await geminiProvider.logout();
    
    expect(mockClearCache).toHaveBeenCalledWith(); // Called with no args (clear all)
  });

  it('should handle cache clearing failures gracefully', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const geminiProvider = new GeminiOAuthProvider(tokenStore);
    
    // Mock cache clearing to fail
    const mockClearCache = jest.fn().mockImplementation(() => {
      throw new Error('Cache clearing failed');
    });
    
    jest.doMock('@vybestack/llxprt-code-core', () => ({
      ...jest.requireActual('@vybestack/llxprt-code-core'),
      clearOauthClientCache: mockClearCache,
    }));
    
    const consoleSpy = jest.spyOn(console, 'warn');
    
    // Should not throw, but should warn
    await expect(geminiProvider.logout()).resolves.not.toThrow();
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to clear OAuth client cache')
    );
  });
});
```

## Performance Tests

### Test Suite 6: Performance Validation

**File**: `/packages/cli/test/auth/oauth-performance.test.ts`

```typescript
describe('OAuth Performance Tests', () => {
  it('should initialize providers within acceptable time', async () => {
    const startTime = process.hrtime.bigint();
    
    const tokenStore = new MultiProviderTokenStore();
    const providers = [
      new QwenOAuthProvider(tokenStore),
      new AnthropicOAuthProvider(tokenStore),
      new GeminiOAuthProvider(tokenStore),
    ];
    
    const oauthManager = new OAuthManager(tokenStore);
    await oauthManager.registerProviders(providers);
    
    const endTime = process.hrtime.bigint();
    const elapsedMs = Number(endTime - startTime) / 1_000_000;
    
    // Should complete within 1 second
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('should handle concurrent token access efficiently', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const provider = new QwenOAuthProvider(tokenStore);
    
    // Save token
    await tokenStore.saveToken('qwen', {
      access_token: 'test-token',
      expiry: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'Bearer',
    });
    
    const startTime = process.hrtime.bigint();
    
    // 100 concurrent token accesses
    const promises = Array.from({ length: 100 }, () => provider.getToken());
    await Promise.all(promises);
    
    const endTime = process.hrtime.bigint();
    const elapsedMs = Number(endTime - startTime) / 1_000_000;
    
    // Should complete within 500ms
    expect(elapsedMs).toBeLessThan(500);
  });

  it('should not leak memory during repeated operations', async () => {
    const tokenStore = new MultiProviderTokenStore();
    const oauthManager = new OAuthManager(tokenStore);
    const provider = new QwenOAuthProvider(tokenStore);
    
    await oauthManager.registerProvider(provider);
    
    const initialMemory = process.memoryUsage().heapUsed;
    
    // Perform many operations
    for (let i = 0; i < 1000; i++) {
      await provider.getToken();
      await oauthManager.isOAuthEnabled('qwen');
      
      // Force garbage collection occasionally
      if (i % 100 === 0 && global.gc) {
        global.gc();
      }
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryIncrease = finalMemory - initialMemory;
    
    // Memory increase should be minimal (< 10MB)
    expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
  });
});
```

## Test Execution Strategy

### Test Environment Setup

**File**: `/packages/cli/test/setup/oauth-test-env.ts`

```typescript
import { jest } from '@jest/globals';

// Global test setup for OAuth tests
beforeAll(() => {
  // Suppress OAuth warnings in tests
  process.env.LLXPRT_SUPPRESS_LEGACY_WARNINGS = 'true';
  
  // Mock browser launching for tests
  jest.mock('open', () => jest.fn().mockResolvedValue(undefined));
  
  // Mock secure browser launcher
  jest.mock('@vybestack/llxprt-code-core', () => ({
    ...jest.requireActual('@vybestack/llxprt-code-core'),
    openBrowserSecurely: jest.fn().mockResolvedValue(undefined),
  }));
});

afterAll(() => {
  // Cleanup test environment
  delete process.env.LLXPRT_SUPPRESS_LEGACY_WARNINGS;
});

// Test utilities
export const createTempDirectory = async (): Promise<string> => {
  const { tmpdir } = await import('os');
  const { join } = await import('path');
  const { promises: fs } = await import('fs');
  
  const tempDir = join(tmpdir(), `oauth-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  await fs.mkdir(tempDir, { recursive: true });
  return tempDir;
};

export const cleanupTempDirectory = async (tempDir: string): Promise<void> => {
  const { promises: fs } = await import('fs');
  await fs.rm(tempDir, { recursive: true, force: true });
};

export const createMockTokenStore = (tempDir?: string): MultiProviderTokenStore => {
  const tokenStore = new MultiProviderTokenStore();
  if (tempDir) {
    (tokenStore as any).basePath = join(tempDir, 'oauth');
  }
  return tokenStore;
};

export const createValidToken = (expiryOffset: number = 3600): OAuthToken => {
  return {
    access_token: `test-token-${Date.now()}`,
    refresh_token: `refresh-token-${Date.now()}`,
    expiry: Math.floor(Date.now() / 1000) + expiryOffset,
    token_type: 'Bearer',
  };
};

export const createExpiredToken = (): OAuthToken => {
  return createValidToken(-100); // Expired 100 seconds ago
};
```

### Test Configuration

**File**: `/packages/cli/jest.config.oauth.js`

```javascript
module.exports = {
  displayName: 'OAuth Integration Tests',
  testMatch: ['**/test/auth/**/*.test.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup/oauth-test-env.ts'],
  testTimeout: 30000, // 30 seconds for integration tests
  maxWorkers: 4, // Limit parallelism for file system tests
  
  // Coverage requirements
  collectCoverageFrom: [
    'src/auth/**/*.ts',
    '!src/auth/**/*.d.ts',
    '!src/auth/**/*.test.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 85,
      functions: 90,
      lines: 90,
      statements: 90,
    },
  },
  
  // Test categorization
  testEnvironment: 'node',
  verbose: true,
  
  // Mock configuration
  clearMocks: true,
  restoreMocks: true,
  
  // Retry flaky tests
  retry: 2,
};
```

### Continuous Integration

**File**: `.github/workflows/oauth-integration-tests.yml`

```yaml
name: OAuth Integration Tests

on:
  push:
    branches: [main, 'auth-fixes/*']
    paths: ['packages/*/src/auth/**', 'packages/*/test/auth/**']
  pull_request:
    paths: ['packages/*/src/auth/**', 'packages/*/test/auth/**']

jobs:
  oauth-tests:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node-version: [18, 20, 22]
        
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: 'npm'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run OAuth integration tests
        run: npm run test:oauth
        env:
          CI: true
          LLXPRT_DEBUG: auth
          
      - name: Upload test coverage
        uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
          flags: oauth-integration
          
      - name: Upload test results
        uses: actions/upload-artifact@v3
        if: always()
        with:
          name: oauth-test-results-${{ matrix.os }}-node${{ matrix.node-version }}
          path: |
            test-results/
            coverage/
```

## Success Criteria

### Functional Requirements
- [ ] All OAuth providers initialize correctly
- [ ] Token persistence works across restarts  
- [ ] Legacy token migration completes successfully
- [ ] Error handling provides clear user guidance
- [ ] Cache clearing prevents session leakage
- [ ] Multiple providers work independently

### Performance Requirements
- [ ] Provider initialization < 1 second
- [ ] Token access < 10ms after initialization
- [ ] Memory usage stable during repeated operations
- [ ] No memory leaks in long-running processes

### Reliability Requirements
- [ ] Tests pass consistently across platforms
- [ ] Error recovery works for common failures
- [ ] Graceful degradation when storage unavailable
- [ ] No crashes or unhandled promise rejections

### Compatibility Requirements
- [ ] Existing authentication flows continue working
- [ ] No breaking changes to public APIs
- [ ] Backward compatibility with older configurations
- [ ] Migration preserves all user data

## Deployment Validation

### Pre-Deployment Checklist
- [ ] All integration tests pass on CI
- [ ] Performance tests meet benchmarks
- [ ] Security review completed
- [ ] Documentation updated
- [ ] Migration scripts tested

### Post-Deployment Monitoring
- [ ] Authentication success rates maintained
- [ ] Error rates within acceptable limits
- [ ] User support tickets do not increase
- [ ] Performance metrics stable
- [ ] Token persistence working in production

### Rollback Criteria
- Authentication success rate < 95%
- Error rate > 5% increase
- Performance degradation > 50%
- Critical security vulnerabilities
- User data loss incidents

This comprehensive testing strategy ensures that all OAuth authentication fixes work correctly together and that the system is production-ready with proper validation, monitoring, and rollback capabilities.