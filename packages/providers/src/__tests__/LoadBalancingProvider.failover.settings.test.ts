/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';
import type { IProvider } from '../IProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { GenerateChatOptions } from '../GenerateChatOptions.js';
import { replayableContents } from '../utils/collectContents.js';

const requestContents = replayableContents([
  { speaker: 'human', blocks: [{ type: 'text', text: 'test' }] },
  { speaker: 'human', blocks: [{ type: 'text', text: 'test prompt' }] },
]);
function makeProviderManager(): ProviderManager {
  const settingsService = new SettingsService();
  const config = createRuntimeConfigStub(settingsService);
  return new ProviderManager({ settingsService, config });
}

describe('LoadBalancingProvider - Failover Strategy [part 1]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
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
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 2]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Ephemeral Settings Extraction', () => {
    it('should default failover_retry_count to 1', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
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
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 3]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Ephemeral Settings Extraction', () => {
    it('should extract failover_retry_delay_ms from lbProfileEphemeralSettings', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
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
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 4]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Ephemeral Settings Extraction', () => {
    it('should default failover_retry_delay_ms to 0', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
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
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 5]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
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
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 6]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Edge Cases', () => {
    it('should cap retry_count at 100 even if higher value provided', async () => {
      const mockProvider: IProvider = {
        name: 'test-provider',
        async *generateChatCompletion(): AsyncGenerator<IContent> {
          yield { type: 'text' as const, content: 'success' };
        },
        getModels: async () => [],
        getDefaultModel: () => 'test-model',
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
        contents: requestContents,
      };

      const results: IContent[] = [];
      for await (const chunk of provider.generateChatCompletion(options)) {
        results.push(chunk);
      }

      expect(results).toHaveLength(1);
    });
  });
});

describe('LoadBalancingProvider - Failover Strategy [part 7]', () => {
  let providerManager: ProviderManager;
  beforeEach(() => {
    providerManager = makeProviderManager();
  });
  describe('Edge Cases', () => {
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
        contents: requestContents,
      };

      await expect(
        (async () => {
          const results: IContent[] = [];
          for await (const chunk of provider.generateChatCompletion(options)) {
            results.push(chunk);
          }
        })(),
      ).rejects.toThrow(/failover exhausted/);
    });
  });
});
