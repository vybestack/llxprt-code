/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for LoggingProviderWrapper API telemetry logging.
 * Issue #684: API requests were not being logged via logApiResponse,
 * causing /stats model to show "No API calls" even after making requests.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type { GenerateChatOptions, IContent, IProvider } from '../IProvider.js';
import type { Config } from '../../config/config.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import * as loggers from '../../telemetry/loggers.js';

// Mock the loggers module
vi.mock('../../telemetry/loggers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof loggers>();
  return {
    ...actual,
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
    logApiRequest: vi.fn(),
    logConversationRequest: vi.fn(),
    logConversationResponse: vi.fn(),
    logTokenUsage: vi.fn(),
  };
});

class StubProvider implements IProvider {
  name = 'stub-provider';
  private tokenUsage = {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cachedTokens: 10,
  };

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  async *generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    void options;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Test response' }],
      metadata: {
        usage: this.tokenUsage,
      },
    } as IContent;
  }
}

class FinishReasonProvider implements IProvider {
  name = 'finish-reason-provider';
  private tokenUsage = {
    promptTokens: 100,
    completionTokens: 50,
    totalTokens: 150,
    cachedTokens: 10,
  };

  constructor(private finishReason: string) {}

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  async *generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    void options;
    yield {
      speaker: 'ai',
      blocks: [{ type: 'text', text: 'Test response' }],
      metadata: {
        usage: this.tokenUsage,
        finishReason: this.finishReason,
      },
    } as IContent;
  }
}

class ErrorProvider implements IProvider {
  name = 'error-provider';

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'error-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  // eslint-disable-next-line require-yield
  async *generateChatCompletion(
    _options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    throw new Error('Simulated API error');
  }
}

class StubRedactor {
  redactMessage(content: IContent): IContent {
    return content;
  }

  redactToolCall(tool: unknown): unknown {
    return tool;
  }

  redactResponseContent(content: string): string {
    return content;
  }
}

const createConfigStub = (loggingEnabled = false): Config =>
  ({
    getConversationLoggingEnabled: () => loggingEnabled,
    getConversationLogPath: () => '/tmp/test',
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
    getProviderManager: () => ({
      accumulateSessionTokens: vi.fn(),
    }),
  }) as unknown as Config;

const createRuntimeContext = (
  settings: SettingsService,
  config: Config,
): ProviderRuntimeContext => ({
  runtimeId: 'test-runtime',
  settingsService: settings,
  config,
  metadata: { source: 'LoggingProviderWrapper.apiTelemetry.test' },
});

describe('LoggingProviderWrapper API Telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logApiResponse', () => {
    it('should call logApiResponse after successful API completion when conversation logging is enabled', async () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      // Consume the iterator to trigger the API response logging
      const results = [];
      for await (const chunk of iterator) {
        results.push(chunk);
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[0]).toBe(config);
      expect(call[1]).toMatchObject({
        model: 'stub-model',
        input_token_count: 100,
        output_token_count: 50,
      });
    });

    it('should call logApiResponse after successful API completion when conversation logging is disabled', async () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      // Consume the iterator
      const results = [];
      for await (const chunk of iterator) {
        results.push(chunk);
      }

      // API response logging should happen regardless of conversation logging setting
      expect(loggers.logApiResponse).toHaveBeenCalled();
    });

    it('should include correct token counts in logApiResponse', async () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      const event = call[1];

      expect(event.input_token_count).toBe(100);
      expect(event.output_token_count).toBe(50);
      // cachedTokens from provider metadata flows to cached_content_token_count for UI telemetry
      expect(event.cached_content_token_count).toBe(10);
    });
  });

  describe('logApiError', () => {
    it('should call logApiError when API call fails', async () => {
      const provider = new ErrorProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      await expect(async () => {
        for await (const _chunk of iterator) {
          // Consume
        }
      }).rejects.toThrow('Simulated API error');

      expect(loggers.logApiError).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiError).mock.calls[0];
      expect(call[0]).toBe(config);
      expect(call[1]).toMatchObject({
        model: 'error-model',
        error: 'Simulated API error',
      });
    });
  });

  describe('model name in telemetry', () => {
    it('should use resolved model name when available (even when conversation logging is disabled)', async () => {
      // Issue #684: Use the resolved model name for telemetry, not the provider default
      // This ensures /stats model shows the correct model that was actually used
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled - uses metrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
          resolved: { model: 'custom-model-name' },
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      // Use resolved model name for accurate /stats model tracking
      expect(call[1].model).toBe('custom-model-name');
    });

    it('should use provider default model when resolved model is not available', async () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].model).toBe('stub-model');
    });

    it('should use resolved model name when conversation logging is enabled (logResponse path)', async () => {
      // This test specifically targets the bug where logResponseStream -> logResponse
      // was using getDefaultModel() instead of the resolved model name.
      // The fix requires passing resolvedModelName through the logResponseStream call chain.
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED - uses logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
          resolved: { model: 'explicitly-requested-model' },
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      // logApiResponse should be called with the resolved model name, not the default
      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      // Bug: Before fix, this would be 'stub-model' (the default)
      // After fix: should be 'explicitly-requested-model' (the resolved model)
      expect(call[1].model).toBe('explicitly-requested-model');
    });
  });

  describe('finish_reasons in telemetry', () => {
    it('should populate finish_reasons when provider metadata includes finishReason (logResponseStream path)', async () => {
      const provider = new FinishReasonProvider('stop');
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED - uses logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toStrictEqual(['stop']);
    });

    it('should default finish_reasons to [] when no finishReason in metadata', async () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toStrictEqual([]);
    });

    it('should populate finish_reasons via processStreamForMetrics path (logging disabled)', async () => {
      const provider = new FinishReasonProvider('length');
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled - uses processStreamForMetrics
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toStrictEqual(['length']);
    });

    // Issue #1844: stopReason fallback when finishReason is absent
    it('should populate finish_reasons from metadata.stopReason when finishReason is absent (logResponseStream path)', async () => {
      // Provider that emits stopReason but NOT finishReason (e.g., Anthropic/parseResponsesStream)
      const provider = new (class implements IProvider {
        name = 'stopreason-provider';
        async getModels(): Promise<never[]> {
          return [];
        }
        getDefaultModel(): string {
          return 'stopreason-model';
        }
        getServerTools(): string[] {
          return [];
        }
        async invokeServerTool(
          _toolName: string,
          _params: unknown,
          _config?: unknown,
        ): Promise<unknown> {
          return {};
        }
        async *generateChatCompletion(
          _options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Test' }],
            metadata: {
              usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
              stopReason: 'end_turn',
            },
          } as IContent;
        }
      })();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED → logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toStrictEqual(['end_turn']);
    });

    it('should populate finish_reasons from metadata.stopReason via processStreamForMetrics path', async () => {
      const provider = new (class implements IProvider {
        name = 'stopreason-metrics-provider';
        async getModels(): Promise<never[]> {
          return [];
        }
        getDefaultModel(): string {
          return 'stopreason-model';
        }
        getServerTools(): string[] {
          return [];
        }
        async invokeServerTool(
          _toolName: string,
          _params: unknown,
          _config?: unknown,
        ): Promise<unknown> {
          return {};
        }
        async *generateChatCompletion(
          _options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Test' }],
            metadata: {
              usage: {
                promptTokens: 10,
                completionTokens: 5,
                totalTokens: 15,
              },
              stopReason: 'completed',
            },
          } as IContent;
        }
      })();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled → processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume
      }

      expect(loggers.logApiResponse).toHaveBeenCalled();
      const call = vi.mocked(loggers.logApiResponse).mock.calls[0];
      expect(call[1].finish_reasons).toStrictEqual(['completed']);
    });
  });

  describe('TPM tracking (Issue #1764)', () => {
    // A provider that yields chunks with NO metadata.usage - simulates ollama/zai/anthropic
    // when they don't surface token usage in stream chunks.
    class NoUsageProvider implements IProvider {
      name = 'no-usage-provider';

      async getModels(): Promise<never[]> {
        return [];
      }

      getDefaultModel(): string {
        return 'no-usage-model';
      }

      getServerTools(): string[] {
        return [];
      }

      async invokeServerTool(
        _toolName: string,
        _params: unknown,
        _config?: unknown,
      ): Promise<unknown> {
        return {};
      }

      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        // Emit a chunk with NO metadata.usage - the common case for many providers
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello from no-usage provider' }],
          // Deliberately no metadata.usage here
        } as IContent;
      }
    }

    it('should record performance metrics even when provider emits no token usage metadata', async () => {
      const provider = new NoUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled → processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // recordCompletion must have been called even though no usage metadata was emitted,
      // and totalTokens must be > 0 because we estimate from the streamed text
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(1);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should estimate output tokens from streamed text when provider emits no usage metadata', async () => {
      const provider = new NoUsageProvider(); // yields 'Hello from no-usage provider'
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // Estimated token count from 'Hello from no-usage provider' should be > 0 and < 100
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalTokens).toBeGreaterThan(0);
      expect(metrics.totalTokens).toBeLessThan(100);
    });

    it('should record performance metrics when provider emits token usage metadata', async () => {
      const provider = new StubProvider(); // StubProvider DOES emit metadata.usage
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // Logging disabled → processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(1);
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should still accumulate token usage when usage metadata is present', async () => {
      const provider = new StubProvider(); // StubProvider emits metadata.usage
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const accumulateMock = vi.fn();
      const config = {
        ...createConfigStub(false),
        getProviderManager: () => ({
          accumulateSessionTokens: accumulateMock,
        }),
      } as unknown as Config;
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // accumulateSessionTokens should have been called since usage metadata was present
      expect(accumulateMock).toHaveBeenCalled();
    });

    it('should NOT accumulate token usage when provider emits no usage metadata', async () => {
      const provider = new NoUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const accumulateMock = vi.fn();
      const config = {
        ...createConfigStub(false),
        getProviderManager: () => ({
          accumulateSessionTokens: accumulateMock,
        }),
      } as unknown as Config;
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // accumulateSessionTokens must NOT be called when no usage metadata is available
      expect(accumulateMock).not.toHaveBeenCalled();
    });

    it('should estimate tokens from multiple streamed text chunks', async () => {
      class MultiChunkNoUsageProvider implements IProvider {
        name = 'multi-chunk-provider';
        async getModels(): Promise<never[]> {
          return [];
        }
        getDefaultModel(): string {
          return 'multi-chunk-model';
        }
        getServerTools(): string[] {
          return [];
        }
        async invokeServerTool(): Promise<unknown> {
          return {};
        }
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          void options;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First chunk of text. ' }],
          } as IContent;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Second chunk of text. ' }],
          } as IContent;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Third chunk of text.' }],
          } as IContent;
        }
      }

      const provider = new MultiChunkNoUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // Token estimate should reflect ALL chunks concatenated, not just the last one
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalTokens).toBeGreaterThan(0);
    });

    it('should record zero estimated tokens when stream contains only non-text blocks', async () => {
      class ToolOnlyProvider implements IProvider {
        name = 'tool-only-provider';
        async getModels(): Promise<never[]> {
          return [];
        }
        getDefaultModel(): string {
          return 'tool-model';
        }
        getServerTools(): string[] {
          return [];
        }
        async invokeServerTool(): Promise<unknown> {
          return {};
        }
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          void options;
          yield {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: 'call_1',
                name: 'test_tool',
                parameters: {},
              },
            ],
          } as IContent;
        }
      }

      const provider = new ToolOnlyProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // No text content → estimated tokens should be 0, but completion still recorded
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalRequests).toBeGreaterThanOrEqual(1);
      expect(metrics.totalTokens).toBe(0);
    });
  });

  describe('Issue #1805: processStreamForMetrics enhanced metrics', () => {
    // Provider that yields multiple chunks with token usage in final chunk
    class MultiChunkWithUsageProvider implements IProvider {
      name = 'multi-chunk-usage';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Hello' }],
        } as IContent;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' World' }],
        } as IContent;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: '!' }],
          metadata: {
            usage: {
              promptTokens: 100,
              completionTokens: 50,
              totalTokens: 150,
              cachedTokens: 10,
            },
            finishReason: 'STOP',
          },
        } as IContent;
      }
    }

    class MetadataThenTextProvider implements IProvider {
      name = 'metadata-then-text';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            finishReason: 'IN_PROGRESS',
          },
        } as IContent;

        await new Promise((resolve) => setTimeout(resolve, 30));

        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'ready' }],
          metadata: {
            usage: {
              promptTokens: 20,
              completionTokens: 10,
              totalTokens: 30,
              cachedTokens: 0,
            },
            finishReason: 'STOP',
          },
        } as IContent;
      }
    }

    class ToolCallOnlyProvider implements IProvider {
      name = 'tool-call-only';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [],
          metadata: {
            finishReason: 'IN_PROGRESS',
          },
        } as IContent;

        await new Promise((resolve) => setTimeout(resolve, 30));

        yield {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_1',
              name: 'test_tool',
              parameters: { foo: 'bar' },
            },
          ],
          metadata: {
            usage: {
              promptTokens: 20,
              completionTokens: 10,
              totalTokens: 30,
              cachedTokens: 0,
            },
            finishReason: 'STOP',
          },
        } as IContent;
      }
    }

    class TextThenErrorProvider implements IProvider {
      name = 'text-then-error';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'partial' }],
        } as IContent;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' response' }],
        } as IContent;
        throw new Error('Stream interrupted after partial output');
      }
    }

    it('should pass total tokens (input + output) to performanceTracker via processStreamForMetrics', async () => {
      const provider = new MultiChunkWithUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // totalTokens should be 100 + 50 = 150 (input + output), NOT just 50 (output)
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalTokens).toBe(150);
    });

    it('should capture TTFT (timeToFirstToken) on first chunk via processStreamForMetrics', async () => {
      const provider = new MultiChunkWithUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // TTFT should have been captured since the provider yields multiple chunks
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.timeToFirstToken).not.toBeNull();
      expect(metrics.timeToFirstToken!).toBeGreaterThanOrEqual(0);
    });

    it('should count chunks correctly via processStreamForMetrics', async () => {
      const provider = new MultiChunkWithUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      const chunks: IContent[] = [];
      for await (const chunk of iterator) {
        chunks.push(chunk);
      }

      // MultiChunkWithUsageProvider yields 3 chunks
      expect(chunks).toHaveLength(3);
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.chunksReceived).toBe(3);
    });

    it('should capture TTFT on first token-bearing chunk (ignoring metadata-only chunks)', async () => {
      const provider = new MetadataThenTextProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.timeToFirstToken).not.toBeNull();
      expect(metrics.timeToFirstToken!).toBeGreaterThanOrEqual(20);
    });

    it('should treat tool_call blocks as token-bearing for TTFT detection', async () => {
      const provider = new ToolCallOnlyProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.timeToFirstToken).not.toBeNull();
      expect(metrics.timeToFirstToken!).toBeGreaterThanOrEqual(20);
    });

    it('should preserve first-chunk TTFT and chunk count when processStreamForMetrics errors', async () => {
      const provider = new TextThenErrorProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false); // processStreamForMetrics path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      await expect(async () => {
        for await (const _chunk of iterator) {
          // Consume until stream throws
        }
      }).rejects.toThrow('Stream interrupted after partial output');

      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.timeToFirstToken).not.toBeNull();
      expect(metrics.timeToFirstToken!).toBeGreaterThanOrEqual(0);
      expect(metrics.chunksReceived).toBe(2);
      expect(metrics.errors.length).toBeGreaterThan(0);
    });

    it('should compute tokensPerSecond as cumulative average', async () => {
      const provider = new MultiChunkWithUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(false);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // tokensPerSecond should be computed from totalTokens / totalGenerationTimeMs
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.tokensPerSecond).toBeGreaterThan(0);
    });
  });

  describe('Issue #1805: logResponseStream enhanced metrics', () => {
    class MultiChunkForLoggingProvider implements IProvider {
      name = 'multi-chunk-logging';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'First' }],
        } as IContent;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: ' Second' }],
          metadata: {
            usage: {
              promptTokens: 200,
              completionTokens: 80,
              totalTokens: 280,
              cachedTokens: 20,
            },
            finishReason: 'STOP',
          },
        } as IContent;
      }
    }

    it('should pass total tokens (input + output) to performanceTracker via logResponseStream', async () => {
      const provider = new MultiChunkForLoggingProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED → logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      // totalTokens should be 200 + 80 = 280 (input + output), NOT just 80 (output)
      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalTokens).toBe(280);
    });

    it('should capture TTFT and chunkCount via logResponseStream', async () => {
      const provider = new MultiChunkForLoggingProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED → logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      const metrics = wrapper.getPerformanceMetrics();
      // TTFT should be captured on first chunk
      expect(metrics.timeToFirstToken).not.toBeNull();
      expect(metrics.timeToFirstToken!).toBeGreaterThanOrEqual(0);
      // chunkCount should be 2 (provider yields 2 chunks)
      expect(metrics.chunksReceived).toBe(2);
    });

    class TextThenErrorWithUsageProvider implements IProvider {
      name = 'text-then-error-with-usage';
      async getModels(): Promise<never[]> {
        return [];
      }
      getDefaultModel(): string {
        return 'test-model';
      }
      getServerTools(): string[] {
        return [];
      }
      async invokeServerTool(): Promise<unknown> {
        return {};
      }
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        void options;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'First partial chunk' }],
          metadata: {
            usage: {
              promptTokens: 120,
              completionTokens: 20,
              totalTokens: 140,
              cachedTokens: 5,
            },
          },
        } as IContent;
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Second partial chunk' }],
          metadata: {
            usage: {
              promptTokens: 120,
              completionTokens: 30,
              totalTokens: 150,
              cachedTokens: 5,
            },
          },
        } as IContent;
        throw new Error('stream failed after usage metadata');
      }
    }

    it('should record failed logResponseStream calls as errors instead of completions', async () => {
      const provider = new TextThenErrorWithUsageProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true); // Logging ENABLED → logResponseStream path
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      await expect(async () => {
        for await (const _chunk of iterator) {
          // consume chunks until the stream fails
        }
      }).rejects.toThrow('stream failed after usage metadata');

      const metrics = wrapper.getPerformanceMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.totalTokens).toBe(0);
      expect(metrics.errors.length).toBe(1);
      expect(metrics.errorRate).toBe(1);
      expect(metrics.chunksReceived).toBe(2);
      expect(metrics.timeToFirstToken).not.toBeNull();
    });

    it('should reset performance tracker metrics when clearState is called', async () => {
      const provider = new MultiChunkForLoggingProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const settings = new SettingsService();
      const config = createConfigStub(true);
      const runtime = createRuntimeContext(settings, config);

      const iterator = wrapper.generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [
            {
              speaker: 'human',
              blocks: [{ type: 'text', text: 'Hello' }],
            },
          ],
          settings,
          config,
          runtime,
        }),
      );

      for await (const _chunk of iterator) {
        // Consume the stream
      }

      const metricsBeforeClear = wrapper.getPerformanceMetrics();
      expect(metricsBeforeClear.totalRequests).toBeGreaterThan(0);
      expect(metricsBeforeClear.totalTokens).toBeGreaterThan(0);
      expect(metricsBeforeClear.tokensPerSecond).toBeGreaterThan(0);
      expect(metricsBeforeClear.tokensPerMinute).toBeGreaterThan(0);

      wrapper.clearState?.();

      const metricsAfterClear = wrapper.getPerformanceMetrics();
      expect(metricsAfterClear.totalRequests).toBe(0);
      expect(metricsAfterClear.totalTokens).toBe(0);
      expect(metricsAfterClear.tokensPerSecond).toBe(0);
      expect(metricsAfterClear.tokensPerMinute).toBe(0);
      expect(metricsAfterClear.chunksReceived).toBe(0);
      expect(metricsAfterClear.timeToFirstToken).toBeNull();
      expect(metricsAfterClear.errors).toHaveLength(0);
      expect(metricsAfterClear.errorRate).toBe(0);
    });
  });
});
