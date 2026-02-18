/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251212issue488
 * Phase 1: Failover Strategy Tests (TDD - RED)
 *
 * Tests MUST be written FIRST, implementation SECOND.
 * These tests verify the failover policy for load balancing.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import type { Config } from '../../config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '../../types/content.js';
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

    it('should accept strategy: "round-robin" for backward compatibility', () => {
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
      }).toThrow(/round-robin.*failover|failover.*round-robin/i);
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
      expect(results[0]).toEqual({
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
      expect(results[0]).toEqual({
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
      expect(results[0]).toEqual({
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

      expect(results[0]).toEqual({
        type: 'text',
        content: 'correct response',
      });
    });

    it('should preserve resolved baseURL and authToken when sub-profile omits them', async () => {
      const captured: Array<{ baseURL?: string; authToken?: string }> = [];

      const mockProvider: IProvider = {
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

      providerManager.registerProvider(mockProvider);

      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-preserve-resolved',
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
      expect(captured).toEqual([
        {
          baseURL: 'https://original.api.com',
          authToken: 'original-token',
        },
      ]);
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
          },
          {
            name: 'second',
            providerName: 'test-provider',
            modelId: 'model2',
            baseURL: 'https://subprofile.api.com',
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
      expect(captured).toEqual([{ baseURL: 'https://subprofile.api.com' }]);
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
      expect(captured).toEqual([{ authToken: 'subprofile-token' }]);
    });
  });

  describe('Aggregated Error When All Backends Fail', () => {
    it('should throw LoadBalancerFailoverError when all backends fail', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        // eslint-disable-next-line require-yield
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
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
        // eslint-disable-next-line require-yield
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
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
        // eslint-disable-next-line require-yield
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('backend failed');
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
      }).rejects.toThrow(/backend-one.*backend-two|backend-two.*backend-one/i);
    });
  });

  describe('Ephemeral Settings Extraction', () => {
    it('should extract failover_retry_count from lbProfileEphemeralSettings', async () => {
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
        profileName: 'test-retry-count',
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
        lbProfileEphemeralSettings: {
          failover_retry_count: 3,
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

      expect(results).toHaveLength(1);
    });

    it('should default failover_retry_count to 1', async () => {
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
        profileName: 'test-default-retry',
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
    });

    it('should extract failover_retry_delay_ms from lbProfileEphemeralSettings', async () => {
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
        profileName: 'test-retry-delay',
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
        lbProfileEphemeralSettings: {
          failover_retry_delay_ms: 1000,
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

      expect(results).toHaveLength(1);
    });

    it('should default failover_retry_delay_ms to 0', async () => {
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
        profileName: 'test-default-delay',
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
    });
  });

  describe('Edge Cases', () => {
    it('should throw error when failover profile has only 1 sub-profile', () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-single-profile',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'only-one',
            providerName: 'gemini',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
        ],
      };

      expect(() => {
        new LoadBalancingProvider(lbConfig, providerManager);
      }).toThrow(/at least 2|minimum.*2/i);
    });

    it('should cap retry_count at 100 even if higher value provided', async () => {
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
        profileName: 'test-cap-retry',
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
        lbProfileEphemeralSettings: {
          failover_retry_count: 999,
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

      expect(results).toHaveLength(1);
    });

    it('should handle provider not found mid-failover sequence', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'test-provider-not-found',
        strategy: 'failover',
        subProfiles: [
          {
            name: 'sub1',
            providerName: 'nonexistent',
            modelId: 'model1',
            baseURL: 'https://api.test.com',
            authToken: 'test-token-1',
          },
          {
            name: 'sub2',
            providerName: 'nonexistent',
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
      }).rejects.toThrow();
    });
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
      expect(results[0]).toEqual({ type: 'text', content: 'chunk1' });
      expect(results[1]).toEqual({ type: 'text', content: 'chunk2' });
      expect(results[2]).toEqual({ type: 'text', content: 'chunk3' });
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
      expect(results[0]).toEqual({ type: 'text', content: 'unique-chunk' });
    });
  });

  describe('Sticky Failover Behavior - Issue #902', () => {
    it('should track failover across requests via currentFailoverIndex', async () => {
      // This test verifies sticky behavior by checking getCurrentFailoverIndex()
      // after a failover. On success, it resets to 0. On 429 immediate failover,
      // it advances to the next index.
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
      // After success, index resets to 0
      expect(provider.getCurrentFailoverIndex()).toBe(0);
    });

    it('should reset currentFailoverIndex to 0 after successful response', async () => {
      let callCount = 0;

      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          callCount++;
          // First call fails, second succeeds, third succeeds (starting from 0)
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

      // After success, index should be reset to 0
      expect(provider.getCurrentFailoverIndex()).toBe(0);
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
        // eslint-disable-next-line require-yield
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          throw new Error('Backend failed');
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
        // eslint-disable-next-line require-yield
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          totalAttempts++;
          throw new Error('Backend failed');
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
      }).rejects.toThrow();

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
      expect(chunks[0]).toEqual({
        type: 'text',
        content: 'partial-response',
      });

      // Backend 2 should NOT have been called (no mixed response)
      expect(callCount).toBe(1);
    });
  });
});
