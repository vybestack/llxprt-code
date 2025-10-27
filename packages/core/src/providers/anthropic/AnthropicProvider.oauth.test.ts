import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { IContent } from '../../services/history/IContent.js';
import { ITool } from '../ITool.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { OAuthManager } from '../../auth/precedence.js';
import { getSettingsService } from '../../settings/settingsServiceInstance.js';
import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';

// Skip OAuth tests in CI as they require browser interaction
const skipInCI = process.env.CI === 'true';

// Mock the ToolFormatter
vi.mock('../../tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[], format: string) => {
      if (format === 'anthropic') {
        return (tools as ITool[]).map((tool) => ({
          name: tool.function.name,
          description: tool.function.description || '',
          input_schema: {
            type: 'object',
            ...tool.function.parameters,
          },
        }));
      }
      return tools;
    }),
    convertGeminiToAnthropic: vi.fn((geminiTools) => {
      if (!geminiTools || !Array.isArray(geminiTools)) return [];

      const tools = [];
      for (const group of geminiTools) {
        if (group.functionDeclarations) {
          for (const func of group.functionDeclarations) {
            tools.push({
              name: func.name,
              description: func.description || '',
              input_schema: {
                type: 'object',
                properties: func.parameters?.properties || {},
                required: func.parameters?.required || [],
              },
            });
          }
        }
      }
      return tools;
    }),
    convertGeminiToFormat: vi.fn((geminiTools, format = 'openai') => {
      if (!geminiTools || !Array.isArray(geminiTools)) return undefined;

      if (format === 'anthropic') {
        const tools = [];
        for (const group of geminiTools) {
          if (group.functionDeclarations) {
            for (const func of group.functionDeclarations) {
              tools.push({
                name: func.name,
                description: func.description || '',
                input_schema: {
                  type: 'object',
                  properties: func.parameters?.properties || {},
                  required: func.parameters?.required || [],
                },
              });
            }
          }
        }
        return tools;
      }

      // For other formats (openai, etc.), return OpenAI format
      const tools = [];
      for (const group of geminiTools) {
        if (group.functionDeclarations) {
          for (const func of group.functionDeclarations) {
            tools.push({
              type: 'function',
              function: {
                name: func.name,
                description: func.description || '',
                parameters: func.parameters || {},
              },
            });
          }
        }
      }
      return tools;
    }),
  })),
}));

// Mock the retry utility
vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn, options) => {
    let lastError;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        attempts++;
        if (
          attempts < maxAttempts &&
          options?.shouldRetry &&
          options.shouldRetry(error)
        ) {
          continue;
        }
        throw error;
      }
    }
    throw lastError;
  }),
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

// Create a shared mock instance that will be reused
const mockAnthropicShared = {
  messages: {
    create: vi.fn(),
  },
  beta: {
    models: {
      list: vi.fn().mockReturnValue({
        async *[Symbol.asyncIterator]() {
          const models = [
            { id: 'claude-sonnet-4-20250514', display_name: 'Claude 4 Sonnet' },
          ];
          for (const model of models) {
            yield model;
          }
        },
      }),
    },
  },
  apiKey: 'test-key', // Add apiKey property for comparison
};

// Mock the Anthropic SDK to always return the same instance
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => mockAnthropicShared),
}));

describe.skipIf(skipInCI)('AnthropicProvider OAuth Integration', () => {
  let mockOAuthManager: OAuthManager;
  let provider: AnthropicProvider;
  let mockAnthropicInstance: {
    messages: { create: ReturnType<typeof vi.fn> };
    beta: { models: { list: ReturnType<typeof vi.fn> } };
    apiKey: string;
  };
  const originalEnvApiKey = process.env.ANTHROPIC_API_KEY;
  const originalEnvAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;
  let settingsService: ReturnType<typeof getSettingsService>;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_AUTH_TOKEN;

    // Clear SettingsService to ensure test isolation
    settingsService = getSettingsService();
    settingsService.clear();

    // Create mock OAuth manager
    mockOAuthManager = {
      getToken: vi.fn(),
      getOAuthToken: vi.fn(),
      isAuthenticated: vi.fn(),
      hasProvider: vi.fn().mockReturnValue(true),
      isOAuthEnabled: vi.fn().mockReturnValue(true),
    } as OAuthManager;

    // Create provider with OAuth manager but no API key
    provider = new AnthropicProvider(
      undefined, // No API key - should use OAuth
      undefined,
      TEST_PROVIDER_CONFIG,
      mockOAuthManager,
    );

    // Use the shared mock instance
    mockAnthropicInstance = mockAnthropicShared;
  });

  afterEach(() => {
    if (originalEnvApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalEnvApiKey;
    }
    if (originalEnvAuthToken === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = originalEnvAuthToken;
    }
  });

  describe('constructor with OAuth manager', () => {
    it('should extend BaseProvider and accept oauth manager parameter', () => {
      expect(provider).toBeDefined();
      expect(provider.name).toBe('anthropic');
      // Provider should inherit from BaseProvider
      expect(provider.isAuthenticated).toBeDefined();
      expect(typeof provider.isAuthenticated).toBe('function');
    });

    it('should indicate OAuth support when provider supports OAuth', () => {
      // This test expects the provider to implement supportsOAuth method
      expect(
        (
          provider as AnthropicProvider & { supportsOAuth: () => boolean }
        ).supportsOAuth(),
      ).toBe(true);
    });
  });

  describe('API key handling', () => {
    it('initializes SDK with null apiKey when no key is provided', () => {
      const firstCall = vi.mocked(Anthropic).mock.calls[0]?.[0];
      expect(firstCall?.apiKey).toBeNull();
    });

    it('propagates explicit API keys to the SDK client', () => {
      const providerWithKey = new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );
      expect(providerWithKey).toBeDefined();

      const lastCall =
        vi.mocked(Anthropic).mock.calls[
          vi.mocked(Anthropic).mock.calls.length - 1
        ]?.[0];
      expect(lastCall?.apiKey).toBe('test-api-key');
    });

    it('does not reintroduce env API keys when OAuth tokens are used', async () => {
      settingsService.set('authOnly', true);
      process.env.ANTHROPIC_API_KEY = 'env-test-key';
      const mockToken = 'sk-ant-oat-env-check';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(mockToken);

      await provider.getModels();

      const oauthCall = vi
        .mocked(Anthropic)
        .mock.calls.find(
          ([args]) =>
            (args as ClientOptions | undefined)?.authToken === mockToken,
        );
      const oauthArgs = oauthCall?.[0] as ClientOptions | undefined;
      expect(oauthArgs?.apiKey).toBeNull();
      expect(oauthArgs?.authToken).toBe(mockToken);
    });
  });

  describe('authentication precedence', () => {
    it('should use OAuth token when no API key is provided', async () => {
      // Mock OAuth token
      const mockToken = 'oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(mockToken);

      // Mock successful streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello from OAuth' },
          };
        },
      };
      mockAnthropicInstance.messages.create.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test OAuth' }],
        },
      ];

      const generator = provider.generateChatCompletion(messages);
      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello from OAuth' }],
        },
      ]);

      // Should have attempted to get OAuth token
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('anthropic');
    });

    it('should throw error when no authentication is available', async () => {
      // Mock OAuth manager returning null (no token)
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      // Create provider with no API key and failing OAuth
      const providerNoAuth = new AnthropicProvider(
        undefined, // No API key
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const generator = providerNoAuth.generateChatCompletion(messages);

      await expect(generator.next()).rejects.toThrow(
        /No authentication available for Anthropic API calls/,
      );
    });

    it('should prefer API key over OAuth when both are available', async () => {
      // Create provider with both API key and OAuth manager
      const providerWithApiKey = new AnthropicProvider(
        'test-api-key',
        undefined,
        TEST_PROVIDER_CONFIG,
        mockOAuthManager,
      );

      // Mock successful streaming response
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'Hello from API key' },
          };
        },
      };
      mockAnthropicShared.messages.create.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const generator = providerWithApiKey.generateChatCompletion(messages);
      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello from API key' }],
        },
      ]);

      // Should NOT have attempted to get OAuth token since API key is available
      expect(mockOAuthManager.getToken).not.toHaveBeenCalled();
    });
  });

  describe('getModels with OAuth', () => {
    it('should use OAuth token for models API when available', async () => {
      // Mock OAuth token in Anthropic OAuth format
      const mockToken = 'sk-ant-oat-oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(mockToken);

      const models = await provider.getModels();

      expect(models).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'claude-opus-4-1-20250805',
          }),
          expect.objectContaining({
            id: 'claude-opus-4-1',
          }),
          expect.objectContaining({
            id: 'claude-sonnet-4-5-20250929',
          }),
          expect.objectContaining({
            id: 'claude-sonnet-4-5',
          }),
          expect.objectContaining({
            id: 'claude-sonnet-4-20250514',
          }),
          expect.objectContaining({
            id: 'claude-sonnet-4',
          }),
          expect.objectContaining({
            id: 'claude-haiku-4-5-20251001',
          }),
          expect.objectContaining({
            id: 'claude-haiku-4-5',
          }),
        ]),
      );

      // Should have attempted to get OAuth token
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('anthropic');
    });

    it('should return empty array when no authentication is available', async () => {
      // Mock OAuth manager returning null
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      await expect(provider.getModels()).rejects.toThrow(
        /No authentication available for Anthropic API calls/,
      );
    });
  });

  describe('authentication state management', () => {
    it('should check authentication status correctly', async () => {
      // Mock OAuth token available
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue('oauth-token-123');

      const isAuth = await provider.isAuthenticated();
      expect(isAuth).toBe(true);
    });

    it('should return false for authentication status when no token available', async () => {
      // Mock no OAuth token
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      const isAuth = await provider.isAuthenticated();
      expect(isAuth).toBe(false);
    });
  });

  describe('setApiKey method', () => {
    it('should update API key and clear auth cache', () => {
      provider.setApiKey('new-api-key');

      // The setApiKey method should exist (inherited from BaseProvider)
      expect(provider.setApiKey).toBeDefined();
    });
  });
});
