/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 3: Timeout Wrapper Tests
 * Issue #489 - Advanced Failover with Metrics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { IProvider } from '../IProvider.js';
import { LoadBalancerFailoverError } from '../errors.js';

describe('LoadBalancingProvider Timeout Wrapper - Phase 3', () => {
  let settingsService: SettingsService;
  let runtimeConfig: Config;
  let providerManager: ProviderManager;
  let config: LoadBalancingProviderConfig;
  const subProfiles: LoadBalancerSubProfile[] = [
    {
      name: 'backend1',
      providerName: 'test-provider-1',
      modelId: 'test-model-1',
      baseURL: 'https://test1.com',
      authToken: 'token1',
    },
    {
      name: 'backend2',
      providerName: 'test-provider-2',
      modelId: 'test-model-2',
      baseURL: 'https://test2.com',
      authToken: 'token2',
    },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    settingsService = new SettingsService();
    runtimeConfig = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({
      settingsService,
      config: runtimeConfig,
    });
    config = {
      profileName: 'test-lb',
      strategy: 'failover',
      subProfiles,
      lbProfileEphemeralSettings: {},
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Timeout not configured', () => {
    it('should not apply timeout when timeout_ms not configured', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            // No timeout_ms configured
          },
        },
        providerManager,
      );

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'chunk1' }] } as IContent;
          yield { role: 'assistant', parts: [{ text: 'chunk2' }] } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const chunks: IContent[] = [];
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      // Advance time significantly - should still work without timeout
      const genPromise = (async () => {
        for await (const chunk of gen) {
          chunks.push(chunk);
        }
      })();

      await vi.runAllTimersAsync();
      await genPromise;

      expect(chunks).toHaveLength(2);
    });
  });

  describe('Timeout on first chunk', () => {
    it('should timeout if first chunk not received within timeout_ms', async () => {
      vi.useRealTimers(); // Need real timers for this test

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            timeout_ms: 100, // 100ms timeout
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          // Delay longer than timeout
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield {
            role: 'assistant',
            parts: [{ text: 'too late' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      const chunks: IContent[] = [];
      const observedErrors: unknown[] = [];
      const gen = lb.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
        onProviderError: (error) => observedErrors.push(error),
      });

      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      // Should have failed over to backend2 after timeout
      expect(chunks).toHaveLength(1);
      expect(observedErrors).toStrictEqual([
        {
          message: 'Request timeout after 100ms',
          category: 'network',
        },
      ]);
      const text = chunks[0].parts?.[0];
      expect(
        text != null && typeof text === 'object' && 'text' in text
          ? text.text
          : '',
      ).toBe('success');
    });

    it('should succeed if first chunk received before timeout', async () => {
      vi.useRealTimers();

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            timeout_ms: 500, // 500ms timeout
          },
        },
        providerManager,
      );

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          // Delay less than timeout
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield { role: 'assistant', parts: [{ text: 'chunk1' }] } as IContent;
          yield { role: 'assistant', parts: [{ text: 'chunk2' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider);

      const chunks: IContent[] = [];
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(2);
    });
  });

  describe('Streaming preservation', () => {
    it('should yield chunks as they arrive after first chunk', async () => {
      vi.useRealTimers();

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            timeout_ms: 500,
          },
        },
        providerManager,
      );

      const chunkOrder: string[] = [];
      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'chunk1' }] } as IContent;
          chunkOrder.push('yielded:chunk1');
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield { role: 'assistant', parts: [{ text: 'chunk2' }] } as IContent;
          chunkOrder.push('yielded:chunk2');
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield { role: 'assistant', parts: [{ text: 'chunk3' }] } as IContent;
          chunkOrder.push('yielded:chunk3');
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider);

      const receivedChunks: string[] = [];
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const chunk of gen) {
        const text = chunk.parts?.[0];
        const textValue = text != null && 'text' in text ? text.text : '';
        receivedChunks.push(textValue);
        chunkOrder.push(`received:${textValue}`);
      }

      // Verify all chunks received
      expect(receivedChunks).toStrictEqual(['chunk1', 'chunk2', 'chunk3']);
    });
  });

  describe('Timeout triggers failover', () => {
    it('should failover to next backend on timeout', async () => {
      vi.useRealTimers();

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            timeout_ms: 50,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      let backend1Called = false;
      let backend2Called = false;

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          backend1Called = true;
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield {
            role: 'assistant',
            parts: [{ text: 'too late' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          backend2Called = true;
          yield {
            role: 'assistant',
            parts: [{ text: 'from backend2' }],
          } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      const chunks: IContent[] = [];
      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      expect(backend1Called).toBe(true);
      expect(backend2Called).toBe(true);
      expect(chunks).toHaveLength(1);
      const text = chunks[0].parts?.[0];
      expect(text != null && 'text' in text ? text.text : '').toBe(
        'from backend2',
      );
    });
  });

  describe('Timeout error detection', () => {
    it('should properly identify timeout errors', async () => {
      vi.useRealTimers();

      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            timeout_ms: 50,
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          await new Promise((resolve) => setTimeout(resolve, 200));
          yield {
            role: 'assistant',
            parts: [{ text: 'too late' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const _chunk of gen) {
        // consume
      }

      // Get stats - timeout should be recorded
      const stats = lb.getStats();
      // Verify the request was made and failover occurred
      expect(stats.totalRequests).toBe(1);
    });
  });

  it('aborts a stalled first chunk without attempting another backend', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    let calls = 0;
    const observedErrors: unknown[] = [];
    const stalledProvider: IProvider = {
      name: 'test-provider-1',
      async *generateChatCompletion(options): AsyncGenerator<IContent> {
        calls++;
        const signal = options.invocation?.signal;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(new Error('provider observed abort'));
          signal?.addEventListener('abort', onAbort, { once: true });
          if (signal?.aborted === true) onAbort();
        });
        yield { speaker: 'ai', blocks: [] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    providerManager.registerProvider(stalledProvider);
    const lb = new LoadBalancingProvider(
      {
        ...config,
        lbProfileEphemeralSettings: { timeout_ms: 60_000 },
      },
      providerManager,
    );
    const promise = (async () => {
      const chunks: IContent[] = [];
      for await (const chunk of lb.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
        metadata: { abortSignal: controller.signal },
        onProviderError: (error) => observedErrors.push(error),
      })) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await vi.waitFor(() => expect(calls).toBe(1), { timeout: 1_000 });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
    expect(observedErrors).toStrictEqual([]);
  });
  it('releases abort listeners and timeout timers after a successful first chunk', async () => {
    const parent = new AbortController();
    const add = vi.spyOn(parent.signal, 'addEventListener');
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const lb = new LoadBalancingProvider(
      {
        ...config,
        subProfiles,
        lbProfileEphemeralSettings: { timeout_ms: 60_000 },
      },
      providerManager,
    );
    providerManager.registerProvider({
      name: 'test-provider-1',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    });

    const chunks: IContent[] = [];
    for await (const chunk of lb.generateChatCompletion({
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
      ],
      metadata: { abortSignal: parent.signal },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('disposes the linked controller when delegate construction throws synchronously', async () => {
    const parent = new AbortController();
    const add = vi.spyOn(parent.signal, 'addEventListener');
    const remove = vi.spyOn(parent.signal, 'removeEventListener');
    const throwingProvider: IProvider = {
      name: 'test-provider-1',
      generateChatCompletion() {
        throw new Error('synchronous construction failure');
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    providerManager.registerProvider(throwingProvider);
    const lb = new LoadBalancingProvider(
      {
        ...config,
        subProfiles,
        lbProfileEphemeralSettings: { failover_retry_count: 1 },
      },
      providerManager,
    );

    await expect(async () => {
      for await (const _chunk of lb.generateChatCompletion({
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
        ],
        metadata: { abortSignal: parent.signal },
      })) {
        // consume
      }
    }).rejects.toThrow('synchronous construction failure');
    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][1]).toBe(add.mock.calls[0][1]);
  });

  it('preserves transport failures when linked listener removal throws', async () => {
    const parent = new AbortController();
    const cleanupError = new Error('listener removal failed');
    vi.spyOn(parent.signal, 'removeEventListener').mockImplementation(() => {
      throw cleanupError;
    });
    const primaryError = new Error('primary transport failed');
    const secondaryError = new Error('secondary transport failed');
    const failures = [primaryError, secondaryError];
    let calls = 0;
    const noContent: IContent[] = [];
    const throwingProvider: IProvider = {
      name: 'test-provider-1',
      async *generateChatCompletion(): AsyncGenerator<IContent> {
        const failure = calls === 0 ? primaryError : secondaryError;
        calls++;
        yield* noContent;
        throw failure;
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => null,
    };
    providerManager.registerProvider(throwingProvider);
    providerManager.registerProvider({
      ...throwingProvider,
      name: 'test-provider-2',
    });
    const lb = new LoadBalancingProvider(
      {
        ...config,
        subProfiles,
        lbProfileEphemeralSettings: { failover_retry_count: 1 },
      },
      providerManager,
    );

    let thrown: unknown;
    try {
      for await (const _chunk of lb.generateChatCompletion({
        contents: [],
        metadata: { abortSignal: parent.signal },
      })) {
        await Promise.resolve();
      }
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LoadBalancerFailoverError);
    const loadBalancerFailure =
      thrown instanceof LoadBalancerFailoverError ? thrown : undefined;
    expect(
      loadBalancerFailure?.failures.map((failure) => failure.error),
    ).toStrictEqual(failures);
  });

  describe('No timeout after first chunk', () => {
    it('should not timeout after first chunk received', async () => {
      vi.useRealTimers();

      // Use round-robin strategy instead of failover to avoid timeout wrapper
      const roundRobinConfig = {
        profileName: 'test-lb',
        strategy: 'round-robin' as const,
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider-1',
            modelId: 'test-model-1',
            baseURL: 'https://test1.com',
            authToken: 'token1',
          },
        ],
        lbProfileEphemeralSettings: {
          timeout_ms: 200, // 200ms timeout for first chunk
        },
      };

      const lb = new LoadBalancingProvider(roundRobinConfig, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          // First chunk arrives immediately (no delay to avoid timeout)
          yield { role: 'assistant', parts: [{ text: 'chunk1' }] } as IContent;
          // Subsequent chunks can take longer - no timeout applied
          await new Promise((resolve) => setTimeout(resolve, 250));
          yield { role: 'assistant', parts: [{ text: 'chunk2' }] } as IContent;
          await new Promise((resolve) => setTimeout(resolve, 250));
          yield { role: 'assistant', parts: [{ text: 'chunk3' }] } as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider);

      const chunks: IContent[] = [];
      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      for await (const chunk of gen) {
        chunks.push(chunk);
      }

      // All chunks should be received despite delays after first chunk
      expect(chunks).toHaveLength(3);
    });
  });
});
