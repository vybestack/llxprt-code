/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 5: Metrics Collection Tests
 * Issue #489 - Advanced Failover with Metrics
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
  type LoadBalancerSubProfile,
} from '../LoadBalancingProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import type { IContent } from '../../services/history/IContent.js';

describe('LoadBalancingProvider Metrics Collection - Phase 5', () => {
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
    providerManager = new ProviderManager();
    config = {
      profileName: 'test-lb',
      strategy: 'failover',
      subProfiles,
      lbProfileEphemeralSettings: {},
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('Metrics initialization', () => {
    it('should start with empty backend metrics', () => {
      const lb = new LoadBalancingProvider(config, providerManager);
      const stats = lb.getStats();

      expect(stats.backendMetrics).toEqual({});
    });
  });

  describe('Request counting', () => {
    it('should increment request count on each attempt', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      // Make 3 requests
      for (let i = 0; i < 3; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.requests).toBe(3);
    });
  });

  describe('Success counting', () => {
    it('should increment success count on successful completion', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { role: 'assistant', parts: [{ text: 'success' }] } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.successes).toBe(1);
    });
  });

  describe('Failure counting', () => {
    it('should increment failure count on error', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failure');
          yield; // Never reached
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

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.failures).toBe(1);
      expect(stats.backendMetrics.backend1.requests).toBe(1);
    });
  });

  describe('Timeout counting', () => {
    it('should increment timeout count on timeout error', async () => {
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

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.timeouts).toBe(1);
      expect(stats.backendMetrics.backend1.failures).toBe(1);
    });
  });

  describe('Token counting', () => {
    it('should accumulate tokens correctly', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 50,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      // Make 2 requests
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        for await (const _chunk of gen) {
          // consume
        }
      }

      const stats = lb.getStats();
      // 2 requests * 150 tokens = 300 total
      expect(stats.backendMetrics.backend1.tokens).toBe(300);
    });
  });

  describe('Latency tracking', () => {
    it('should calculate latency from start to finish', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          await new Promise((resolve) => setTimeout(resolve, 50));
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });

      const consume = (async () => {
        for await (const _chunk of gen) {
          // consume
        }
      })();

      await vi.advanceTimersByTimeAsync(50);
      await consume;

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.totalLatencyMs).toBe(50);
      expect(stats.backendMetrics.backend1.avgLatencyMs).toBe(50);
    });

    it('should compute average latency correctly', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(0);

      const lb = new LoadBalancingProvider(config, providerManager);

      let callCount = 0;
      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call: ~50ms, Second call: ~100ms
          const delay = callCount === 1 ? 50 : 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      // Make 2 requests
      for (let i = 0; i < 2; i++) {
        const gen = lb.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: `test${i}` }] }],
        });
        const expectedDelay = i === 0 ? 50 : 100;
        const consume = (async () => {
          for await (const _chunk of gen) {
            // consume
          }
        })();
        await vi.advanceTimersByTimeAsync(expectedDelay);
        await consume;
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.totalLatencyMs).toBe(150);
      expect(stats.backendMetrics.backend1.avgLatencyMs).toBe(75);
    });
  });

  describe('Token extraction', () => {
    it('should handle Gemini response format', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 200,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.tokens).toBe(300);
    });

    it('should handle Anthropic response format', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
            usage: {
              input_tokens: 50,
              output_tokens: 150,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.tokens).toBe(200);
    });

    it('should handle OpenAI response format', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response' }],
            usage: {
              prompt_tokens: 75,
              completion_tokens: 125,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.tokens).toBe(200);
    });

    it('should return 0 for missing token information', async () => {
      const lb = new LoadBalancingProvider(config, providerManager);

      const mockProvider = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'response without usage info' }],
          } as IContent;
        },
        getServerTools: () => [],
      };
      providerManager.registerProvider(mockProvider);

      const gen = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test' }] }],
      });
      for await (const _chunk of gen) {
        // consume
      }

      const stats = lb.getStats();
      expect(stats.backendMetrics.backend1.tokens).toBe(0);
    });
  });

  describe('Combined metrics', () => {
    it('should track all metrics correctly across multiple backends', async () => {
      const lb = new LoadBalancingProvider(
        {
          ...config,
          lbProfileEphemeralSettings: {
            failover_retry_count: 1,
          },
        },
        providerManager,
      );

      let backend1Calls = 0;
      const mockProvider1 = {
        name: 'test-provider-1',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          backend1Calls++;
          if (backend1Calls === 1) {
            throw new Error('Backend1 fails first time');
            yield; // Never reached
          }
          yield {
            role: 'assistant',
            parts: [{ text: 'success' }],
            usageMetadata: {
              promptTokenCount: 50,
              candidatesTokenCount: 50,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };
      const mockProvider2 = {
        name: 'test-provider-2',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield {
            role: 'assistant',
            parts: [{ text: 'backend2 success' }],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 100,
            },
          } as unknown as IContent;
        },
        getServerTools: () => [],
      };

      providerManager.registerProvider(mockProvider1);
      providerManager.registerProvider(mockProvider2);

      // First request: backend1 fails, failover to backend2
      const gen1 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
      });
      for await (const _chunk of gen1) {
        // consume
      }

      // Second request: backend1 now succeeds
      const gen2 = lb.generateChatCompletion({
        contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
      });
      for await (const _chunk of gen2) {
        // consume
      }

      const stats = lb.getStats();

      // Backend1: 2 requests (1 failure + 1 success)
      expect(stats.backendMetrics.backend1.requests).toBe(2);
      expect(stats.backendMetrics.backend1.successes).toBe(1);
      expect(stats.backendMetrics.backend1.failures).toBe(1);
      expect(stats.backendMetrics.backend1.tokens).toBe(100);

      // Backend2: 1 request (1 success from failover)
      expect(stats.backendMetrics.backend2.requests).toBe(1);
      expect(stats.backendMetrics.backend2.successes).toBe(1);
      expect(stats.backendMetrics.backend2.failures).toBe(0);
      expect(stats.backendMetrics.backend2.tokens).toBe(200);
    });
  });
});
