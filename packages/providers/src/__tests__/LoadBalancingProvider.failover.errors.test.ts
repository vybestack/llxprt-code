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
import { LoadBalancerFailoverError, RetriesExhaustedError } from '../errors.js';
import { MAX_PUBLIC_PROVIDER_MESSAGE_LENGTH } from '../providerErrorObservation.js';
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

  describe('Aggregated Error When All Backends Fail', () => {
    it('fails over to the next backend after a retryable nested load balancer failure', async () => {
      const transientFailure = Object.assign(new Error('nested unavailable'), {
        status: 503,
      });
      const nestedFailure = new LoadBalancerFailoverError('nested-profile', [
        { profile: 'nested-backend', error: transientFailure },
      ]);
      const noContent: IContent[] = [];
      let calls = 0;
      const delegate: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          calls++;
          if (calls === 1) {
            yield* noContent;
            throw nestedFailure;
          }
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      providerManager.registerProvider(delegate);
      const provider = new LoadBalancingProvider(
        {
          profileName: 'outer-profile',
          strategy: 'failover',
          subProfiles: [
            {
              name: 'primary',
              providerName: 'test-provider',
              modelId: 'model-1',
              baseURL: 'https://primary.test',
              authToken: 'token-1',
            },
            {
              name: 'secondary',
              providerName: 'test-provider',
              modelId: 'model-2',
              baseURL: 'https://secondary.test',
              authToken: 'token-2',
            },
          ],
        },
        providerManager,
      );
      const chunks: IContent[] = [];

      for await (const chunk of provider.generateChatCompletion({
        contents: [],
      })) {
        chunks.push(chunk);
      }

      expect(chunks).toStrictEqual([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] },
      ]);
      expect(calls).toBe(2);
    });

    it('propagates a retryable nested load balancer failure after yielding content', async () => {
      const nestedFailure = new LoadBalancerFailoverError('nested-profile', [
        {
          profile: 'nested-primary',
          error: Object.assign(new Error('nested primary unavailable'), {
            status: 503,
          }),
        },
        {
          profile: 'nested-secondary',
          error: Object.assign(new Error('nested secondary unavailable'), {
            status: 503,
          }),
        },
      ]);
      const content: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial response' }],
      };
      let primaryCalls = 0;
      let secondaryCalls = 0;
      const primary: IProvider = {
        name: 'primary-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          primaryCalls++;
          yield content;
          throw nestedFailure;
        },
        getModels: async () => [],
        getDefaultModel: () => 'primary-model',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      const secondary: IProvider = {
        name: 'secondary-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          secondaryCalls++;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'unexpected' }],
          };
        },
        getModels: async () => [],
        getDefaultModel: () => 'secondary-model',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      providerManager.registerProvider(primary);
      providerManager.registerProvider(secondary);
      const provider = new LoadBalancingProvider(
        {
          profileName: 'outer-profile',
          strategy: 'failover',
          subProfiles: [
            {
              name: 'primary',
              providerName: 'primary-provider',
              modelId: 'primary-model',
              baseURL: 'https://primary.test',
              authToken: 'primary-token',
            },
            {
              name: 'secondary',
              providerName: 'secondary-provider',
              modelId: 'secondary-model',
              baseURL: 'https://secondary.test',
              authToken: 'secondary-token',
            },
          ],
        },
        providerManager,
      );
      const chunks: IContent[] = [];
      let thrown: unknown;

      try {
        for await (const chunk of provider.generateChatCompletion({
          contents: [],
        })) {
          chunks.push(chunk);
        }
      } catch (error) {
        thrown = error;
      }

      expect(chunks).toStrictEqual([content]);
      expect(thrown).toBe(nestedFailure);
      expect(primaryCalls).toBe(1);
      expect(secondaryCalls).toBe(0);
    });

    it('does not fail over after a terminal retries-exhausted failure', async () => {
      const terminalFailure = new RetriesExhaustedError(
        'transport retries exhausted',
        'server_error',
        { cause: new Error('last transport failure') },
      );
      let calls = 0;
      const delegate: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          calls++;
          if (calls === 1) throw terminalFailure;
          yield {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'unexpected' }],
          };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      providerManager.registerProvider(delegate);
      const provider = new LoadBalancingProvider(
        {
          profileName: 'outer-profile',
          strategy: 'failover',
          subProfiles: [
            {
              name: 'primary',
              providerName: 'test-provider',
              modelId: 'model-1',
              baseURL: 'https://primary.test',
              authToken: 'token-1',
            },
            {
              name: 'secondary',
              providerName: 'test-provider',
              modelId: 'model-2',
              baseURL: 'https://secondary.test',
              authToken: 'token-2',
            },
          ],
        },
        providerManager,
      );

      await expect(async () => {
        for await (const _chunk of provider.generateChatCompletion({
          contents: [],
        })) {
          await Promise.resolve();
        }
      }).rejects.toBe(terminalFailure);
      expect(calls).toBe(1);
    });

    it('observes the same backend error once per reused request lifecycle', async () => {
      const sharedFailure = new Error('shared backend failure');
      const noContent: IContent[] = [];
      const delegate: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield* noContent;
          throw sharedFailure;
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => null,
      };
      providerManager.registerProvider(delegate);
      const provider = new LoadBalancingProvider(
        {
          profileName: 'observation-profile',
          strategy: 'failover',
          subProfiles: [
            {
              name: 'primary',
              providerName: 'test-provider',
              modelId: 'model-1',
              baseURL: 'https://primary.test',
              authToken: 'token-1',
            },
            {
              name: 'secondary',
              providerName: 'test-provider',
              modelId: 'model-2',
              baseURL: 'https://secondary.test',
              authToken: 'token-2',
            },
          ],
        },
        providerManager,
      );
      const observed: unknown[] = [];
      const options: GenerateChatOptions = {
        contents: [],
        onProviderError: (error) => observed.push(error),
      };

      for (let request = 0; request < 2; request++) {
        await expect(async () => {
          for await (const _chunk of provider.generateChatCompletion(options)) {
            await Promise.resolve();
          }
        }).rejects.toBeInstanceOf(LoadBalancerFailoverError);
      }

      expect(observed).toHaveLength(2);
    });

    it('should throw LoadBalancerFailoverError when all backends fail', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-all-fail',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'second',
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
        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }
      }).rejects.toThrow(/failover/i);
    });

    it('should include profile name in error message', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'my-test-profile',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'second',
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
        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }
      }).rejects.toThrow(/my-test-profile/i);
    });

    it('should include all backend names that failed', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-profile',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'backend-one',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'backend-two',
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
        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }
      }).rejects.toThrow(/(backend-one|backend-two)/i);
    });

    it('includes per-backend failure messages when multiple backends fail', async () => {
      let callCount = 0;
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('rate limited by vendor');
          }
          if (callCount === 2) {
            throw new Error('authentication failed');
          }
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-per-backend-msg',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'zai',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'glm51',
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
        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }
      }).rejects.toThrow(
        'zai: rate limited by vendor; glm51: authentication failed',
      );
    });

    it('includes HTTP status codes in per-backend summary when available', async () => {
      let callCount = 0;
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            const error = new Error('Unauthorized') as Error & {
              status: number;
            };
            error.status = 401;
            throw error;
          }
          if (callCount === 2) {
            const error = new Error('Rate limit') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield undefined as unknown as IContent; // unreachable
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-per-backend-status',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'zai',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'glm51',
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
        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }
      }).rejects.toThrow(
        'zai: Unauthorized (status: 401); glm51: Rate limit (status: 429)',
      );
    });

    it('preserves single-failure message format for backward compatibility', () => {
      // Test the error class directly since failover requires 2+ backends.
      // When only one failure is recorded, the error message should be the
      // raw error message (not the per-backend summary format).
      const error = new LoadBalancerFailoverError('test-profile', [
        { profile: 'sole', error: new Error('only backend failed') },
      ]);

      expect(error.message).toContain('only backend failed');
      expect(error.message).toContain('sole: only backend failed');
      expect(error.message).toContain('test-profile');
      expect(error.message).toContain('sole');
    });

    it('uses diagnostic fallback when no backend attempts were recorded', () => {
      const error = new LoadBalancerFailoverError('test-profile', []);

      expect(error.message).toContain('no backend attempts were recorded');
      expect(error.message).toContain('(tried: none)');
    });

    it('keeps public summaries bounded while preserving every structured failure', () => {
      const failures = Array.from({ length: 5 }, (_, index) => ({
        profile: `backend-${index + 1}`,
        error: new Error(`private failure ${index + 1}`),
      }));

      const error = new LoadBalancerFailoverError('test-profile', failures);

      expect(error.message.length).toBeLessThanOrEqual(
        MAX_PUBLIC_PROVIDER_MESSAGE_LENGTH,
      );
      expect(error.message).toContain('+2 more');
      expect(error.message).not.toContain('private failure 4');
      expect(error.failures).toStrictEqual(failures);
    });
  });
  describe('ResolvedSubProfile settings propagation', () => {
    it('applies sub-profile ephemerals and modelParams on the failover path', async () => {
      const provider = new LoadBalancingProvider(
        {
          profileName: 'failover-settings-test',
          strategy: 'failover',
          subProfiles: [
            {
              name: 'primary',
              providerName: 'gemini',
              model: 'gemini-flash',
              baseURL: 'https://primary.example.com',
              authToken: 'primary-token',
              ephemeralSettings: {
                temperature: 0.2,
                'reasoning.enabled': true,
              },
              modelParams: { topP: 0.8 },
            },
            {
              name: 'secondary',
              providerName: 'gemini',
              model: 'gemini-pro',
              ephemeralSettings: {},
              modelParams: {},
            },
          ],
          lbProfileModelParams: { topK: 40 },
        },
        providerManager,
      );

      let capturedOptions: GenerateChatOptions | undefined;
      let invocationCount = 0;
      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          invocationCount += 1;
          capturedOptions = options;
          if (invocationCount === 1) {
            const error = new Error('primary rate limited') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          settings: settingsService,
          config,
          runtime: { settingsService, config },
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        expect(invocationCount).toBe(2);
        expect(capturedOptions?.resolved).toMatchObject({
          model: 'gemini-pro',
        });
        expect(capturedOptions?.resolved).not.toHaveProperty('baseURL');
        expect(capturedOptions?.resolved).not.toHaveProperty('authToken');
        expect(capturedOptions?.resolved).not.toHaveProperty('temperature');
        expect(
          capturedOptions?.invocation?.getModelBehavior('reasoning.enabled'),
        ).toBeUndefined();
        expect(capturedOptions?.invocation?.modelParams).toMatchObject({
          topK: 40,
        });
        expect(capturedOptions?.invocation?.modelParams).not.toHaveProperty(
          'topP',
        );
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
