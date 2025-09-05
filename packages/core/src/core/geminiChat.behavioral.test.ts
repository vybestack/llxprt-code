/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for GeminiChat to verify current functionality
 * before refactoring to use HistoryService
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { GeminiChat } from './geminiChat.js';
import { ContentGenerator, AuthType } from './contentGenerator.js';
import { Config } from '../config/config.js';
import { Content, GenerateContentResponse, Part, Tool } from '@google/genai';

// Mock dependencies
vi.mock('../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../telemetry/loggers.js', () => ({
  logApiRequest: vi.fn(),
  logApiResponse: vi.fn(),
  logApiError: vi.fn(),
}));

vi.mock('../utils/messageInspectors.js', () => ({
  isFunctionResponse: vi.fn(
    (content: Content) =>
      content.parts?.some((part) => 'functionResponse' in part) ?? false,
  ),
}));

vi.mock('../utils/quotaErrorDetection.js', () => ({
  isStructuredError: vi.fn(() => false),
}));

vi.mock('../tools/tools.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    hasCycleInSchema: vi.fn(() => false),
  };
});

describe('GeminiChat - Behavioral Tests for HistoryService Migration', () => {
  let config: Config;
  let contentGenerator: ContentGenerator;
  let chat: GeminiChat;
  let mockToolRegistry: {
    getAllTools: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock tool registry
    mockToolRegistry = {
      getAllTools: vi.fn().mockReturnValue([]),
    };

    // Mock provider that supports IContent
    const mockProvider = {
      name: 'mock-provider',
      generateChatCompletionIContent: vi
        .fn()
        .mockImplementation(async function* (_content) {
          // Default mock implementation - tests can override
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: "I'm doing well, thank you!" }],
          };
        }),
    };

    // Mock ProviderManager
    const mockProviderManager = {
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
    };

    // Mock Config
    config = {
      getModel: vi.fn().mockReturnValue('gemini-2.0-flash'),
      setModel: vi.fn(),
      setFallbackMode: vi.fn(),
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue({ authType: AuthType.USE_GEMINI }),
      getProxy: vi.fn(),
      getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
      getToolRegistry: vi.fn().mockResolvedValue(mockToolRegistry),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getProviderManager: vi.fn().mockReturnValue(mockProviderManager),
      flashFallbackHandler: undefined,
    } as unknown as Config;

    // Mock ContentGenerator
    contentGenerator = {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn(),
      embedContent: vi.fn(),
    } as unknown as ContentGenerator;

    // Create chat instance
    chat = new GeminiChat(config, contentGenerator);
  });

  describe('Basic Message Flow - Critical for HistoryService', () => {
    it('should handle simple user message and AI response', async () => {
      const userMessage = 'Hello, how are you?';
      const aiResponse = "I'm doing well, thank you!";

      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: aiResponse }],
            },
          },
        ],
        usageMetadata: {
          promptTokens: 10,
          candidatesTokens: 20,
          totalTokens: 30,
        },
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        mockResponse,
      );

      const response = await chat.sendMessage(
        { message: userMessage },
        'test-prompt-id',
      );

      // Verify API was called correctly
      expect(contentGenerator.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gemini-2.0-flash',
          contents: [
            {
              role: 'user',
              parts: [{ text: userMessage }],
            },
          ],
        }),
        'test-prompt-id',
      );

      // Verify response
      expect(response).toEqual(mockResponse);

      // Verify history was updated - this is what we'll replace with HistoryService
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual({
        role: 'user',
        parts: [{ text: userMessage }],
      });
      expect(history[1]).toEqual({
        role: 'model',
        parts: [{ text: aiResponse }],
      });
    });

    it('should handle conversation with multiple turns', async () => {
      // First turn
      const firstUserMessage = 'What is 2 + 2?';
      const firstAiResponse = '2 + 2 equals 4.';

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: firstAiResponse }],
            },
          },
        ],
      });

      await chat.sendMessage({ message: firstUserMessage }, 'prompt-1');

      // Second turn - should include previous history
      const secondUserMessage = 'What about 3 + 3?';
      const secondAiResponse = '3 + 3 equals 6.';

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: secondAiResponse }],
            },
          },
        ],
      });

      await chat.sendMessage({ message: secondUserMessage }, 'prompt-2');

      // Verify the second API call includes full history
      expect(contentGenerator.generateContent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          contents: [
            { role: 'user', parts: [{ text: firstUserMessage }] },
            { role: 'model', parts: [{ text: firstAiResponse }] },
            { role: 'user', parts: [{ text: secondUserMessage }] },
          ],
        }),
        'prompt-2',
      );

      // Verify history contains all turns
      const history = chat.getHistory();
      expect(history).toHaveLength(4);
    });
  });

  describe('Tool Call Flow - Critical for HistoryService', () => {
    it('should handle tool calls and responses', async () => {
      // User asks for weather
      const userMessage = "What's the weather in NYC?";

      // AI makes a tool call
      const toolCallResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: "I'll check the weather for you." },
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'NYC' },
                  },
                },
              ],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        toolCallResponse,
      );

      await chat.sendMessage({ message: userMessage }, 'prompt-1');

      // Send tool response
      const toolResponse: Part[] = [
        {
          functionResponse: {
            name: 'get_weather',
            response: { temperature: 72, condition: 'Sunny' },
          },
        },
      ];

      const finalResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'The weather in NYC is currently 72°F and sunny.' },
              ],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        finalResponse,
      );

      await chat.sendMessage({ message: toolResponse }, 'prompt-2');

      // Verify history maintains the correct structure
      const history = chat.getHistory();
      expect(history).toHaveLength(4);

      // User message
      expect(history[0].role).toBe('user');
      expect(history[0].parts[0]).toMatchObject({ text: userMessage });

      // AI with tool call
      expect(history[1].role).toBe('model');
      expect(history[1].parts).toHaveLength(2);
      expect(history[1].parts[0]).toMatchObject({
        text: "I'll check the weather for you.",
      });
      expect(history[1].parts[1]).toMatchObject({
        functionCall: { name: 'get_weather' },
      });

      // Tool response
      expect(history[2].role).toBe('user');
      expect(history[2].parts[0]).toMatchObject({
        functionResponse: { name: 'get_weather' },
      });

      // Final AI response
      expect(history[3].role).toBe('model');
      expect(history[3].parts[0]).toMatchObject({
        text: 'The weather in NYC is currently 72°F and sunny.',
      });
    });

    it('should handle multiple parallel tool calls correctly', async () => {
      const userMessage = 'What is the weather in NYC and London?';

      // AI makes parallel tool calls
      const parallelToolCalls: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: "I'll check the weather in both cities." },
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'NYC' },
                  },
                },
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'London' },
                  },
                },
              ],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        parallelToolCalls,
      );

      await chat.sendMessage({ message: userMessage }, 'prompt-1');

      // Send multiple tool responses - this tests the function response array handling
      const toolResponses: Part[] = [
        {
          functionResponse: {
            name: 'get_weather',
            response: { temperature: 72, condition: 'Sunny' },
          },
        },
        {
          functionResponse: {
            name: 'get_weather',
            response: { temperature: 15, condition: 'Rainy' },
          },
        },
      ];

      const finalResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  text: 'NYC: 72°F and sunny. London: 15°C and rainy.',
                },
              ],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        finalResponse,
      );

      await chat.sendMessage({ message: toolResponses }, 'prompt-2');

      // Verify API was called with properly formatted tool responses
      const lastCall = (
        contentGenerator.generateContent as Mock
      ).mock.calls.slice(-1)[0];
      expect(lastCall[1]).toBe('prompt-2');
      const contents = lastCall[0].contents;
      const lastContent = contents[contents.length - 1];
      expect(lastContent.role).toBe('user');
      expect(lastContent.parts).toHaveLength(2);
      expect(lastContent.parts[0]).toMatchObject({
        functionResponse: { name: 'get_weather' },
      });
      expect(lastContent.parts[1]).toMatchObject({
        functionResponse: { name: 'get_weather' },
      });

      // Verify history structure
      const history = chat.getHistory();
      expect(history).toHaveLength(4);
      expect(history[2].parts).toHaveLength(2); // Both tool responses
    });
  });

  describe('Streaming - Critical for HistoryService', () => {
    it('should handle streaming responses and accumulate history', async () => {
      const userMessage = 'Tell me a story';

      // Mock streaming response
      async function* mockStream(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Once upon a time' }],
              },
            },
          ],
        };
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: ', there was a' }],
              },
            },
          ],
        };
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: ' brave knight.' }],
              },
            },
          ],
        };
      }

      (contentGenerator.generateContentStream as Mock).mockResolvedValue(
        mockStream(),
      );

      const stream = await chat.sendMessageStream(
        { message: userMessage },
        'prompt-stream',
      );

      const chunks: string[] = [];
      for await (const chunk of stream) {
        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) chunks.push(text);
      }

      expect(chunks).toEqual([
        'Once upon a time',
        ', there was a',
        ' brave knight.',
      ]);

      // Verify history contains the accumulated complete message
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0].role).toBe('user');
      expect(history[0].parts[0]).toMatchObject({ text: userMessage });
      expect(history[1].role).toBe('model');
      // All chunks should be accumulated as separate parts
      expect(history[1].parts).toEqual([
        { text: 'Once upon a time' },
        { text: ', there was a' },
        { text: ' brave knight.' },
      ]);
    });

    it('should handle streaming with tool calls', async () => {
      const userMessage = 'Calculate 5 + 3';

      // Mock streaming response with tool call
      async function* mockStreamWithTool(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Let me calculate that.' }],
              },
            },
          ],
        };
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [
                  {
                    functionCall: {
                      name: 'calculator',
                      args: { op: 'add', a: 5, b: 3 },
                    },
                  },
                ],
              },
            },
          ],
        };
      }

      (contentGenerator.generateContentStream as Mock).mockResolvedValue(
        mockStreamWithTool(),
      );

      const stream = await chat.sendMessageStream(
        { message: userMessage },
        'prompt-stream-tool',
      );

      const chunks: GenerateContentResponse[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);

      // Verify history correctly accumulates mixed content
      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].parts).toHaveLength(2);
      expect(history[1].parts[0]).toMatchObject({
        text: 'Let me calculate that.',
      });
      expect(history[1].parts[1]).toMatchObject({
        functionCall: { name: 'calculator' },
      });
    });

    it('should handle streaming errors and rollback history', async () => {
      const userMessage = 'Test streaming error';

      async function* mockErrorStream(): AsyncGenerator<GenerateContentResponse> {
        yield {
          candidates: [
            {
              content: {
                role: 'model',
                parts: [{ text: 'Starting...' }],
              },
            },
          ],
        };
        throw new Error('Stream error');
      }

      (contentGenerator.generateContentStream as Mock).mockResolvedValue(
        mockErrorStream(),
      );

      const stream = await chat.sendMessageStream(
        { message: userMessage },
        'prompt-stream-error',
      );

      try {
        for await (const _chunk of stream) {
          // Process chunks
        }
      } catch (error) {
        expect((error as Error).message).toBe('Stream error');
      }

      // History should not contain the failed message
      const history = chat.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('History Management - Core Functionality to Replace', () => {
    it('should distinguish between curated and comprehensive history', async () => {
      // Add valid message
      const validResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Valid response' }],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        validResponse,
      );

      await chat.sendMessage({ message: 'First message' }, 'prompt-1');

      // Add invalid/empty response
      const emptyResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValueOnce(
        emptyResponse,
      );

      await chat.sendMessage({ message: 'Second message' }, 'prompt-2');

      // Comprehensive history includes all
      const comprehensiveHistory = chat.getHistory(false);
      expect(comprehensiveHistory).toHaveLength(4);

      // Curated history excludes invalid
      const curatedHistory = chat.getHistory(true);
      // The curated history still includes the second user message
      // but excludes the invalid model response
      expect(curatedHistory).toHaveLength(3);
      expect(curatedHistory[0].parts[0]).toMatchObject({
        text: 'First message',
      });
      expect(curatedHistory[1].parts[0]).toMatchObject({
        text: 'Valid response',
      });
      expect(curatedHistory[2].parts[0]).toMatchObject({
        text: 'Second message',
      });
    });

    it('should handle clearHistory', () => {
      // Add some history
      chat.addHistory({
        role: 'user',
        parts: [{ text: 'Test message' }],
      });
      chat.addHistory({
        role: 'model',
        parts: [{ text: 'Test response' }],
      });

      expect(chat.getHistory()).toHaveLength(2);

      // Clear history
      chat.clearHistory();
      expect(chat.getHistory()).toHaveLength(0);
    });

    it('should deep clone history on get', () => {
      const testContent: Content = {
        role: 'user',
        parts: [{ text: 'Test message' }],
      };

      chat.addHistory(testContent);

      const history1 = chat.getHistory();
      const history2 = chat.getHistory();

      // Should be different references
      expect(history1).not.toBe(history2);
      expect(history1[0]).not.toBe(history2[0]);

      // But same content
      expect(history1).toEqual(history2);
    });
  });

  describe('System Instructions and Tools', () => {
    it('should set system instruction', async () => {
      const systemInstruction = 'You are a helpful assistant.';
      chat.setSystemInstruction(systemInstruction);

      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Response with system instruction' }],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        mockResponse,
      );

      await chat.sendMessage({ message: 'Test' }, 'prompt-1');

      // Verify system instruction was included
      expect(contentGenerator.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            systemInstruction,
          }),
        }),
        'prompt-1',
      );
    });

    it('should set tools', async () => {
      const tools: Tool[] = [
        {
          name: 'calculator',
          description: 'Performs calculations',
        },
      ];

      chat.setTools(tools);

      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Response with tools' }],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        mockResponse,
      );

      await chat.sendMessage({ message: 'Calculate something' }, 'prompt-1');

      // Verify tools were included
      expect(contentGenerator.generateContent).toHaveBeenCalledWith(
        expect.objectContaining({
          config: expect.objectContaining({
            tools,
          }),
        }),
        'prompt-1',
      );
    });
  });

  describe('Automatic Function Calling', () => {
    it('should handle automatic function calling history', async () => {
      const userMessage = 'Book a flight';

      const afcHistory: Content[] = [
        { role: 'user', parts: [{ text: userMessage }] },
        {
          role: 'model',
          parts: [
            { text: 'Searching for flights...' },
            {
              functionCall: {
                name: 'search_flights',
                args: { from: 'NYC', to: 'LAX' },
              },
            },
          ],
        },
        {
          role: 'user',
          parts: [
            {
              functionResponse: {
                name: 'search_flights',
                response: { flights: ['AA123', 'UA456'] },
              },
            },
          ],
        },
        {
          role: 'model',
          parts: [{ text: 'Found 2 flights available.' }],
        },
      ];

      const mockResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'I found 2 flights from NYC to LAX.' }],
            },
          },
        ],
        automaticFunctionCallingHistory: afcHistory,
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        mockResponse,
      );

      await chat.sendMessage({ message: userMessage }, 'prompt-afc');

      // Verify AFC history is properly integrated
      const history = chat.getHistory();

      // Should contain the AFC history properly deduplicated
      expect(history.length).toBeGreaterThanOrEqual(3);

      // Verify the AFC flow is preserved in history
      const hasToolCall = history.some((content) =>
        content.parts?.some((part) => 'functionCall' in part),
      );
      const hasToolResponse = history.some((content) =>
        content.parts?.some((part) => 'functionResponse' in part),
      );

      expect(hasToolCall).toBe(true);
      expect(hasToolResponse).toBe(true);
    });
  });

  describe('Thinking Blocks', () => {
    it('should filter out thinking blocks from history', async () => {
      const responseWithThinking: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { thought: true, text: 'Let me think about this...' },
                { text: 'Here is my response.' },
              ],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        responseWithThinking,
      );

      await chat.sendMessage({ message: 'Complex question' }, 'prompt-think');

      // Verify thinking blocks are not in history
      const history = chat.getHistory();
      // Only user message is added if model response only has thinking blocks
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].parts[0]).toMatchObject({ text: 'Complex question' });

      // Ensure no thought blocks in history
      const hasThoughtBlocks = history.some((content) =>
        content.parts?.some((part) => 'thought' in part),
      );
      expect(hasThoughtBlocks).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty model responses', async () => {
      const emptyResponse: GenerateContentResponse = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [],
            },
          },
        ],
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        emptyResponse,
      );

      await chat.sendMessage({ message: 'Test' }, 'prompt-empty');

      const history = chat.getHistory();
      expect(history).toHaveLength(2);
      expect(history[1].role).toBe('model');
      expect(history[1].parts).toEqual([]);
    });

    it('should handle missing candidates in response', async () => {
      const noCandidatesResponse: GenerateContentResponse = {
        candidates: undefined,
      };

      (contentGenerator.generateContent as Mock).mockResolvedValue(
        noCandidatesResponse,
      );

      await chat.sendMessage({ message: 'Test' }, 'prompt-no-candidates');

      const history = chat.getHistory();
      // With no candidates, only user message is added
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].parts[0]).toMatchObject({ text: 'Test' });
    });
  });
});
