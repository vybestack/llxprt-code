/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for LoggingProviderWrapper TPM tracking and enhanced metrics.
 * Split from LoggingProviderWrapper.apiTelemetry.test.ts for max-lines compliance.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type { GenerateChatOptions, IContent, IProvider } from '../IProvider.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import {
  StubProvider,
  StubRedactor,
  createConfigStub,
  createRuntimeContext,
} from './LoggingProviderWrapper.test-helpers.js';

describe('LoggingProviderWrapper Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
