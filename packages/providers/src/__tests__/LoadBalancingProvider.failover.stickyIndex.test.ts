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
import { LoadBalancerFailoverError } from '../errors.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';

describe('LoadBalancingProvider - Failover Sticky Index (Issue #2492)', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  it('should failover from sticky index 2 to healthy index 0', async () => {
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        const model = options.resolved?.model ?? '';
        callLog.push(model);
        if (model === 'model-a') {
          throw new Error('backend-a error');
        }
        if (model === 'model-b') {
          throw new Error('backend-b error');
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
      profileName: 'test-sticky-wraparound',
      strategy: 'failover',
      subProfiles: [
        {
          name: 'backend-a',
          providerName: 'test-provider',
          modelId: 'model-a',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-a',
        },
        {
          name: 'backend-b',
          providerName: 'test-provider',
          modelId: 'model-b',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-b',
        },
        {
          name: 'backend-c',
          providerName: 'test-provider',
          modelId: 'model-c',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-c',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      prompt: 'test prompt',
      messages: [{ role: 'user' as const, content: 'test' }],
    };

    callLog.length = 0;
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }

    expect(provider.getCurrentFailoverIndex()).toBe(2);

    callLog.length = 0;
    mockProvider.generateChatCompletion = async function* (
      options: GenerateChatOptions,
    ): AsyncGenerator<IContent> {
      const model = options.resolved?.model ?? '';
      callLog.push(model);
      if (model === 'model-c') {
        const error = new Error('Rate limited') as Error & {
          status: number;
        };
        error.status = 429;
        throw error;
      }
      if (model === 'model-a') {
        yield { type: 'text' as const, content: 'success from a' };
      }
      if (model === 'model-b') {
        throw new Error('backend-b error');
      }
    };

    const results: IContent[] = [];
    for await (const chunk of provider.generateChatCompletion(options)) {
      results.push(chunk);
    }

    expect(results[0]).toStrictEqual({
      type: 'text',
      content: 'success from a',
    });
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(callLog).toStrictEqual(['model-c', 'model-a']);
  });

  it('should reset sticky index to 0 after all backends fail', async () => {
    let phase: 'first' | 'second' = 'first';
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        const model = options.resolved?.model ?? '';
        callLog.push(model);
        if (phase === 'first') {
          if (model === 'model-a') {
            throw new Error('backend-a error');
          }
          if (model === 'model-b') {
            throw new Error('backend-b error');
          }
          yield { type: 'text' as const, content: 'success from c' };
        } else {
          throw new Error('all backends failed');
        }
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => ({ content: [] }),
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'test-reset-on-all-fail',
      strategy: 'failover',
      subProfiles: [
        {
          name: 'backend-a',
          providerName: 'test-provider',
          modelId: 'model-a',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-a',
        },
        {
          name: 'backend-b',
          providerName: 'test-provider',
          modelId: 'model-b',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-b',
        },
        {
          name: 'backend-c',
          providerName: 'test-provider',
          modelId: 'model-c',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-c',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      prompt: 'test prompt',
      messages: [{ role: 'user' as const, content: 'test' }],
    };

    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }

    expect(provider.getCurrentFailoverIndex()).toBe(2);
    expect(callLog).toStrictEqual(['model-a', 'model-b', 'model-c']);

    phase = 'second';
    callLog.length = 0;

    await expect(async () => {
      for await (const _chunk of provider.generateChatCompletion(options)) {
        // consume
      }
    }).rejects.toThrow(LoadBalancerFailoverError);

    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(callLog).toStrictEqual(['model-c', 'model-a', 'model-b']);
  });

  it('should attempt all backends in order and reset index to 0 when a full rotation from sticky index 0 fails', async () => {
    const callLog: string[] = [];

    const mockProvider: IProvider = {
      name: 'test-provider',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        const model = options.resolved?.model ?? 'unknown';
        callLog.push(model);
        const chunks: IContent[] = [];
        yield* chunks;
        throw new Error(`backend failed for ${model}`);
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => ({ content: [] }),
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'test-full-rotation-from-zero',
      strategy: 'failover',
      subProfiles: [
        {
          name: 'backend-a',
          providerName: 'test-provider',
          modelId: 'model-a',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-a',
        },
        {
          name: 'backend-b',
          providerName: 'test-provider',
          modelId: 'model-b',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-b',
        },
        {
          name: 'backend-c',
          providerName: 'test-provider',
          modelId: 'model-c',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-c',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      prompt: 'test prompt',
      messages: [{ role: 'user' as const, content: 'test' }],
    };

    expect(provider.getCurrentFailoverIndex()).toBe(0);

    await expect(async () => {
      for await (const _chunk of provider.generateChatCompletion(options)) {
        // consume
      }
    }).rejects.toThrow(LoadBalancerFailoverError);

    expect(callLog).toStrictEqual(['model-a', 'model-b', 'model-c']);
    expect(provider.getCurrentFailoverIndex()).toBe(0);
  });

  it('should not be pegged to exhausted backend across multiple requests', async () => {
    const callLog: string[] = [];

    let phase: 1 | 2 | 3 = 1;

    const mockProvider: IProvider = {
      name: 'test-provider',
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncGenerator<IContent> {
        const model = options.resolved?.model ?? '';
        callLog.push(`phase${phase}:${model}`);

        if (phase === 1) {
          if (model === 'zai-model') {
            throw new Error('zai error');
          }
          if (model === 'makora-model') {
            throw new Error('makora error');
          }
          yield { type: 'text' as const, content: 'ollama success' };
        } else if (phase === 2) {
          if (model === 'ollama-model') {
            const error = new Error('Rate limited') as Error & {
              status: number;
            };
            error.status = 429;
            throw error;
          }
          yield { type: 'text' as const, content: 'zai success' };
        } else {
          yield { type: 'text' as const, content: 'zai success again' };
        }
      },
      getModels: async () => [],
      getDefaultModel: () => 'test-model',
      getServerTools: () => [],
      invokeServerTool: async () => ({ content: [] }),
    };

    providerManager.registerProvider(mockProvider);

    const lbConfig: LoadBalancingProviderConfig = {
      profileName: 'test-not-pegged',
      strategy: 'failover',
      subProfiles: [
        {
          name: 'zai',
          providerName: 'test-provider',
          modelId: 'zai-model',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-zai',
        },
        {
          name: 'makora',
          providerName: 'test-provider',
          modelId: 'makora-model',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-makora',
        },
        {
          name: 'ollama',
          providerName: 'test-provider',
          modelId: 'ollama-model',
          baseURL: 'https://api.test.com',
          authToken: 'test-token-ollama',
        },
      ],
    };

    const provider = new LoadBalancingProvider(lbConfig, providerManager);
    const options: GenerateChatOptions = {
      prompt: 'test prompt',
      messages: [{ role: 'user' as const, content: 'test' }],
    };

    const phase1Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase1Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(2);
    expect(phase1Calls).toStrictEqual([
      'phase1:zai-model',
      'phase1:makora-model',
      'phase1:ollama-model',
    ]);

    phase = 2;
    const phase2Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase2Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(phase2Calls).toStrictEqual([
      'phase2:ollama-model',
      'phase2:zai-model',
    ]);

    phase = 3;
    const phase3Calls: string[] = [];
    for await (const _chunk of provider.generateChatCompletion(options)) {
      // consume
    }
    phase3Calls.push(...callLog.splice(0));
    expect(provider.getCurrentFailoverIndex()).toBe(0);
    expect(phase3Calls).toStrictEqual(['phase3:zai-model']);
  });
});
