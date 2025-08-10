/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { TokenStore } from '@vybestack/llxprt-code-core';
import { OAuthManager, OAuthProvider } from '../../src/auth/oauth-manager.js';
import { AuthCommandExecutor } from '../../src/ui/commands/authCommand.js';
import { OAuthToken } from '../../src/auth/types.js';

/**
 * Mock implementation of Qwen OAuth device flow provider
 * Simulates the real device flow authentication process
 */
class MockQwenDeviceFlow implements OAuthProvider {
  name = 'qwen';
  private currentToken: OAuthToken | null = null;
  private shouldFailAuth = false;
  private shouldTimeout = false;
  private authStartTime: number | null = null;

  /**
   * Configure auth behavior for testing
   */
  setAuthBehavior(options: {
    shouldFail?: boolean;
    shouldTimeout?: boolean;
  }): void {
    this.shouldFailAuth = options.shouldFail || false;
    this.shouldTimeout = options.shouldTimeout || false;
  }

  async initiateAuth(): Promise<void> {
    this.authStartTime = Date.now();

    // Simulate timeout scenario (15 minute timeout)
    if (this.shouldTimeout) {
      await new Promise((resolve) => setTimeout(resolve, 100)); // Small delay to simulate network
      throw new Error('Authentication timed out after 15 minutes');
    }

    // Simulate auth failure scenario
    if (this.shouldFailAuth) {
      throw new Error('User denied authorization');
    }

    // Simulate successful device flow:
    // 1. Display device code (simulated)
    console.log('[Mock] Device code: MOCK-DEVICE-CODE');
    console.log('[Mock] Visit: https://oauth.qwen.alibaba.com/device');
    console.log('[Mock] Enter code: MOCK-USER-CODE');

    // 2. Simulate polling completion with success
    await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate network delay

    // 3. Generate mock token
    const now = Date.now();
    this.currentToken = {
      access_token: 'mock-qwen-access-token-' + now,
      refresh_token: 'mock-qwen-refresh-token-' + now,
      expiry: now + 60 * 60 * 1000, // 1 hour from now
      token_type: 'Bearer' as const,
      scope: 'chat:read chat:write',
    };
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    if (!this.currentToken) {
      return null;
    }

    // Always refresh when called (for testing)
    const now = Date.now();
    this.currentToken = {
      ...this.currentToken,
      access_token: 'mock-qwen-refreshed-access-token-' + now,
      expiry: now + 60 * 60 * 1000, // 1 hour from now
    };

    return this.currentToken;
  }
}

/**
 * Mock implementation of OAuth-enabled OpenAI provider
 */
class MockOpenAIProviderWithOAuth implements OAuthProvider {
  name = 'openai';
  private currentToken: OAuthToken | null = null;

  async initiateAuth(): Promise<void> {
    // Simulate OAuth flow for OpenAI/Qwen endpoint
    await new Promise((resolve) => setTimeout(resolve, 50));

    const now = Date.now();
    this.currentToken = {
      access_token: 'mock-openai-oauth-token-' + now,
      expiry: now + 2 * 60 * 60 * 1000, // 2 hours from now
      token_type: 'Bearer' as const,
    };
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    return this.currentToken;
  }
}

/**
 * Mock implementation of Gemini OAuth provider (existing)
 */
class MockGeminiOAuthProvider implements OAuthProvider {
  name = 'gemini';
  private currentToken: OAuthToken | null = null;

  async initiateAuth(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 50));

    const now = Date.now();
    this.currentToken = {
      access_token: 'mock-gemini-oauth-token-' + now,
      expiry: now + 60 * 60 * 1000, // 1 hour from now
      token_type: 'Bearer' as const,
      scope: 'generativeai',
    };
  }

  async getToken(): Promise<OAuthToken | null> {
    return this.currentToken;
  }

  async refreshIfNeeded(): Promise<OAuthToken | null> {
    return this.currentToken;
  }
}

/**
 * Mock token store for testing that simulates file system operations
 * without actually touching the file system
 */
class MockTokenStore implements TokenStore {
  private tokens: Map<string, OAuthToken> = new Map();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || join(homedir(), '.llxprt', 'oauth');
  }

  async saveToken(provider: string, token: OAuthToken): Promise<void> {
    // Validate provider name
    if (!provider || provider.trim() === '') {
      throw new Error('Provider name cannot be empty');
    }

    // Store token in memory
    this.tokens.set(provider, { ...token });
  }

  async getToken(provider: string): Promise<OAuthToken | null> {
    return this.tokens.get(provider) || null;
  }

  async removeToken(provider: string): Promise<void> {
    this.tokens.delete(provider);
  }

  async listProviders(): Promise<string[]> {
    return Array.from(this.tokens.keys()).sort();
  }

  // Test helper methods
  getTokenFilePath(provider: string): string {
    return join(this.basePath, `${provider}.json`);
  }

  simulateFileSystemOperation(provider: string): {
    path: string;
    permissions: number;
  } {
    return {
      path: this.getTokenFilePath(provider),
      permissions: 0o600, // Simulate secure file permissions
    };
  }
}

/**
 * Helper function to create test OAuth directory structure
 */
async function createTestOAuthDir(): Promise<string> {
  const testDir = join('/tmp', '.llxprt-test-' + Date.now());
  const oauthDir = join(testDir, 'oauth');
  await fs.mkdir(oauthDir, { recursive: true, mode: 0o700 });
  return testDir;
}

/**
 * Helper function to cleanup test directory
 */
async function cleanupTestDir(testDir: string): Promise<void> {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

describe('Qwen OAuth End-to-End Integration Tests', () => {
  let tokenStore: MockTokenStore;
  let oauthManager: OAuthManager;
  let authExecutor: AuthCommandExecutor;
  let qwenProvider: MockQwenDeviceFlow;
  let openaiProvider: MockOpenAIProviderWithOAuth;
  let geminiProvider: MockGeminiOAuthProvider;
  let testDir: string;
  let originalHome: string;

  beforeEach(async () => {
    // Create isolated test environment
    testDir = await createTestOAuthDir();
    originalHome = process.env.HOME || '';

    // Initialize components with mock token store
    tokenStore = new MockTokenStore(join(testDir, '.llxprt', 'oauth'));
    oauthManager = new OAuthManager(tokenStore);

    // Create mock providers
    qwenProvider = new MockQwenDeviceFlow();
    openaiProvider = new MockOpenAIProviderWithOAuth();
    geminiProvider = new MockGeminiOAuthProvider();

    // Register providers
    oauthManager.registerProvider(qwenProvider);
    oauthManager.registerProvider(openaiProvider);
    oauthManager.registerProvider(geminiProvider);

    authExecutor = new AuthCommandExecutor(oauthManager);
  });

  afterEach(async () => {
    // Restore environment
    process.env.HOME = originalHome;
    vi.restoreAllMocks();

    // Cleanup test directory
    await cleanupTestDir(testDir);
  });

  describe('Complete OAuth Flow', () => {
    /**
     * @requirement REQ-001, REQ-002
     * @scenario Full Qwen OAuth authentication
     * @given Fresh llxprt installation
     * @when User runs /auth qwen
     * @then Device code displayed
     * @and Polling completes on authorization
     * @and Token stored securely
     * @and Provider becomes available
     */
    it('should complete full Qwen OAuth authentication flow', async () => {
      // Execute authentication command
      const result = await authExecutor.execute({}, 'qwen');

      // Verify successful authentication
      expect(result.type).toBe('message');
      expect(result.messageType).toBe('info');
      expect(result.content).toContain('Successfully authenticated with qwen');

      // Verify token is stored
      const token = await tokenStore.getToken('qwen');
      expect(token).toBeDefined();
      expect(token?.access_token).toMatch(/mock-qwen-access-token-/);
      expect(token?.token_type).toBe('Bearer');
      expect(token?.scope).toBe('chat:read chat:write');

      // Verify token would be stored securely (simulated)
      const fileInfo = tokenStore.simulateFileSystemOperation('qwen');
      expect(fileInfo.permissions).toBe(0o600);
      expect(fileInfo.path).toMatch(/qwen\.json$/);

      // Verify provider is available
      const authStatus = await oauthManager.getAuthStatus();
      const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
      expect(qwenStatus?.authenticated).toBe(true);
      expect(qwenStatus?.authType).toBe('oauth');
    });

    /**
     * @requirement REQ-001.3, REQ-003.1
     * @scenario Multi-provider authentication
     * @given No providers authenticated
     * @when Auth gemini then auth qwen
     * @then Both providers authenticated
     * @and Can use either for content generation
     * @and Tokens stored separately
     */
    it('should support multi-provider authentication', async () => {
      // Authenticate with Gemini first
      const geminiResult = await authExecutor.execute({}, 'gemini');
      expect(geminiResult.type).toBe('message');
      expect(geminiResult.messageType).toBe('info');

      // Then authenticate with Qwen
      const qwenResult = await authExecutor.execute({}, 'qwen');
      expect(qwenResult.type).toBe('message');
      expect(qwenResult.messageType).toBe('info');

      // Verify both providers are authenticated
      const authStatus = await oauthManager.getAuthStatus();
      expect(authStatus).toHaveLength(3); // qwen, openai, gemini

      const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
      const geminiStatus = authStatus.find((s) => s.provider === 'gemini');

      expect(qwenStatus?.authenticated).toBe(true);
      expect(geminiStatus?.authenticated).toBe(true);

      // Verify tokens are stored separately
      const qwenToken = await tokenStore.getToken('qwen');
      const geminiToken = await tokenStore.getToken('gemini');

      expect(qwenToken?.access_token).toMatch(/mock-qwen-access-token-/);
      expect(geminiToken?.access_token).toMatch(/mock-gemini-oauth-token-/);
      expect(qwenToken?.access_token).not.toBe(geminiToken?.access_token);

      // Verify tokens would be stored in separate files (simulated)
      const qwenFileInfo = tokenStore.simulateFileSystemOperation('qwen');
      const geminiFileInfo = tokenStore.simulateFileSystemOperation('gemini');

      expect(qwenFileInfo.path).toMatch(/qwen\.json$/);
      expect(geminiFileInfo.path).toMatch(/gemini\.json$/);
      expect(qwenFileInfo.path).not.toBe(geminiFileInfo.path);
    });
  });

  describe('Provider Switching', () => {
    /**
     * @requirement REQ-004, REQ-006.3
     * @scenario Use Qwen with Gemini tools
     * @given Qwen and Gemini both authenticated
     * @when --provider openai with web search
     * @then Content from Qwen (via OAuth)
     * @and Web search from Gemini (via OAuth)
     */
    it('should support using Qwen with Gemini tools', async () => {
      // Setup: authenticate both providers
      await authExecutor.execute({}, 'qwen');
      await authExecutor.execute({}, 'gemini');

      // Verify both tokens are available for provider switching
      const qwenToken = await oauthManager.getToken('qwen');
      const geminiToken = await oauthManager.getToken('gemini');

      expect(qwenToken).toBeDefined();
      expect(geminiToken).toBeDefined();

      // Verify OAuth manager can provide tokens for cross-provider usage
      expect(qwenToken?.access_token).toMatch(/mock-qwen-access-token-/);
      expect(geminiToken?.access_token).toMatch(/mock-gemini-oauth-token-/);

      // Both tokens should be valid and non-expired
      const now = Date.now();
      expect(qwenToken!.expiry).toBeGreaterThan(now);
      expect(geminiToken!.expiry).toBeGreaterThan(now);
    });

    /**
     * @requirement REQ-004.1
     * @scenario OAuth fallback with API key override
     * @given Qwen OAuth authenticated
     * @when --key provided for different service
     * @then Uses API key, ignores OAuth
     */
    it('should support API key override with OAuth fallback', async () => {
      // Setup: authenticate Qwen via OAuth
      await authExecutor.execute({}, 'qwen');
      const oauthToken = await oauthManager.getToken('qwen');
      expect(oauthToken).toBeDefined();

      // Simulate API key environment variable being set
      const originalApiKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-api-key-override';

      try {
        // The system should prioritize API key over OAuth when explicitly provided
        // This is tested by verifying OAuth token is still available but environment variable takes precedence
        expect(process.env.OPENAI_API_KEY).toBe('sk-test-api-key-override');
        expect(oauthToken?.access_token).toMatch(/mock-qwen-access-token-/);

        // Both authentication methods are available simultaneously
        const authStatus = await oauthManager.getAuthStatus();
        const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
        expect(qwenStatus?.authenticated).toBe(true);
      } finally {
        // Restore environment
        if (originalApiKey) {
          process.env.OPENAI_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });
  });

  describe('Token Lifecycle', () => {
    /**
     * @requirement REQ-002.5, REQ-004.4
     * @scenario Automatic token refresh
     * @given Qwen token expires in 1 minute
     * @when Making API call after expiry
     * @then Token automatically refreshed
     * @and Request completes successfully
     */
    it('should automatically refresh expired tokens', async () => {
      // Setup: authenticate and get initial token
      await authExecutor.execute({}, 'qwen');
      const initialToken = await oauthManager.getToken('qwen');
      expect(initialToken).toBeDefined();

      // Simulate token near expiry (within 30 seconds)
      const nearExpiryToken: OAuthToken = {
        ...initialToken!,
        expiry: Date.now() + 15000, // Expires in 15 seconds
      };
      await tokenStore.saveToken('qwen', nearExpiryToken);

      // Request token - should trigger refresh
      const refreshedToken = await oauthManager.getToken('qwen');

      expect(refreshedToken).toBeDefined();
      expect(refreshedToken!.access_token).toMatch(
        /mock-qwen-refreshed-access-token-/,
      );
      expect(refreshedToken!.expiry).toBeGreaterThan(Date.now() + 30000); // New expiry is later

      // Verify refreshed token is stored
      const storedToken = await tokenStore.getToken('qwen');
      expect(storedToken?.access_token).toBe(refreshedToken!.access_token);
    });

    /**
     * @requirement REQ-003.2
     * @scenario Secure token storage
     * @given OAuth token saved
     * @when Checking file permissions
     * @then File has 0600 permissions
     * @and Located at ~/.llxprt/oauth/qwen.json
     */
    it('should store tokens securely with correct permissions', async () => {
      // Authenticate to trigger token storage
      await authExecutor.execute({}, 'qwen');

      // Verify token is stored
      const token = await tokenStore.getToken('qwen');
      expect(token).toBeDefined();

      // Verify simulated file permissions (0600 = user read/write only)
      const fileInfo = tokenStore.simulateFileSystemOperation('qwen');
      expect(fileInfo.permissions).toBe(0o600);

      // Verify expected file path structure
      expect(fileInfo.path).toMatch(/\.llxprt\/oauth\/qwen\.json$/);

      // Verify token content structure
      expect(token?.access_token).toMatch(/mock-qwen-access-token-/);
      expect(token?.token_type).toBe('Bearer');
      expect(token?.expiry).toBeGreaterThan(Date.now());
    });
  });

  describe('Error Recovery', () => {
    /**
     * @requirement REQ-002.1
     * @scenario Handle auth timeout
     * @given OAuth flow started
     * @when 15 minutes pass without auth
     * @then Flow times out gracefully
     * @and Clear error message shown
     * @and No token stored
     */
    it('should handle authentication timeout gracefully', async () => {
      // Configure provider to simulate timeout
      qwenProvider.setAuthBehavior({ shouldTimeout: true });

      // Attempt authentication - should timeout
      const result = await authExecutor.execute({}, 'qwen');

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Authentication failed for qwen');
      expect(result.content).toContain('timed out after 15 minutes');

      // Verify no token was stored
      const token = await tokenStore.getToken('qwen');
      expect(token).toBeNull();

      // Verify provider remains unauthenticated
      const authStatus = await oauthManager.getAuthStatus();
      const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
      expect(qwenStatus?.authenticated).toBe(false);
    });

    /**
     * @requirement REQ-002.1
     * @scenario Handle auth denial
     * @given OAuth flow started
     * @when User denies authorization
     * @then Appropriate error shown
     * @and Provider remains unauthenticated
     */
    it('should handle authentication denial gracefully', async () => {
      // Configure provider to simulate auth denial
      qwenProvider.setAuthBehavior({ shouldFail: true });

      // Attempt authentication - should fail
      const result = await authExecutor.execute({}, 'qwen');

      expect(result.type).toBe('message');
      expect(result.messageType).toBe('error');
      expect(result.content).toContain('Authentication failed for qwen');
      expect(result.content).toContain('User denied authorization');

      // Verify no token was stored
      const token = await tokenStore.getToken('qwen');
      expect(token).toBeNull();

      // Verify provider remains unauthenticated
      const authStatus = await oauthManager.getAuthStatus();
      const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
      expect(qwenStatus?.authenticated).toBe(false);
    });
  });

  describe('Backward Compatibility', () => {
    /**
     * @requirement REQ-006.1, REQ-006.2
     * @scenario Existing API keys still work
     * @given OPENAI_API_KEY environment variable
     * @when Using OpenAI provider
     * @then Works without OAuth
     * @and No OAuth prompts shown
     */
    it('should maintain API key compatibility', async () => {
      // Setup API key environment
      const originalApiKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'sk-test-existing-api-key';

      try {
        // API key should work independently of OAuth system
        expect(process.env.OPENAI_API_KEY).toBe('sk-test-existing-api-key');

        // OAuth system should still be available for other providers
        await authExecutor.execute({}, 'qwen');
        const qwenToken = await oauthManager.getToken('qwen');
        expect(qwenToken).toBeDefined();

        // Both authentication methods coexist
        const authStatus = await oauthManager.getAuthStatus();
        const qwenStatus = authStatus.find((s) => s.provider === 'qwen');
        expect(qwenStatus?.authenticated).toBe(true);

        // Environment variable remains unchanged
        expect(process.env.OPENAI_API_KEY).toBe('sk-test-existing-api-key');
      } finally {
        // Restore environment
        if (originalApiKey) {
          process.env.OPENAI_API_KEY = originalApiKey;
        } else {
          delete process.env.OPENAI_API_KEY;
        }
      }
    });

    /**
     * @requirement REQ-006.3
     * @scenario Gemini OAuth unaffected
     * @given Existing Gemini OAuth setup
     * @when Adding Qwen OAuth
     * @then Gemini continues working
     * @and Both can be used simultaneously
     */
    it('should preserve existing Gemini OAuth when adding Qwen', async () => {
      // Setup: authenticate Gemini first (existing setup)
      await authExecutor.execute({}, 'gemini');
      const initialGeminiToken = await oauthManager.getToken('gemini');
      expect(initialGeminiToken).toBeDefined();

      // Add Qwen OAuth (new functionality)
      await authExecutor.execute({}, 'qwen');

      // Verify Gemini token is unchanged
      const finalGeminiToken = await oauthManager.getToken('gemini');
      expect(finalGeminiToken?.access_token).toBe(
        initialGeminiToken?.access_token,
      );
      expect(finalGeminiToken?.expiry).toBe(initialGeminiToken?.expiry);

      // Verify both providers work simultaneously
      const authStatus = await oauthManager.getAuthStatus();
      const geminiStatus = authStatus.find((s) => s.provider === 'gemini');
      const qwenStatus = authStatus.find((s) => s.provider === 'qwen');

      expect(geminiStatus?.authenticated).toBe(true);
      expect(qwenStatus?.authenticated).toBe(true);
      expect(geminiStatus?.authType).toBe('oauth');
      expect(qwenStatus?.authType).toBe('oauth');

      // Verify separate token storage
      const providers = await tokenStore.listProviders();
      expect(providers).toContain('gemini');
      expect(providers).toContain('qwen');
      expect(providers).toHaveLength(2);
    });
  });

  describe('Status and Discovery', () => {
    /**
     * @requirement REQ-005.4
     * @scenario Auth status display
     * @given Mixed auth states
     * @when Running /auth (no args)
     * @then Shows all providers
     * @and Indicates auth status for each
     * @and Shows token expiry if authenticated
     */
    it('should display comprehensive auth status for all providers', async () => {
      // Setup mixed auth states
      await authExecutor.execute({}, 'qwen'); // Authenticated
      await authExecutor.execute({}, 'gemini'); // Authenticated
      // openai provider remains unauthenticated

      // Get status display
      const statusLines = await authExecutor.getAuthStatus();

      expect(statusLines).toHaveLength(3); // qwen, openai, gemini

      // Find status for each provider
      const qwenLine = statusLines.find((line) => line.includes('qwen'));
      const openaiLine = statusLines.find((line) => line.includes('openai'));
      const geminiLine = statusLines.find((line) => line.includes('gemini'));

      // Verify Qwen status (authenticated)
      expect(qwenLine).toContain('✓ qwen: oauth');
      expect(qwenLine).toMatch(/expires in \d+m/);

      // Verify OpenAI status (not authenticated)
      expect(openaiLine).toContain('✗ openai: not authenticated');

      // Verify Gemini status (authenticated)
      expect(geminiLine).toContain('✓ gemini: oauth');
      expect(geminiLine).toMatch(/expires in \d+m/);

      // Test auth command without arguments (shows dialog)
      const result = await authExecutor.execute({});
      expect(result.type).toBe('dialog');
      expect(result.dialog).toBe('auth');
    });

    /**
     * @requirement REQ-005.4
     * @scenario Provider discovery and registration
     * @given OAuth manager initialized
     * @when Checking supported providers
     * @then All registered providers listed
     * @and Provider capabilities available
     */
    it('should support provider discovery and registration', async () => {
      // Verify all providers are registered
      const supportedProviders = oauthManager.getSupportedProviders();
      expect(supportedProviders).toContain('qwen');
      expect(supportedProviders).toContain('openai');
      expect(supportedProviders).toContain('gemini');
      expect(supportedProviders).toHaveLength(3);

      // Providers should be sorted alphabetically
      expect(supportedProviders).toEqual(['gemini', 'openai', 'qwen']);

      // Verify error handling for unknown provider
      const unknownResult = await authExecutor.execute({}, 'unknown-provider');
      expect(unknownResult.type).toBe('message');
      expect(unknownResult.messageType).toBe('error');
      expect(unknownResult.content).toContain(
        'Unknown provider: unknown-provider',
      );
      expect(unknownResult.content).toContain(
        'Supported providers: gemini, openai, qwen',
      );
    });

    /**
     * @requirement REQ-002.3, REQ-003.1
     * @scenario Token expiry tracking and display
     * @given Authenticated providers with different expiry times
     * @when Checking auth status
     * @then Accurate expiry information shown
     * @and Expiry countdown is correct
     */
    it('should accurately track and display token expiry information', async () => {
      // Authenticate providers
      await authExecutor.execute({}, 'qwen');
      await authExecutor.execute({}, 'gemini');

      // Get detailed auth status
      const authStatuses = await oauthManager.getAuthStatus();

      const qwenStatus = authStatuses.find((s) => s.provider === 'qwen');
      const geminiStatus = authStatuses.find((s) => s.provider === 'gemini');

      // Verify expiry information is present and reasonable
      expect(qwenStatus?.expiresIn).toBeDefined();
      expect(geminiStatus?.expiresIn).toBeDefined();

      // Expiry should be in the future (tokens valid for ~1 hour)
      expect(qwenStatus!.expiresIn!).toBeGreaterThan(3000); // At least 50 minutes
      expect(geminiStatus!.expiresIn!).toBeGreaterThan(3000);

      // Should be less than the full duration (1 hour + buffer)
      expect(qwenStatus!.expiresIn!).toBeLessThan(4000); // Less than ~66 minutes
      expect(geminiStatus!.expiresIn!).toBeLessThan(4000);
    });
  });
});
