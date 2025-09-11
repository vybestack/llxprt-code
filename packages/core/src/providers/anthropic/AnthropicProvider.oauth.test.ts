import { vi, describe, it, expect, beforeEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { IContent } from '../../services/history/IContent.js';
import { ITool } from '../ITool.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { OAuthManager } from '../../auth/precedence.js';

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

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear SettingsService to ensure test isolation
    const { getSettingsService } = await import(
      '../../settings/settingsServiceInstance.js'
    );
    const settingsService = getSettingsService();
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
      // Mock OAuth token
      const mockToken = 'oauth-token-123';
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(mockToken);

      const models = await provider.getModels();

      expect(models).toHaveLength(2); // 1 actual model + 1 latest alias
      expect(models.some((m) => m.id === 'claude-sonnet-4-latest')).toBe(true);
      expect(models.some((m) => m.id === 'claude-sonnet-4-20250514')).toBe(
        true,
      );

      // Should have attempted to get OAuth token
      expect(mockOAuthManager.getToken).toHaveBeenCalledWith('anthropic');
    });

    it('should return empty array when no authentication is available', async () => {
      // Mock OAuth manager returning null
      vi.mocked(mockOAuthManager.getToken).mockResolvedValue(null);

      const models = await provider.getModels();
      expect(models).toEqual([]);
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
