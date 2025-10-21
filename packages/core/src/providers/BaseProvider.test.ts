/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BaseProvider,
  BaseProviderConfig,
  NormalizedGenerateChatOptions,
} from './BaseProvider.js';
import {
  OAuthManager,
  type OAuthTokenRequestMetadata,
} from '../auth/precedence.js';
import { IModel } from './IModel.js';
import { IContent, TextBlock } from '../services/history/IContent.js';
import type { Config } from '../config/config.js';
import { SettingsService } from '../settings/SettingsService.js';
import {
  getSettingsService,
  resetSettingsService,
} from '../settings/settingsServiceInstance.js';

// Mock OAuth manager for testing
const mockOAuthManager: OAuthManager = {
  getToken: vi.fn<
    [string, OAuthTokenRequestMetadata | undefined],
    Promise<string | null>
  >(),
  isAuthenticated: vi.fn(),
};

const userMessage = (text: string): IContent => ({
  speaker: 'human',
  blocks: [
    {
      type: 'text',
      text,
    },
  ],
});

const getContentText = (content: IContent | undefined): string => {
  const textBlock = content?.blocks.find(
    (block): block is TextBlock => block.type === 'text',
  );
  return textBlock?.text ?? '';
};

// Concrete implementation of BaseProvider for testing
class TestProvider extends BaseProvider {
  lastOptions?: NormalizedGenerateChatOptions;

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

  getDefaultModel(): string {
    return 'claude-sonnet-4-20250514';
  }

  protected override async *generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    this.lastOptions = options;
    const token = await this.getAuthToken();
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: `Response using token: ${token.substring(0, 10)}...`,
        },
      ],
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

  getDefaultModel(): string {
    return 'claude-sonnet-4-20250514';
  }

  protected override async *generateChatCompletionWithOptions(
    _options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    const token = await this.getAuthToken();
    yield {
      speaker: 'ai',
      blocks: [
        {
          type: 'text',
          text: `Non-OAuth response: ${token}`,
        },
      ],
    };
  }
}

describe('BaseProvider', () => {
  let originalEnv: NodeJS.ProcessEnv;

  // @plan:PLAN-20251018-STATELESSPROVIDER2.P04 @requirement:REQ-SP2-001
  // NOTE: Stateless contract coverage will migrate into baseProvider.stateless.stub.test.ts.

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = { ...process.env };
    // Clear test environment variables
    delete process.env.TEST_API_KEY;
    delete process.env.ANOTHER_API_KEY;
    // Reset settings service to ensure clean state
    resetSettingsService();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('Authentication Precedence', () => {
    it('should prioritize SettingsService auth-key over all other methods', async () => {
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-auth-key-123');

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

      // When: Generate chat completion (triggers lazy auth)
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      // Then: Should use SettingsService auth-key
      expect(getContentText(response.value as IContent)).toContain(
        'settings-a',
      );
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should fall back to environment variable when no SettingsService auth', async () => {
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
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'env-key-78',
      );
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
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'oauth-toke',
      );
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'test',
        expect.anything(),
      );
    });

    it('should return empty string when no authentication available', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false, // OAuth disabled
        oauthProvider: 'test',
      };

      // No environment variables set
      const provider = new TestProvider(config);

      // BaseProvider now returns empty string for no auth (local endpoints)
      // Access protected method through type assertion
      const authToken = await (
        provider as unknown as { getAuthToken(): Promise<string> }
      ).getAuthToken();
      expect(authToken).toBe('');
    });
  });

  describe('Signature Normalization', () => {
    it('normalizes legacy arguments into GenerateChatOptions', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
      };

      const provider = new TestProvider(config);
      const defaultSettings = getSettingsService();
      const messages = [userMessage('legacy signature test')];

      await provider.generateChatCompletion(messages).next();

      expect(provider.lastOptions?.contents).toEqual(messages);
      expect(provider.lastOptions?.tools).toBeUndefined();
      expect(provider.lastOptions?.settings).toBe(defaultSettings);
    });

    it('passes explicit options including settings and config to implementation', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
      };

      const provider = new TestProvider(config);
      const customSettings = new SettingsService();
      customSettings.set('auth-key', 'custom-auth-xyz');
      const fakeConfig = {
        getUserMemory: () => 'test-memory',
        getModel: () => 'test-model',
      } as unknown as Config;

      const options = {
        contents: [userMessage('options signature test')],
        settings: customSettings,
        config: fakeConfig,
        metadata: { requestId: 'req-123' },
      } satisfies Parameters<TestProvider['generateChatCompletion']>[0];

      const result = await provider.generateChatCompletion(options).next();

      expect(provider.lastOptions?.settings).toBe(customSettings);
      expect(provider.lastOptions?.config).toBe(fakeConfig);
      expect(provider.lastOptions?.metadata).toMatchObject({
        requestId: 'req-123',
      });
      expect(getContentText(result.value as IContent)).toContain('custom-aut');
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

      // Should succeed with empty token when no auth is available
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'Non-OAuth response:',
      );

      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });

    it('should succeed when OAuth is configured but not available', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: true,
        oauthProvider: 'test',
        // No OAuth manager provided
      };

      const provider = new TestProvider(config);

      // Should succeed with empty token when no auth is available
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'Response using token:',
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
      await provider.generateChatCompletion([userMessage('test')]).next();

      // Then: OAuth should be called
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith(
        'test',
        expect.anything(),
      );
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
      await provider.generateChatCompletion([userMessage('test 1')]).next();
      await provider.generateChatCompletion([userMessage('test 2')]).next();

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
      await provider.generateChatCompletion([userMessage('test 1')]).next();

      // Advance time beyond cache duration (1 minute)
      mockTime += 61000;

      // Second call after cache expiry
      await provider.generateChatCompletion([userMessage('test 2')]).next();

      expect(mockOAuthManager.getToken).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = originalNow;
    });
  });

  describe('Utility Methods', () => {
    it('should correctly identify when non-OAuth auth is available', async () => {
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-key-456');

      const config: BaseProviderConfig = {
        name: 'test',
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
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-key-456');

      const config: BaseProviderConfig = {
        name: 'test',
      };

      const provider = new TestProvider(config);

      const methodName = await provider.getAuthMethodName();
      expect(methodName).toBe('command-key');
    });

    it('should check authentication status correctly', async () => {
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'settings-key-456');

      const config: BaseProviderConfig = {
        name: 'test',
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
      const settingsService = getSettingsService();

      // When: Update API key through SettingsService
      settingsService.set('auth-key', 'new-key');
      provider.clearAuthCache?.();

      // Then: Should use new key
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain('new-key');
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
      await provider.generateChatCompletion([userMessage('test 1')]).next();

      // Update to use API key via SettingsService
      const settingsService = getSettingsService();
      settingsService.set('auth-key', 'new-api-key');
      provider.clearAuthCache?.();

      // Second call should use new API key, not cached OAuth
      const response = await provider
        .generateChatCompletion([userMessage('test 2')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'new-api-ke',
      );
    });

    it('should update OAuth configuration correctly', async () => {
      const config: BaseProviderConfig = {
        name: 'test',
        envKeyNames: ['TEST_API_KEY'],
        isOAuthEnabled: false,
        oauthProvider: 'test',
      };

      const provider = new TestProvider(config);

      // Initially should succeed with empty token
      const response1 = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response1.value as IContent)).toContain(
        'Response using token:',
      );

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
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'oauth-toke',
      );
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

      // Should succeed with empty token when OAuth is unavailable
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'Response using token:',
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

      // Should succeed with empty token when OAuth is unavailable
      const response = await provider
        .generateChatCompletion([userMessage('test')])
        .next();

      expect(getContentText(response.value as IContent)).toContain(
        'Response using token:',
      );

      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('Server Tools', () => {
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
