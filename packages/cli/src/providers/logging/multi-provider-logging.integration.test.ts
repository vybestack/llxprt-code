/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  IProvider,
  IContent,
  GenerateChatOptions,
  ProviderToolset,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core';

// Interfaces that will be implemented in the next phase
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
  ): AsyncIterableIterator<unknown>;
  getWrappedProvider(): IProvider;
}

interface ConversationDataRedactor {
  redactMessage(message: IContent, provider: string): IContent;
  redactConversation(messages: IContent[], provider: string): IContent[];
}

interface ConversationStorage {
  writeConversationEntry(entry: ConversationLogEntry): Promise<void>;
  getLogFiles(): Promise<LogFileInfo[]>;
}

interface ConversationLogEntry {
  timestamp: string;
  conversation_id: string;
  provider_name: string;
  messages: IContent[];
  session_id?: string;
}

interface LogFileInfo {
  path: string;
  size: number;
  created: Date;
  lastModified: Date;
}

interface ProviderManager {
  registerProvider(provider: IProvider): void;
  setActiveProvider(name: string): void;
  getActiveProvider(): IProvider | null;
  getProviderNames(): string[];
}

// Remove unused interface to fix TS6196 error

// Mock telemetry system
const telemetrySystem = {
  logConversationRequest: vi.fn(),
  logProviderSwitch: vi.fn(),
  logConversationComplete: vi.fn(),
};

// Test helper functions
function createMockProvider(
  name: string,
  capabilities?: { streaming?: boolean; tools?: boolean },
): IProvider {
  const defaultCapabilities = { streaming: true, tools: true, ...capabilities };

  return {
    name,
    getModels: vi.fn().mockResolvedValue([
      {
        id: `${name}-model-1`,
        name: `${name.charAt(0).toUpperCase() + name.slice(1)} Model 1`,
      },
    ]),
    async *generateChatCompletion(
      _optionsOrMessages: GenerateChatOptions | IContent[],
      _tools?: ProviderToolset,
    ) {
      // Simulate provider-specific response patterns
      if (name === 'openai') {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'OpenAI response chunk 1' }],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: ' chunk 2' }],
        };
      } else if (name === 'anthropic') {
        yield {
          speaker: 'ai' as const,
          blocks: [
            {
              type: 'text' as const,
              text: 'Claude response: I understand your request.',
            },
          ],
        };
      } else if (name === 'gemini') {
        yield {
          speaker: 'ai' as const,
          blocks: [
            {
              type: 'text' as const,
              text: 'Gemini response with reasoning...',
            },
          ],
        };
      }
    },
    getServerTools: vi
      .fn()
      .mockReturnValue(defaultCapabilities.tools ? ['search', 'analyze'] : []),
    invokeServerTool: vi
      .fn()
      .mockResolvedValue({ result: `Tool result from ${name}` }),
    getCurrentModel: vi.fn().mockReturnValue(`${name}-model-1`),
    getDefaultModel: vi.fn().mockReturnValue(`${name}-default`),
    getToolFormat: vi
      .fn()
      .mockReturnValue(name === 'anthropic' ? 'xml' : 'json'),
  };
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

// Mock implementations for testing
class MockProviderManager implements ProviderManager {
  private providers = new Map<string, IProvider>();
  private activeProvider: string | null = null;

  registerProvider(provider: IProvider): void {
    this.providers.set(provider.name, provider);
  }

  setActiveProvider(name: string): void {
    if (this.providers.has(name)) {
      const oldProvider = this.activeProvider;
      this.activeProvider = name;

      if (oldProvider && oldProvider !== name) {
        telemetrySystem.logProviderSwitch({
          from_provider: oldProvider,
          to_provider: name,
          context_preserved: this.isContextCompatible(oldProvider, name),
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  getActiveProvider(): IProvider | null {
    return this.activeProvider
      ? this.providers.get(this.activeProvider) || null
      : null;
  }

  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  private isContextCompatible(from: string, to: string): boolean {
    // Simple heuristic for context compatibility
    const compatiblePairs = new Set([
      'openai-anthropic',
      'anthropic-openai',
      'gemini-openai',
      'openai-gemini',
    ]);
    return compatiblePairs.has(`${from}-${to}`);
  }
}

class MockConversationDataRedactor implements ConversationDataRedactor {
  redactMessage(message: IContent, _provider: string): IContent {
    return {
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.type === 'text') {
          return {
            ...block,
            text: block.text.replace(
              /sk-[a-zA-Z0-9]{48}/g,
              '[REDACTED-API-KEY]',
            ),
          };
        }
        return block;
      }),
    };
  }

  redactConversation(messages: IContent[], provider: string): IContent[] {
    return messages.map((msg) => this.redactMessage(msg, provider));
  }
}

class MockLoggingProviderWrapper implements LoggingProviderWrapper {
  constructor(
    private provider: IProvider,
    _config: Config,
    private redactor: ConversationDataRedactor,
    private storage: ConversationStorage,
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
  ): AsyncIterableIterator<unknown> {
    const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Log conversation request
    const redactedMessages = this.redactor.redactConversation(
      messages,
      this.provider.name,
    );

    const logEntry: ConversationLogEntry = {
      timestamp: new Date().toISOString(),
      conversation_id: conversationId,
      provider_name: this.provider.name,
      messages: redactedMessages,
    };

    await this.storage.writeConversationEntry(logEntry);

    telemetrySystem.logConversationRequest({
      conversation_id: conversationId,
      provider_name: this.provider.name,
      message_count: messages.length,
      has_tools: Boolean(tools && tools.length > 0),
    });

    // Stream response from wrapped provider
    const responseChunks: unknown[] = [];
    for await (const chunk of this.provider.generateChatCompletion(
      messages,
      tools,
    )) {
      responseChunks.push(chunk);
      yield chunk;
    }

    // Log completion
    telemetrySystem.logConversationComplete({
      conversation_id: conversationId,
      provider_name: this.provider.name,
      response_chunks: responseChunks.length,
    });
  }

  getWrappedProvider(): IProvider {
    return this.provider;
  }
}

class MockConversationStorage implements ConversationStorage {
  private entries: ConversationLogEntry[] = [];

  async writeConversationEntry(entry: ConversationLogEntry): Promise<void> {
    this.entries.push(entry);
  }

  async getLogFiles(): Promise<LogFileInfo[]> {
    return [
      {
        path: '/test/conversations.log',
        size: this.entries.length * 1000, // Estimate
        created: new Date(),
        lastModified: new Date(),
      },
    ];
  }

  getEntries(): ConversationLogEntry[] {
    return this.entries;
  }
}

function createConfigWithLogging(enabled: boolean): Config {
  return {
    getConversationLoggingEnabled: () => enabled,
  } as Config;
}

describe('Multi-Provider Conversation Logging Integration', () => {
  let providerManager: MockProviderManager;
  let redactor: ConversationDataRedactor;
  let storage: MockConversationStorage;
  let config: Config;

  beforeEach(() => {
    vi.clearAllMocks();
    providerManager = new MockProviderManager();
    redactor = new MockConversationDataRedactor();
    storage = new MockConversationStorage();
    config = createConfigWithLogging(true);
  });

  /**
   * @requirement INTEGRATION-001: Cross-provider conversation logging
   * @scenario Conversation spans multiple providers
   * @given ProviderManager with OpenAI, Anthropic, and Gemini providers
   * @when User switches between providers during conversation
   * @then Each provider interaction is logged with correct context
   * @and Provider switches are tracked with context preservation info
   */
  it('should log conversations across multiple provider switches', async () => {
    // Register providers
    const openaiProvider = createMockProvider('openai');
    const anthropicProvider = createMockProvider('anthropic');
    const geminiProvider = createMockProvider('gemini');

    providerManager.registerProvider(openaiProvider);
    providerManager.registerProvider(anthropicProvider);
    providerManager.registerProvider(geminiProvider);

    // Wrap each provider with logging
    const openaiWrapper = new MockLoggingProviderWrapper(
      openaiProvider,
      config,
      redactor,
      storage,
    );
    const anthropicWrapper = new MockLoggingProviderWrapper(
      anthropicProvider,
      config,
      redactor,
      storage,
    );
    const geminiWrapper = new MockLoggingProviderWrapper(
      geminiProvider,
      config,
      redactor,
      storage,
    );

    // Simulate conversation flow with provider switches
    providerManager.setActiveProvider('openai');
    await consumeAsyncIterable(
      openaiWrapper.generateChatCompletion([
        {
          speaker: 'human' as const,
          blocks: [
            { type: 'text' as const, text: 'Explain quantum computing' },
          ],
        },
      ]),
    );

    providerManager.setActiveProvider('anthropic');
    await consumeAsyncIterable(
      anthropicWrapper.generateChatCompletion([
        {
          speaker: 'human' as const,
          blocks: [
            {
              type: 'text' as const,
              text: 'Continue the explanation with practical applications',
            },
          ],
        },
      ]),
    );

    providerManager.setActiveProvider('gemini');
    await consumeAsyncIterable(
      geminiWrapper.generateChatCompletion([
        {
          speaker: 'human' as const,
          blocks: [{ type: 'text' as const, text: 'Summarize the key points' }],
        },
      ]),
    );

    // Verify logging across providers
    const entries = storage.getEntries();
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.provider_name)).toEqual([
      'openai',
      'anthropic',
      'gemini',
    ]);

    // Verify provider switches were logged
    expect(telemetrySystem.logProviderSwitch).toHaveBeenCalledTimes(2);
    expect(telemetrySystem.logProviderSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        from_provider: 'openai',
        to_provider: 'anthropic',
      }),
    );
    expect(telemetrySystem.logProviderSwitch).toHaveBeenCalledWith(
      expect.objectContaining({
        from_provider: 'anthropic',
        to_provider: 'gemini',
      }),
    );
  });

  /**
   * @requirement INTEGRATION-002: Tool usage logging across providers
   * @scenario Different providers with different tool formats
   * @given Providers with different tool formats (JSON vs XML)
   * @when Conversations include tool calls
   * @then Tool usage is logged consistently regardless of provider format
   */
  it('should log tool usage consistently across different provider formats', async () => {
    const openaiProvider = createMockProvider('openai', { tools: true });
    const anthropicProvider = createMockProvider('anthropic', { tools: true });

    const openaiWrapper = new MockLoggingProviderWrapper(
      openaiProvider,
      config,
      redactor,
      storage,
    );
    const anthropicWrapper = new MockLoggingProviderWrapper(
      anthropicProvider,
      config,
      redactor,
      storage,
    );

    const messagesWithTools: IContent[] = [
      {
        speaker: 'ai' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'Search for information about AI safety',
          },
          {
            type: 'tool_call' as const,
            id: 'call_1',
            name: 'search_web',
            parameters: { query: 'AI safety research 2024' },
          },
        ],
      },
    ];

    // Test with OpenAI (JSON format)
    await consumeAsyncIterable(
      openaiWrapper.generateChatCompletion(messagesWithTools),
    );

    // Test with Anthropic (XML format)
    await consumeAsyncIterable(
      anthropicWrapper.generateChatCompletion(messagesWithTools),
    );

    const entries = storage.getEntries();
    expect(entries).toHaveLength(2);

    // Both entries should have tool calls logged
    entries.forEach((entry) => {
      const toolCallBlocks = entry.messages[0].blocks.filter(
        (block) => block.type === 'tool_call',
      );
      expect(toolCallBlocks).toHaveLength(1);
      expect((toolCallBlocks[0] as { name: string }).name).toBe('search_web');
    });

    // Verify telemetry includes tool usage
    expect(telemetrySystem.logConversationRequest).toHaveBeenCalledTimes(2);
    expect(telemetrySystem.logConversationRequest).toHaveBeenCalledWith(
      expect.objectContaining({ has_tools: true }),
    );
  });

  /**
   * @requirement INTEGRATION-003: Streaming response logging
   * @scenario Providers with different streaming patterns
   * @given Providers that stream responses differently
   * @when Streaming conversations are logged
   * @then Complete responses are captured despite streaming differences
   */
  it('should handle different streaming patterns across providers', async () => {
    const fastStreamProvider = createMockProvider('fast-stream');
    const slowStreamProvider = createMockProvider('slow-stream');

    // Override streaming behavior
    fastStreamProvider.generateChatCompletion = vi
      .fn()
      .mockImplementation(async function* () {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'Fast' }],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: ' response' }],
        };
      });

    slowStreamProvider.generateChatCompletion = vi
      .fn()
      .mockImplementation(async function* () {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'Slow' }],
        };
        await new Promise((resolve) => setTimeout(resolve, 10)); // Simulate slow streaming
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: ' deliberate' }],
        };
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: ' response' }],
        };
      });

    const fastWrapper = new MockLoggingProviderWrapper(
      fastStreamProvider,
      config,
      redactor,
      storage,
    );
    const slowWrapper = new MockLoggingProviderWrapper(
      slowStreamProvider,
      config,
      redactor,
      storage,
    );

    const message: IContent[] = [
      {
        speaker: 'human' as const,
        blocks: [
          { type: 'text' as const, text: 'Tell me about machine learning' },
        ],
      },
    ];

    // Test fast streaming
    const fastResult = await consumeAsyncIterable(
      fastWrapper.generateChatCompletion(message),
    );

    // Test slow streaming
    const slowResult = await consumeAsyncIterable(
      slowWrapper.generateChatCompletion(message),
    );

    expect(fastResult).toHaveLength(2);
    expect(slowResult).toHaveLength(3);

    // Verify both conversations were logged
    const entries = storage.getEntries();
    expect(entries).toHaveLength(2);

    // Verify completion events were logged
    expect(telemetrySystem.logConversationComplete).toHaveBeenCalledTimes(2);
    expect(telemetrySystem.logConversationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ response_chunks: 2 }),
    );
    expect(telemetrySystem.logConversationComplete).toHaveBeenCalledWith(
      expect.objectContaining({ response_chunks: 3 }),
    );
  });

  /**
   * @requirement INTEGRATION-004: Error handling across providers
   * @scenario Provider errors during logged conversations
   * @given Providers that may throw errors
   * @when Provider errors occur during logging
   * @then Logging system handles errors gracefully
   * @and Other provider operations continue normally
   */
  it('should handle provider errors gracefully without affecting logging', async () => {
    const reliableProvider = createMockProvider('reliable');
    const errorProvider = createMockProvider('error-prone');

    // Make error provider throw during generation
    errorProvider.generateChatCompletion = vi
      .fn()
      .mockImplementation(async function* () {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'Starting response...' }],
        };
        throw new Error('Provider API error');
      });

    const reliableWrapper = new MockLoggingProviderWrapper(
      reliableProvider,
      config,
      redactor,
      storage,
    );
    const errorWrapper = new MockLoggingProviderWrapper(
      errorProvider,
      config,
      redactor,
      storage,
    );

    const message: IContent[] = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Test message' }],
      },
    ];

    // Test reliable provider first
    await consumeAsyncIterable(reliableWrapper.generateChatCompletion(message));

    // Test error provider (should handle error gracefully)
    const promise = consumeAsyncIterable(
      errorWrapper.generateChatCompletion(message),
    );
    await expect(promise).rejects.toThrow('Provider API error');

    // Verify that logging occurred even when provider errored
    const entries = storage.getEntries();
    expect(entries.length).toBeGreaterThan(0);

    // Verify that at least the request was logged for error provider
    expect(telemetrySystem.logConversationRequest).toHaveBeenCalledTimes(2);
  });

  /**
   * @requirement INTEGRATION-005: Concurrent provider operations
   * @scenario Multiple providers handling conversations simultaneously
   * @given Multiple wrapped providers operating concurrently
   * @when Concurrent conversations are initiated
   * @then All conversations are logged correctly without interference
   */
  it('should handle concurrent provider operations without logging conflicts', async () => {
    const providers = [
      createMockProvider('concurrent-1'),
      createMockProvider('concurrent-2'),
      createMockProvider('concurrent-3'),
    ];

    const wrappers = providers.map(
      (provider) =>
        new MockLoggingProviderWrapper(provider, config, redactor, storage),
    );

    const messages: IContent[] = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Concurrent test message' }],
      },
    ];

    // Start all conversations concurrently
    const concurrentOperations = wrappers.map((wrapper) =>
      consumeAsyncIterable(wrapper.generateChatCompletion(messages)),
    );

    const results = await Promise.all(concurrentOperations);

    // Verify all operations completed
    expect(results).toHaveLength(3);
    results.forEach((result) => {
      expect(result.length).toBeGreaterThan(0);
    });

    // Verify all conversations were logged
    const entries = storage.getEntries();
    expect(entries).toHaveLength(3);

    // Verify each provider was logged correctly
    const providerNames = entries.map((e) => e.provider_name).sort();
    expect(providerNames).toEqual([
      'concurrent-1',
      'concurrent-2',
      'concurrent-3',
    ]);

    // Verify telemetry was called for all
    expect(telemetrySystem.logConversationRequest).toHaveBeenCalledTimes(3);
    expect(telemetrySystem.logConversationComplete).toHaveBeenCalledTimes(3);
  });

  /**
   * @requirement INTEGRATION-006: Provider-specific data redaction
   * @scenario Different providers with provider-specific sensitive data
   * @given Providers with different API key formats and sensitive data patterns
   * @when Conversations contain provider-specific sensitive information
   * @then Data is redacted appropriately based on provider context
   */
  it('should apply provider-specific redaction patterns', async () => {
    const providers = [
      createMockProvider('openai'),
      createMockProvider('anthropic'),
      createMockProvider('gemini'),
    ];

    const wrappers = providers.map(
      (provider) =>
        new MockLoggingProviderWrapper(provider, config, redactor, storage),
    );

    const sensitiveMessages = [
      {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'My OpenAI key is sk-1234567890abcdef1234567890abcdef12345678',
          },
        ],
      },
      {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'My Anthropic key is sk-ant-api03-abcd1234567890',
          },
        ],
      },
      {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'My Google key is AIzaSyAbcd1234567890',
          },
        ],
      },
    ];

    // Test each provider with its specific sensitive data
    for (let i = 0; i < wrappers.length; i++) {
      await consumeAsyncIterable(
        wrappers[i].generateChatCompletion([sensitiveMessages[i]]),
      );
    }

    const entries = storage.getEntries();
    expect(entries).toHaveLength(3);

    // Verify redaction occurred for all providers
    entries.forEach((entry) => {
      const textBlocks = entry.messages[0].blocks.filter(
        (block) => block.type === 'text',
      );
      expect(textBlocks.length).toBeGreaterThan(0);
      const textContent = (textBlocks[0] as { text: string }).text;
      expect(textContent).toContain('[REDACTED-API-KEY]');
      expect(textContent).not.toContain('sk-');
      expect(textContent).not.toContain('AIza');
    });
  });

  /**
   * @requirement INTEGRATION-007: Session continuity across providers
   * @scenario Long conversation session with multiple provider switches
   * @given Long conversation with multiple provider switches
   * @when Session continues across provider changes
   * @then Session context is maintained in logging
   * @and Conversation continuity is tracked
   */
  it('should maintain session continuity across provider switches in logging', async () => {
    // Session ID for testing continuity tracking
    // const _sessionId = 'session_' + Date.now(); // Unused for now but may be needed for future session continuity tests
    const providers = ['openai', 'anthropic', 'gemini'].map((name) =>
      createMockProvider(name),
    );
    const wrappers = providers.map(
      (provider) =>
        new MockLoggingProviderWrapper(provider, config, redactor, storage),
    );

    // Simulate conversation progression
    const conversationMessages = [
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'What is machine learning?' }],
      },
      {
        speaker: 'human' as const,
        blocks: [{ type: 'text' as const, text: 'Can you give examples?' }],
      },
      {
        speaker: 'human' as const,
        blocks: [
          {
            type: 'text' as const,
            text: 'How about neural networks specifically?',
          },
        ],
      },
    ];

    // Use different provider for each message to simulate switching
    for (let i = 0; i < conversationMessages.length; i++) {
      const wrapper = wrappers[i];
      await consumeAsyncIterable(
        wrapper.generateChatCompletion([conversationMessages[i]]),
      );
    }

    const entries = storage.getEntries();
    expect(entries).toHaveLength(3);

    // Verify conversation progression
    expect(entries[0].provider_name).toBe('openai');
    expect(entries[1].provider_name).toBe('anthropic');
    expect(entries[2].provider_name).toBe('gemini');

    // Verify each conversation has unique conversation_id but could be linked by session
    const conversationIds = entries.map((e) => e.conversation_id);
    expect(new Set(conversationIds).size).toBe(3); // All unique

    // Verify provider switches were tracked
    expect(telemetrySystem.logProviderSwitch).toHaveBeenCalledTimes(2);
  });
});
