/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseProvider, BaseProviderConfig } from './BaseProvider.js';
import { OAuthManager } from '../auth/precedence.js';
import { IModel } from './IModel.js';
import { IMessage } from './IMessage.js';
import { ITool } from './ITool.js';
import { ContentGeneratorRole } from './ContentGeneratorRole.js';

// Mock OAuth manager for testing
const mockOAuthManager: OAuthManager = {
  getToken: vi.fn(),
  isAuthenticated: vi.fn(),
};

// Concrete implementation of BaseProvider for testing
class TestProvider extends BaseProvider {
  constructor(config: BaseProviderConfig) {
    super(config);
  }

  protected supportsOAuth(): boolean {
    return true;
  }

  async getModels(): Promise<IModel[]> {
    return [
      {
        id: 'test-model',
        name: 'Test Model',
        provider: 'test',
        supportedToolFormats: [],
      },
    ];
  }

  async *generateChatCompletion(
    _messages: IMessage[],
    _tools?: ITool[],
    _toolFormat?: string,
  ): AsyncIterableIterator<unknown> {
    // Use the base auth token to ensure it's resolved
    const token = await this.getAuthToken();
    yield {
      role: 'assistant',
      content: `Response using token: ${token.substring(0, 10)}...`,
    };
  }
}

// Non-OAuth provider for testing
class NonOAuthTestProvider extends BaseProvider {
  protected supportsOAuth(): boolean {
    return false;
  }

  async getModels(): Promise<IModel[]> {
    return [];
  }

  async *generateChatCompletion(
    _messages: IMessage[],
    _tools?: ITool[],
  ): AsyncIterableIterator<unknown> {
    const token = await this.getAuthToken();
    yield { role: 'assistant', content: `Non-OAuth response: ${token}` };
  }
}

describe('BaseProvider', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear test environment variables
    delete process.env.TEST_API_KEY;
    delete process.env.ANOTHER_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Authentication Precedence', () => {
    it('should prioritize command key over all other methods', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        commandKey: 'command-key-123',
        cliKey: 'cli-key-456',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      const provider = new TestProvider(config);

      // When: Generate chat completion (triggers lazy auth)
      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      // Then: Should use command key
      expect(response.value).toMatchObject({
        content: expect.stringContaining('command-ke'),
      });
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to CLI key when no command key', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'cli-key-456',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      const provider = new TestProvider(config);

      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('cli-key-45'),
      });
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to environment variable', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      process.env.TEST_API_KEY = 'env-key-789';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      const provider = new TestProvider(config);

      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('env-key-78'),
      });
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to OAuth when enabled and no other auth available', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      // No environment variables set
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-abc');

      const provider = new TestProvider(config);

      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('oauth-toke'),
      });
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('test');
    });

    it('should throw error when no authentication available', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false, // OAuth disabled
        oauthProvider: 'test',
      };

      // No environment variables set
      const provider = new TestProvider(config);

      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow(
        'No API key found and OAuth is available but not authenticated for test provider',
      );
    });
  });

  describe('OAuth Support Validation', () => {
    it('should not attempt OAuth when provider does not support it', async () => {
      const config: BaseProviderConfig = {
        name: 'non-oauth-test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true, // Enabled but provider doesn't support it
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      const provider = new NonOAuthTestProvider(config);

      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow('No authentication method available');

      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should provide helpful error message when OAuth is only available option', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        // No OAuth manager provided
      };

      const provider = new TestProvider(config);

      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow(
        'No API key found and OAuth is available but not authenticated for test provider',
      );
    });
  });

  describe('Lazy OAuth Triggering', () => {
    it('should only trigger OAuth when making API calls, not during initialization', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      // When: Initialize provider
      const provider = new TestProvider(config);

      // Then: OAuth should not be called during initialization
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();

      // When: Make API call
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      // Then: OAuth should be called
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('test');
    });

    it('should cache auth token to avoid repeated OAuth calls', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      const provider = new TestProvider(config);

      // When: Make multiple API calls
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 1' },
        ])
        .next();
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 2' },
        ])
        .next();

      // Then: OAuth should be called once and cached for the second call
      expect(mockOAuthManager.getToken).toHaveBeenCalledTimes(1); // Called once, cached for second call
    });

    it('should re-resolve auth after cache expires', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      // Mock Date.now to control cache expiration
      const originalNow = Date.now;
      let mockTime = 1000;
      vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

      const provider = new TestProvider(config);

      // First call
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 1' },
        ])
        .next();

      // Advance time beyond cache duration (1 minute)
      mockTime += 61000;

      // Second call after cache expiry
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 2' },
        ])
        .next();

      expect(mockOAuthManager.getToken).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = originalNow;
    });
  });

  describe('Utility Methods', () => {
    it('should correctly identify when non-OAuth auth is available', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'cli-key-456',
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      const provider = new TestProvider(config);

      const hasNonOAuth = await provider.hasNonOAuthAuthentication();
      expect(hasNonOAuth).toBe(true);
    });

    it('should correctly identify OAuth-only scenarios', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      // No environment variables set
      const provider = new TestProvider(config);

      const isOAuthOnly = await provider.isOAuthOnlyAvailable();
      expect(isOAuthOnly).toBe(true);
    });

    it('should get correct auth method name', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'cli-key-456',
      };

      const provider = new TestProvider(config);

      const methodName = await provider.getAuthMethodName();
      expect(methodName).toBe('cli-key');
    });

    it('should check authentication status correctly', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'cli-key-456',
      };

      const provider = new TestProvider(config);

      const isAuthenticated = await provider.isAuthenticated();
      expect(isAuthenticated).toBe(true);
    });
  });

  describe('Configuration Updates', () => {
    it('should update API key correctly', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'old-key',
      };

      const provider = new TestProvider(config);

      // When: Update API key
      provider.setApiKey?.('new-key');

      // Then: Should use new key
      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('new-key'),
      });
    });

    it('should clear auth cache when API key is updated', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken)
        .mockResolvedValueOnce('oauth-token-1')
        .mockResolvedValueOnce('oauth-token-2');

      const provider = new TestProvider(config);

      // First call uses OAuth
      await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 1' },
        ])
        .next();

      // Update to use API key
      provider.setApiKey?.('new-api-key');

      // Second call should use new API key, not cached OAuth
      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test 2' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('new-api-ke'),
      });
    });

    it('should update OAuth configuration correctly', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false,
        oauthProvider: 'test',
      };

      const provider = new TestProvider(config);

      // Initially should fail due to no auth
      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow();

      // Enable OAuth
      (
        provider as unknown as {
          updateOAuthConfig: (
            enabled: boolean,
            provider: string,
            manager: OAuthManager,
          ) => void;
        }
      ).updateOAuthConfig(true, 'test', mockOAuthManager);
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token');

      // Should now work with OAuth
      const response = await provider
        .generateChatCompletion([
          { role: ContentGeneratorRole.USER, content: 'test' },
        ])
        .next();

      expect(response.value).toMatchObject({
        content: expect.stringContaining('oauth-toke'),
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle OAuth errors gracefully', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        oauthManager: mockOAuthManager,
      };

      vi.mocked(mockOAuthManager.getToken).mockRejectedValue(
        new Error('OAuth failed'),
      );

      const provider = new TestProvider(config);

      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow(
        'No API key found and OAuth is available but not authenticated for test provider',
      );
    });

    it('should handle missing OAuth provider gracefully', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        // No oauthProvider specified
        oauthManager: mockOAuthManager,
      };

      const provider = new TestProvider(config);

      await expect(
        provider
          .generateChatCompletion([
            { role: ContentGeneratorRole.USER, content: 'test' },
          ])
          .next(),
      ).rejects.toThrow(
        'No API key found and OAuth is available but not authenticated for test provider',
      );

      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('Default Implementations', () => {
    it('should provide default implementations for optional methods', () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'test-key',
      };

      const provider = new TestProvider(config);

      // These should not throw
      expect(provider.setModel?.('new-model')).toBeUndefined();
      expect(provider.getCurrentModel?.()).toBe('default');
      expect(provider.getToolFormat?.()).toBe('default');
      expect(provider.setToolFormatOverride?.(null)).toBeUndefined();
      expect(provider.isPaidMode?.()).toBe(false);
      expect(provider.clearState?.()).toBeUndefined();
      expect(provider.setConfig?.({})).toBeUndefined();
      expect(provider.getServerTools()).toEqual([]);
      expect(provider.setModelParams?.(undefined)).toBeUndefined();
      expect(provider.getModelParams?.()).toBeUndefined();
    });

    it('should throw error for unsupported server tools', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        cliKey: 'test-key',
      };

      const provider = new TestProvider(config);

      await expect(
        provider.invokeServerTool('unsupported-tool', {}),
      ).rejects.toThrow(
        "Server tool 'unsupported-tool' not supported by test provider",
      );
    });
  });
});
