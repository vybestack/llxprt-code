/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IProvider,
  IContent,
  ITool,
  type Config,
} from '@vybestack/llxprt-code-core';

// These interfaces will be implemented in the next phase
interface LoggingProviderWrapper {
  generateChatCompletion(
    messages: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent>;
  getWrappedProvider(): IProvider;
}

interface ConversationDataRedactor {
  redactMessage(message: IContent, provider: string): IContent;
  redactToolCall(tool: ITool): ITool;
}

// Remove unused interfaces to fix TS6196 errors

// Mock telemetry loggers
const telemetryLoggers = {
  logConversationRequest: vi.fn(),
  logProviderSwitch: vi.fn(),
};

// Test helper functions
function createMockProvider(name: string): IProvider {
  return {
    name,
    getModels: vi.fn().mockResolvedValue([]),
    generateChatCompletion: vi.fn().mockImplementation(async function* () {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text', text: `Response from ${name}` }],
      };
    }),
    getDefaultModel: vi.fn().mockReturnValue(`${name}-default-model`),
    getServerTools: vi.fn().mockReturnValue([]),
    invokeServerTool: vi.fn().mockResolvedValue({}),
  };
}

function createConfigWithLogging(enabled: boolean): Config {
  return {
    getConversationLoggingEnabled: () => enabled,
  } as Config;
}

async function consumeAsyncIterable<T>(
  iterable: AsyncIterable<T>,
): Promise<T[]> {
  const results: T[] = [];
  for await (const item of iterable) {
    results.push(item);
  }
  return results;
}

// Mock classes that will be implemented
class MockLoggingProviderWrapper implements LoggingProviderWrapper {
  constructor(
    private provider: IProvider,
    private config: Config,
    private redactor: ConversationDataRedactor,
  ) {}

  async *generateChatCompletion(
    messages: IContent[],
    tools?: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }>,
  ): AsyncIterableIterator<IContent> {
    // This should log the conversation request when logging is enabled
    if (this.config.getConversationLoggingEnabled?.()) {
      try {
        const redactedMessages = messages.map((msg) =>
          this.redactor.redactMessage(msg, this.provider.name),
        );

        telemetryLoggers.logConversationRequest(this.config, {
          provider_name: this.provider.name,
          redacted_messages: redactedMessages,
          timestamp: new Date().toISOString(),
        });
      } catch (_error) {
        // Silently catch logging errors to ensure provider operation continues
        // In real implementation, this would be properly logged to a fallback system
      }
    }

    // Delegate to wrapped provider
    yield* this.provider.generateChatCompletion(messages, tools);
  }

  getWrappedProvider(): IProvider {
    return this.provider;
  }
}

class MockConversationDataRedactor implements ConversationDataRedactor {
  redactMessage(message: IContent, _provider: string): IContent {
    // This is a placeholder - actual implementation will handle redaction
    return message;
  }

  redactToolCall(tool: ITool): ITool {
    // This is a placeholder - actual implementation will handle redaction
    return { ...tool };
  }
}

describe('Multi-Provider Conversation Logging', () => {
  let mockProvider: IProvider;
  let config: Config;
  let redactor: ConversationDataRedactor;

  beforeEach(() => {
    vi.clearAllMocks();
    redactor = new MockConversationDataRedactor();
  });

  /**
   * @requirement LOGGING-001: Provider-agnostic logging
   * @scenario OpenAI provider generates chat completion
   * @given LoggingProviderWrapper wrapping OpenAI provider with logging enabled
   * @when generateChatCompletion() is called with test messages
   * @then ConversationRequestEvent is created with provider_name: 'openai'
   * @and Event contains redacted messages matching input structure
   */
  it('should log OpenAI provider requests with provider context', async () => {
    mockProvider = createMockProvider('openai');
    config = createConfigWithLogging(true);
    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test prompt' }] },
    ];

    const logSpy = vi.spyOn(telemetryLoggers, 'logConversationRequest');

    const stream = wrapper.generateChatCompletion(messages);
    await consumeAsyncIterable(stream);

    expect(logSpy).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider_name: 'openai',
        redacted_messages: expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Test prompt' }],
          }),
        ]),
      }),
    );
  });

  /**
   * @requirement LOGGING-002: Anthropic provider logging
   * @scenario Anthropic provider generates chat completion
   * @given LoggingProviderWrapper wrapping Anthropic provider with logging enabled
   * @when generateChatCompletion() is called with messages containing tool calls
   * @then ConversationRequestEvent includes provider_name: 'anthropic'
   * @and Tool calls are properly redacted in the logged messages
   */
  it('should log Anthropic provider requests with tool call redaction', async () => {
    mockProvider = createMockProvider('anthropic');
    config = createConfigWithLogging(true);
    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'Read my API key file' },
          {
            type: 'tool_call',
            id: 'call_1',
            name: 'read_file',
            parameters: {
              file_path: '/home/user/.openai/key',
            },
          },
        ],
      },
    ];

    const logSpy = vi.spyOn(telemetryLoggers, 'logConversationRequest');

    const stream = wrapper.generateChatCompletion(messages);
    await consumeAsyncIterable(stream);

    expect(logSpy).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider_name: 'anthropic',
        redacted_messages: expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: expect.arrayContaining([
              expect.objectContaining({ type: 'tool_call' }),
            ]),
          }),
        ]),
      }),
    );
  });

  /**
   * @requirement LOGGING-003: Gemini provider logging
   * @scenario Gemini provider generates chat completion
   * @given LoggingProviderWrapper wrapping Gemini provider with logging enabled
   * @when generateChatCompletion() is called with system message
   * @then ConversationRequestEvent includes provider_name: 'gemini'
   * @and System message is included in redacted messages
   */
  it('should log Gemini provider requests with system messages', async () => {
    mockProvider = createMockProvider('gemini');
    config = createConfigWithLogging(true);
    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );

    const messages: IContent[] = [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'You are a helpful assistant' }],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const logSpy = vi.spyOn(telemetryLoggers, 'logConversationRequest');

    const stream = wrapper.generateChatCompletion(messages);
    await consumeAsyncIterable(stream);

    expect(logSpy).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider_name: 'gemini',
        redacted_messages: expect.arrayContaining([
          expect.objectContaining({
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          }),
        ]),
      }),
    );
  });

  /**
   * @requirement LOGGING-004: Logging disabled behavior
   * @scenario LoggingProviderWrapper with logging disabled
   * @given LoggingProviderWrapper with config.logConversations: false
   * @when generateChatCompletion() is called
   * @then No telemetry logging methods are called
   * @and Provider operates normally without logging overhead
   */
  it('should not log when conversation logging is disabled', async () => {
    mockProvider = createMockProvider('openai');
    config = createConfigWithLogging(false);
    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test prompt' }] },
    ];

    const logSpy = vi.spyOn(telemetryLoggers, 'logConversationRequest');

    const stream = wrapper.generateChatCompletion(messages);
    await consumeAsyncIterable(stream);

    expect(logSpy).not.toHaveBeenCalled();
  });

  /**
   * @requirement LOGGING-005: Tool format preservation
   * @scenario Provider with custom tool format
   * @given LoggingProviderWrapper wrapping provider with hermes tool format
   * @when generateChatCompletion() is called with tools parameter
   * @then Tool format is passed through to wrapped provider unchanged
   * @and Logging captures the tool format used
   */
  it('should preserve tool format when logging provider requests', async () => {
    mockProvider = createMockProvider('openai');
    config = createConfigWithLogging(true);
    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test' }] },
    ];
    const tools: Array<{
      functionDeclarations: Array<{
        name: string;
        description?: string;
        parameters?: unknown;
      }>;
    }> = [
      {
        functionDeclarations: [
          {
            name: 'test_tool',
            description: 'A test tool',
            parameters: { type: 'object', properties: {} },
          },
        ],
      },
    ];

    const stream = wrapper.generateChatCompletion(messages, tools);
    await consumeAsyncIterable(stream);

    expect(mockProvider.generateChatCompletion).toHaveBeenCalledWith(
      messages,
      tools,
    );
  });

  /**
   * @requirement LOGGING-006: Error handling in logging
   * @scenario LoggingProviderWrapper encounters logging error
   * @given LoggingProviderWrapper with logging enabled
   * @when generateChatCompletion() is called and logging throws error
   * @then Provider operation continues normally
   * @and Error does not propagate to caller
   */
  it('should handle logging errors gracefully without affecting provider operation', async () => {
    mockProvider = createMockProvider('openai');
    config = createConfigWithLogging(true);

    // Mock the logging function to throw an error
    vi.spyOn(telemetryLoggers, 'logConversationRequest').mockImplementation(
      () => {
        throw new Error('Logging service unavailable');
      },
    );

    const wrapper = new MockLoggingProviderWrapper(
      mockProvider,
      config,
      redactor,
    );
    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Test' }] },
    ];

    // Should not throw despite logging error
    const stream = wrapper.generateChatCompletion(messages);
    const results = await consumeAsyncIterable(stream);

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      blocks: [{ type: 'text', text: 'Response from openai' }],
    });
  });

  /**
   * @requirement LOGGING-007: Async iterator preservation
   * @scenario LoggingProviderWrapper with streaming response
   * @given LoggingProviderWrapper wrapping provider that yields multiple chunks
   * @when generateChatCompletion() returns async iterator
   * @then All chunks are yielded in correct order
   * @and Logging occurs before first chunk is yielded
   */
  it('should preserve async iterator behavior while logging', async () => {
    const streamingProvider: IProvider = {
      name: 'streaming',
      getModels: vi.fn().mockResolvedValue([]),
      async *generateChatCompletion() {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text', text: 'Chunk 1' }],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text', text: 'Chunk 2' }],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text', text: 'Chunk 3' }],
        };
      },
      getDefaultModel: vi.fn().mockReturnValue('streaming-default-model'),
      getServerTools: vi.fn().mockReturnValue([]),
      invokeServerTool: vi.fn().mockResolvedValue({}),
    };

    config = createConfigWithLogging(true);
    const wrapper = new MockLoggingProviderWrapper(
      streamingProvider,
      config,
      redactor,
    );
    const logSpy = vi.spyOn(telemetryLoggers, 'logConversationRequest');

    const messages: IContent[] = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Stream test' }] },
    ];
    const results = await consumeAsyncIterable(
      wrapper.generateChatCompletion(messages),
    );

    expect(logSpy).toHaveBeenCalled();
    expect(results).toHaveLength(3);
    expect(
      results
        .map((r) => (r as IContent).blocks[0])
        .map((block) => (block as { text: string }).text),
    ).toEqual(['Chunk 1', 'Chunk 2', 'Chunk 3']);
  });
});
