/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GeminiChat } from './geminiChat.js';
import { Config } from '../config/config.js';
import { ContentGenerator } from './contentGenerator.js';
import { HistoryService } from '../services/history/HistoryService.js';
import type { IContent } from '../services/history/IContent.js';
import type {
  GenerateContentResponse,
  PartListUnion,
  Content,
  Part,
} from '@google/genai';
import type { IProviderManager } from '../providers/IProviderManager.js';
import type { IProvider } from '../providers/IProvider.js';

describe('GeminiChat IContent Integration', () => {
  let geminiChat: GeminiChat;
  let mockConfig: Config;
  let mockContentGenerator: ContentGenerator;
  let mockHistoryService: HistoryService;
  let mockProviderManager: IProviderManager;
  let mockProvider: IProvider;

  beforeEach(() => {
    // Setup mocks
    mockProvider = {
      name: 'test-provider',
      generateChatCompletionIContent: vi.fn(),
      // Add other required IProvider methods as needed
      getModels: vi.fn().mockResolvedValue([]),
      setModel: vi.fn(),
      getCurrentModel: vi.fn().mockReturnValue('test-model'),
      setApiKey: vi.fn(),
      isAuthenticated: vi.fn().mockResolvedValue(true),
    } as unknown as IProvider;

    mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      setActiveProvider: vi.fn(),
      clearActiveProvider: vi.fn(),
      getActiveProviderName: vi.fn().mockReturnValue('test-provider'),
      listProviders: vi.fn().mockReturnValue(['test-provider']),
      registerProvider: vi.fn(),
      getAvailableModels: vi.fn().mockResolvedValue([]),
      setConfig: vi.fn(),
      getServerToolsProvider: vi.fn().mockReturnValue(null),
      setServerToolsProvider: vi.fn(),
    } as IProviderManager;

    mockConfig = {
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      getModel: vi.fn().mockReturnValue('test-model'),
      getUserMemory: vi.fn().mockReturnValue(''),
      // Add missing methods that GeminiChat actually uses
      getContentGeneratorConfig: vi.fn().mockReturnValue({
        model: 'test-model',
        authType: 'provider',
      }),
      getProxy: vi.fn().mockReturnValue(undefined),
      getToolRegistry: vi.fn().mockReturnValue({
        getAllTools: vi.fn().mockResolvedValue([]),
      }),
      getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
      setQuotaErrorOccurred: vi.fn(),
      setFallbackMode: vi.fn(),
      setModel: vi.fn(),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    mockContentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
    } as unknown as ContentGenerator;

    mockHistoryService = new HistoryService();

    geminiChat = new GeminiChat(
      mockConfig,
      mockContentGenerator,
      {},
      [],
      mockHistoryService,
    );
  });

  describe('PartListUnion to IContent conversion', () => {
    it('should convert string PartListUnion to IContent', async () => {
      // This test expects a method that doesn't exist yet
      // Method should convert user input (PartListUnion) to IContent for storage in HistoryService
      const input: PartListUnion = 'Hello, world!';

      // Expected behavior: GeminiChat should have a method to convert PartListUnion to IContent
      // This represents a user message
      const result = (
        geminiChat as unknown as {
          convertPartListUnionToIContent: (input: PartListUnion) => IContent;
        }
      ).convertPartListUnionToIContent(input);

      const expected: IContent = {
        speaker: 'human',
        blocks: [
          {
            type: 'text',
            text: 'Hello, world!',
          },
        ],
      };

      expect(result).toEqual(expected);
    });

    it('should convert Part array with function responses to IContent', async () => {
      const input: Part[] = [
        {
          functionResponse: {
            id: 'hist_tool_123', // Should use hist_tool_ prefix
            name: 'test_function',
            response: {
              output: 'Function result',
            },
          },
        },
      ];

      // Expected behavior: convert function response parts to tool response IContent
      // Function responses are from tools, so speaker should be 'tool'
      const result = (
        geminiChat as unknown as {
          convertPartListUnionToIContent: (input: PartListUnion) => IContent;
        }
      ).convertPartListUnionToIContent(input);

      const expected: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'hist_tool_123',
            toolName: 'test_function',
            result: { output: 'Function result' }, // response object should be preserved
            error: undefined,
          },
        ],
      };

      expect(result).toEqual(expected);
    });

    it('should convert mixed Part array to IContent', async () => {
      const input: Part[] = [
        { text: 'Here is some text' },
        {
          functionCall: {
            id: 'hist_tool_456',
            name: 'another_function',
            args: { param: 'value' },
          },
        },
      ];

      // Mixed parts with text and function calls indicate model output
      // Since this has functionCall, it must be from the model (AI)
      const result = (
        geminiChat as unknown as {
          convertPartListUnionToIContent: (input: PartListUnion) => IContent;
        }
      ).convertPartListUnionToIContent(input);

      const expected: IContent = {
        speaker: 'ai', // Function calls come from AI
        blocks: [
          {
            type: 'text',
            text: 'Here is some text',
          },
          {
            type: 'tool_call',
            id: 'hist_tool_456',
            name: 'another_function',
            parameters: { param: 'value' },
          },
        ],
      };

      expect(result).toEqual(expected);
    });
  });

  describe('IContent to GenerateContentResponse conversion', () => {
    it('should convert AI IContent with text to GenerateContentResponse', async () => {
      const input: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'This is the AI response',
          },
        ],
      };

      // Expected behavior: GeminiChat should convert IContent to GenerateContentResponse
      const result = (
        geminiChat as unknown as {
          convertIContentToResponse: (
            input: IContent,
          ) => GenerateContentResponse;
        }
      ).convertIContentToResponse(input);

      const expected = expect.objectContaining({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'This is the AI response' }],
            },
          },
        ],
        text: 'This is the AI response',
      });

      expect(result).toEqual(expected);
    });

    it('should convert AI IContent with tool calls to GenerateContentResponse', async () => {
      const input: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'Let me help you with that.',
          },
          {
            type: 'tool_call',
            id: 'call_789',
            name: 'search_tool',
            parameters: { query: 'test' },
          },
        ],
      };

      const result = (
        geminiChat as unknown as {
          convertIContentToResponse: (
            input: IContent,
          ) => GenerateContentResponse;
        }
      ).convertIContentToResponse(input);

      const expected = expect.objectContaining({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Let me help you with that.' },
                {
                  functionCall: {
                    id: 'call_789',
                    name: 'search_tool',
                    args: { query: 'test' },
                  },
                },
              ],
            },
          },
        ],
        text: 'Let me help you with that.',
      });

      expect(result).toEqual(expected);
    });

    it('should include usage metadata when present in IContent', async () => {
      const input: IContent = {
        speaker: 'ai',
        blocks: [
          {
            type: 'text',
            text: 'Response with usage',
          },
        ],
        metadata: {
          usage: {
            promptTokens: 100,
            completionTokens: 50,
            totalTokens: 150,
          },
        },
      };

      const result = (
        geminiChat as unknown as {
          convertIContentToResponse: (
            input: IContent,
          ) => GenerateContentResponse;
        }
      ).convertIContentToResponse(input);

      const expected = expect.objectContaining({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Response with usage' }],
            },
          },
        ],
        text: 'Response with usage',
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      });

      expect(result).toEqual(expected);
    });
  });

  describe('Provider integration with IContent', () => {
    it("should use provider's generateChatCompletionIContent method when available", async () => {
      // Setup mock provider to return IContent
      const mockIContentResponse: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Provider response' }],
      };

      const mockStream = (async function* () {
        yield mockIContentResponse;
      })();

      mockProvider.generateChatCompletionIContent = vi
        .fn()
        .mockReturnValue(mockStream);

      // When sendMessageStream is called, it should use the provider's IContent method
      const stream = await geminiChat.sendMessageStream(
        { message: 'test input' },
        'test-prompt-id',
      );

      // Collect stream results
      const results: GenerateContentResponse[] = [];
      for await (const chunk of stream) {
        results.push(chunk);
      }

      // Should have called the provider's IContent method
      expect(mockProvider.generateChatCompletionIContent).toHaveBeenCalled();

      // Should have converted IContent to GenerateContentResponse
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].candidates?.[0]?.content?.parts?.[0]).toEqual({
        text: 'Provider response',
      });
    });

    it('should pass history as IContent to provider', async () => {
      // Add some history
      geminiChat.addHistory({
        role: 'user',
        parts: [{ text: 'Previous user message' }],
      } as Content);

      geminiChat.addHistory({
        role: 'model',
        parts: [{ text: 'Previous AI response' }],
      } as Content);

      const mockStream = (async function* () {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'New response' }],
        } as IContent;
      })();

      mockProvider.generateChatCompletionIContent = vi
        .fn()
        .mockReturnValue(mockStream);

      // Send a new message
      const stream = await geminiChat.sendMessageStream(
        { message: 'New message' },
        'test-prompt-id',
      );

      // Consume the stream
      for await (const _chunk of stream) {
        // Just consume
      }

      // Check that provider was called with IContent history
      expect(mockProvider.generateChatCompletionIContent).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: 'Previous user message',
              }),
            ]),
          }),
          expect.objectContaining({
            speaker: 'ai',
            blocks: expect.arrayContaining([
              expect.objectContaining({
                type: 'text',
                text: 'Previous AI response',
              }),
            ]),
          }),
          expect.objectContaining({
            speaker: 'human',
            blocks: expect.arrayContaining([
              expect.objectContaining({ type: 'text', text: 'New message' }),
            ]),
          }),
        ]),
        undefined, // tools parameter (none set in test)
      );
    });
  });

  describe('Provider access patterns', () => {
    it('should get provider from ProviderManager via Config', () => {
      // GeminiChat should be able to access the active provider
      const provider = (
        geminiChat as unknown as {
          getActiveProvider: () => IProvider | undefined;
        }
      ).getActiveProvider();

      expect(mockConfig.getProviderManager).toHaveBeenCalled();
      expect(mockProviderManager.getActiveProvider).toHaveBeenCalled();
      expect(provider).toBe(mockProvider);
    });

    it('should handle case when no provider manager is available', () => {
      // When config doesn't have a provider manager, should fall back to content generator
      mockConfig.getProviderManager = vi.fn().mockReturnValue(undefined);

      const newGeminiChat = new GeminiChat(
        mockConfig,
        mockContentGenerator,
        {},
        [],
        mockHistoryService,
      );

      // Should fall back to using contentGenerator
      const provider = (
        newGeminiChat as unknown as {
          getActiveProvider: () => IProvider | undefined;
        }
      ).getActiveProvider();
      expect(provider).toBeUndefined();
    });

    it('should detect when provider supports IContent interface', () => {
      // Provider with generateChatCompletionIContent method
      mockProvider.generateChatCompletionIContent = vi.fn();

      const supportsIContent = (
        geminiChat as unknown as {
          providerSupportsIContent: (
            provider: IProvider | undefined,
          ) => boolean;
        }
      ).providerSupportsIContent(mockProvider);
      expect(supportsIContent).toBe(true);

      // Provider without the method
      delete (mockProvider as { generateChatCompletionIContent?: unknown })
        .generateChatCompletionIContent;

      const supportsIContent2 = (
        geminiChat as unknown as {
          providerSupportsIContent: (
            provider: IProvider | undefined,
          ) => boolean;
        }
      ).providerSupportsIContent(mockProvider);
      expect(supportsIContent2).toBe(false);
    });
  });
});
