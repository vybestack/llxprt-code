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

  describe('Aggregated Error When All Backends Fail', () => {
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
