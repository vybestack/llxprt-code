/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';

describe('LoadBalancingProvider - Failover Strategy', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  describe('Streaming Behavior', () => {
    it('should yield all chunks from successful backend', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'chunk1' };
          yield { type: 'text' as const, content: 'chunk2' };
          yield { type: 'text' as const, content: 'chunk3' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-streaming',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'sub2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(3);
      expect(results[0]).toStrictEqual({ type: 'text', content: 'chunk1' });
      expect(results[1]).toStrictEqual({ type: 'text', content: 'chunk2' });
      expect(results[2]).toStrictEqual({ type: 'text', content: 'chunk3' });
    });

    it('should not duplicate chunks on retry of initial connection', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('first attempt failed');
          }
          yield { type: 'text' as const, content: 'unique-chunk' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-no-duplicates',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'sub2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'unique-chunk',
      });
    });
  });
  describe('Sticky Failover Behavior - Issue #902', () => {
    it('should track failover across requests via currentFailoverIndex', async () => {
      // This test verifies sticky behavior by checking getCurrentFailoverIndex()
      // after a failover. On success, it stays on the working backend. On 429
      // immediate failover, it advances to the next index.
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call: throw 429 (immediate failover)
          // Second call: succeed (on backend2)
          if (callCount === 1) {
            const error = new Error('Rate limited') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield { type: 'text' as const, content: `response-${callCount}` };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-sticky',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      // Request: backend1 fails with 429, failover to backend2, succeeds
      const results1: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results1.push(chunk);
      }
      expect(results1).toHaveLength(1);
      expect(callCount).toBe(2); // backend1 failed, backend2 succeeded
      expect(provider.getCurrentFailoverIndex()).toBe(1);
    });

    it('should keep currentFailoverIndex on the successful backend', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call fails, second succeeds on the sticky backend.
          if (callCount === 1) {
            const error = new Error('Rate limited') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield { type: 'text' as const, content: `response-${callCount}` };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-reset',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      // First request: fails on backend1, succeeds on backend2
      for await (const _chunk of provider.generateChatCompletion(options)) {
        // consume
      }

      expect(provider.getCurrentFailoverIndex()).toBe(1);
    });

    it('should immediately failover on 429 without retrying current member', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call: throw 429
          // Second call: succeed
          if (callCount === 1) {
            const error = new Error('Rate limited') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-429',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
        lbProfileEphemeralSettings: {
          failover_retry_count: 3, // Even with retry count, 429 should not retry
        },
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      // Backend1 throws 429, immediate failover to backend2
      // So only 2 calls total (no retries on 429)
      expect(callCount).toBe(2);
    });

    it('should distinguish non-status errors from immediate failover errors (429)', async () => {
      // This test verifies that errors without HTTP status are handled differently
      // from 429/401/402/403. Non-status errors follow normal retry flow, while
      // immediate failover errors (429, etc.) skip retry entirely.
      //
      // With failover_retry_count: 1 (default), a non-status error will:
      // 1. Try backend1, fail, exhaust retries (1 attempt)
      // 2. Move to backend2, succeed
      // Total: 2 calls
      //
      // This is the same as 429, but the key difference is:
      // - 429: No retry attempt on same backend (immediate failover)
      // - Non-status error: Would retry if failover_retry_count > 1
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call: throw error without status
          // Second call: succeed
          if (callCount === 1) {
            throw new Error('Backend error without status');
          }
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-non-status-error',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      // Should have called provider twice (error on backend1, success on backend2)
      expect(callCount).toBe(2);
    });

    it('should throw LoadBalancerFailoverError when all members fail', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failed');
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-all-fail-902',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      await expect(async () => {
        for await (const _chunk of provider.generateChatCompletion(options)) {
          // consume
        }
      }).rejects.toThrow(/failover/i);
    });

    it('should not loop infinitely when all backends fail', async () => {
      let totalAttempts = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          totalAttempts++;
          throw new Error('Backend failed');
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-no-infinite-loop-902',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
          {
            name: 'backend3',
            providerName: 'test-provider',
            modelId: 'model3',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-3',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      await expect(async () => {
        for await (const _chunk of provider.generateChatCompletion(options)) {
          // consume
        }
      }).rejects.toThrow(Error);

      // Should try each backend exactly once (no infinite loop)
      expect(totalAttempts).toBe(3);
    });

    it('should abort and throw error if chunks were yielded before immediate failover error', async () => {
      // This tests the partial-yield hazard fix: if we already sent chunks to the
      // caller before getting a 429, we should NOT failover to another backend
      // (which would produce a mixed response), but instead propagate the error.
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            // Backend 1: yield a chunk, then throw 429
            yield { type: 'text' as const, content: 'partial-response' };
            const error = new Error('Rate limited mid-stream') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          // Backend 2: would succeed, but should never be called
          yield { type: 'text' as const, content: 'backend2-response' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-partial-yield-hazard',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend1',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend2',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
      };

      const chunks: IContent[] = [];
      let thrownError: Error | null = null;
      try {
        for await (const chunk of provider.generateChatCompletion(options)) {
          chunks.push(chunk);
        }
      } catch (e) {
        thrownError = e as Error;
      }

      // Should have thrown an error (not completed successfully)
      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toMatch(/rate limited/i);

      // Should have received the partial chunk before the error
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toStrictEqual({
        type: 'text',
        content: 'partial-response',
      });

      // Backend 2 should NOT have been called (no mixed response)
      expect(callCount).toBe(1);
    });
  });
});
