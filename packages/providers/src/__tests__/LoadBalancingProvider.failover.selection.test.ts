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
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('LoadBalancingProvider - Failover Strategy', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  describe('Strategy Selection', () => {
    it('should accept strategy: "failover" in configuration', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'sub2',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
      expect(provider.name).toBe('load-balancer');
    });

    it('accepts strategy: "round-robin" as the provider contract default', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-roundrobin',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      expect(provider).toBeDefined();
    });

    it('should throw error for invalid strategy value', () => {
      const lbConfig = {
        profileName: 'test-invalid',
        strategy: 'invalid-strategy',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      } as unknown as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/invalid.*strategy/i);
    });

    it('should include both valid strategies in error message', () => {
      const lbConfig = {
        profileName: 'test-invalid',
        strategy: 'bad-strategy',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'gemini',
            modelId: 'test-model',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      } as unknown as LoadBalancingProviderConfig;

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/(round-robin|failover)/i);
    });
  });
  describe('Sequential Execution on Errors', () => {
    it('should call first backend first', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'response from first' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-sequential',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from first',
      });
    });

    it('should call second backend when first fails', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('first backend error');
          }
          yield { type: 'text' as const, content: 'response from second' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover-second',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from second',
      });
    });

    it('should call third backend when first two fail', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('first backend error');
          }
          if (callCount === 2) {
            throw new Error('second backend error');
          }
          yield { type: 'text' as const, content: 'response from third' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover-third',
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
          {
            name: 'third',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'response from third',
      });
    });
  });
  describe('Stop-at-First-Success Behavior', () => {
    it('should return immediately when first backend succeeds', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-stop-at-success',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });

    it('should not call second backend when first succeeds', async () => {
      let firstCalled = false;
      let secondCalled = false;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          const modelId = options.resolved?.model ?? '';
          if (modelId === 'model1') {
            firstCalled = true;
            yield { type: 'text' as const, content: 'first success' };
          } else if (modelId === 'model2') {
            secondCalled = true;
            yield { type: 'text' as const, content: 'second success' };
          }
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-no-second-call',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(firstCalled).toBe(true);
      expect(secondCalled).toBe(false);
    });

    it('should return response from successful backend', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          if (callCount === 1) {
            throw new Error('first failed');
          }
          yield { type: 'text' as const, content: 'correct response' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-correct-response',
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

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results[0]).toStrictEqual({
        type: 'text',
        content: 'correct response',
      });
    });

    it('should NOT inherit parent resolved authToken when sub-profile omits it (issue #2132)', async () => {
      const captured: Array<{ baseURL?: string; authToken?: string }> = [];

      const mockProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({
            baseURL: options.resolved?.baseURL,
            authToken: options.resolved?.authToken,
          });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-no-authtoken-leak',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            // baseURL/authToken intentionally omitted
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            // baseURL/authToken intentionally omitted
          },
        ],
      };

      try {
        const provider = new LoadBalancingProvider(lbConfig, providerManager);
        const options: GenerateChatOptions = {
          contents: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
          ],
          resolved: {
            model: 'original-model',
            baseURL: 'https://original.api.com',
            authToken: 'original-token',
          },
        };

        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }

        expect(results).toHaveLength(1);
        // baseURL is still inherited (per design), but authToken must NOT leak
        expect(captured).toStrictEqual([
          {
            baseURL: 'https://original.api.com',
            authToken: undefined,
          },
        ]);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should override resolved baseURL when sub-profile provides one', async () => {
      const captured: Array<{ baseURL?: string }> = [];

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({ baseURL: options.resolved?.baseURL });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-override-baseurl',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            baseURL: 'https://subprofile.api.com',
            authToken: 'sub-token',
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://subprofile.api.com',
            authToken: 'sub-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        resolved: {
          model: 'original-model',
          baseURL: 'https://original.api.com',
          authToken: 'original-token',
        },
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(captured).toStrictEqual([
        { baseURL: 'https://subprofile.api.com' },
      ]);
    });

    it('should override resolved authToken when sub-profile provides one', async () => {
      const captured: Array<{ authToken?: string }> = [];

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          captured.push({ authToken: options.resolved?.authToken });
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-override-authtoken',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            authToken: 'subprofile-token',
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            authToken: 'subprofile-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);
      const options: GenerateChatOptions = {
        prompt: 'test prompt',
        messages: [{ role: 'user' as const, content: 'test' }],
        resolved: {
          model: 'original-model',
          baseURL: 'https://original.api.com',
          authToken: 'original-token',
        },
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
      expect(captured).toStrictEqual([{ authToken: 'subprofile-token' }]);
    });
  });

  describe('AuthToken isolation on failover path (issue #2132)', () => {
    it('should NOT leak parent authToken to failover delegate when sub-profile omits it', async () => {
      let callCount = 0;
      const capturedAuthTokens: Array<string | undefined> = [];

      const mockProvider = {
        name: 'test-provider',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncGenerator<IContent> {
          callCount++;
          capturedAuthTokens.push(options.resolved?.authToken);
          if (callCount === 1) {
            throw new Error('first backend error');
          }
          yield { type: 'text' as const, content: 'success from second' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
        getServerTools: () => [],
        invokeServerTool: async () => ({ content: [] }),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-failover-auth-isolation',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'first',
            providerName: 'test-provider',
            modelId: 'model1',
            // authToken intentionally omitted
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            // authToken intentionally omitted
          },
        ],
      };

      try {
        const provider = new LoadBalancingProvider(lbConfig, providerManager);
        const options: GenerateChatOptions = {
          contents: [
            { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
          ],
          resolved: {
            model: 'parent-model',
            authToken: 'leaked-opus-token',
          },
        };

        const results: IContent[] = [];
        for await (const chunk of provider.generateChatCompletion(options)) {
          results.push(chunk);
        }

        expect(results).toHaveLength(1);
        // Both delegates must have authToken = undefined, not the leaked parent token
        expect(capturedAuthTokens).toStrictEqual([undefined, undefined]);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
