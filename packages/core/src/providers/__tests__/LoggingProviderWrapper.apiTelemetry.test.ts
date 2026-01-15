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
});
