/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for LoggingProviderWrapper enhanced metrics (Issue #1805).
 * Split from LoggingProviderWrapper.apiTelemetry.test.ts for max-lines compliance.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type { GenerateChatOptions, IContent, IProvider } from '../IProvider.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import {
  StubRedactor,
  createConfigStub,
  createRuntimeContext,
} from './LoggingProviderWrapper.test-helpers.js';

describe('LoggingProviderWrapper Enhanced Metrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
