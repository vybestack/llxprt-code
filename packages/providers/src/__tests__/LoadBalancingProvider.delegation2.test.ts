/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { GenerateChatOptions, IProvider } from '../IProvider.js';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  LoadBalancingProvider,
  type LoadBalancingProviderConfig,
} from '../LoadBalancingProvider.js';

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

describe('LoadBalancingProvider', () => {
  let settingsService: SettingsService;
  let config: Config;
  let providerManager: ProviderManager;

  beforeEach(() => {
    settingsService = new SettingsService();
    config = createRuntimeConfigStub(settingsService);
    providerManager = new ProviderManager({ settingsService, config });
  });

  afterEach(() => {
    // Clean up any registered providers
  });

  describe('propagates streaming responses correctly', () => {
    it('should yield chunks from delegate provider', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'streaming-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'chunk1' }] };
          yield { role: 'model', parts: [{ text: 'chunk2' }] };
          yield { role: 'model', parts: [{ text: 'chunk3' }] };
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
        });

        const chunks: string[] = [];
        for await (const chunk of iterator) {
          if (chunk.parts?.[0] != null && 'text' in chunk.parts[0]) {
            chunks.push(chunk.parts[0].text as string);
          }
        }

        // Verify all chunks were yielded in order
        expect(chunks).toStrictEqual(['chunk1', 'chunk2', 'chunk3']);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should propagate complex chunks with multiple parts', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'complex-chunks-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const complexChunk: IContent = {
        role: 'model',
        parts: [
          { text: 'text part' },
          { functionCall: { name: 'test', args: {} } },
        ],
      };

      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield complexChunk;
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
        });

        const chunks: IContent[] = [];
        for await (const chunk of iterator) {
          chunks.push(chunk);
        }

        // Verify complex chunk was propagated correctly
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toStrictEqual(complexChunk);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should handle streaming from different providers in round-robin', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'multi-stream-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'provider-1',
            providerName: 'provider1',
            modelId: 'model-1',
          },
          {
            name: 'provider-2',
            providerName: 'provider2',
            modelId: 'model-2',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider1 = {
        name: 'provider1',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'p1-chunk1' }] };
          yield { role: 'model', parts: [{ text: 'p1-chunk2' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const mockProvider2 = {
        name: 'provider2',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'p2-chunk1' }] };
          yield { role: 'model', parts: [{ text: 'p2-chunk2' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-2',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        if (name === 'provider1') return mockProvider1 as IProvider;
        if (name === 'provider2') return mockProvider2 as IProvider;
        return originalGetProvider(name);
      };

      try {
        // First call to provider1
        const chunks1: string[] = [];
        const iterator1 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
        });
        for await (const chunk of iterator1) {
          if (chunk.parts?.[0] != null && 'text' in chunk.parts[0]) {
            chunks1.push(chunk.parts[0].text as string);
          }
        }

        // Second call to provider2
        const chunks2: string[] = [];
        const iterator2 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
        });
        for await (const chunk of iterator2) {
          if (chunk.parts?.[0] != null && 'text' in chunk.parts[0]) {
            chunks2.push(chunk.parts[0].text as string);
          }
        }

        // Verify chunks from each provider were propagated correctly
        expect(chunks1).toStrictEqual(['p1-chunk1', 'p1-chunk2']);
        expect(chunks2).toStrictEqual(['p2-chunk1', 'p2-chunk2']);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('error handling when delegate provider not found', () => {
    it('should throw error when ProviderManager cannot find delegate provider', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'missing-provider-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'non-existent-provider',
            modelId: 'model-1',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () =>
        undefined as unknown as IProvider;

      try {
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });

        // Should throw error when trying to delegate
        await expect(async () => {
          for await (const _chunk of iterator) {
            // Should not get here
          }
        }).rejects.toThrow(/Provider.*not found/);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should include sub-profile name and provider name in error message', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'detailed-error-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'my-sub-profile',
            providerName: 'missing-provider',
            modelId: 'model-1',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () =>
        undefined as unknown as IProvider;

      try {
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });

        // Should throw error with detailed message
        await expect(async () => {
          for await (const _chunk of iterator) {
            // Should not get here
          }
        }).rejects.toThrow(/my-sub-profile/);

        await expect(async () => {
          const iterator2 = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          });
          for await (const _chunk of iterator2) {
            // Should not get here
          }
        }).rejects.toThrow(/missing-provider/);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should not affect round-robin counter when provider is not found', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'counter-error-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'sub-1',
            providerName: 'valid-provider',
            modelId: 'model-1',
          },
          {
            name: 'sub-2',
            providerName: 'invalid-provider',
            modelId: 'model-2',
          },
          {
            name: 'sub-3',
            providerName: 'valid-provider',
            modelId: 'model-3',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const mockProvider = {
        name: 'valid-provider',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'model-1',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const callCount = { count: 0 };
      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        callCount.count++;
        if (name === 'invalid-provider')
          return undefined as unknown as IProvider;
        return mockProvider as IProvider;
      };

      try {
        // First call - should succeed (sub-1)
        const iterator1 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
        });
        for await (const _chunk of iterator1) {
          // Consume
        }

        // Second call - should fail (sub-2)
        const iterator2 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
        });
        await expect(async () => {
          for await (const _chunk of iterator2) {
            // Should not get here
          }
        }).rejects.toThrow(/Provider.*not found/);

        // Third call - should succeed (sub-3) - counter should have advanced despite error
        const iterator3 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test3' }] }],
        });
        for await (const _chunk of iterator3) {
          // Consume
        }

        // Verify all 3 providers were requested in order
        expect(callCount.count).toBe(3);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('passes other options to delegate provider', () => {
    it('should pass tools to delegate provider', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'tools-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const testTools: ProviderToolset = [
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parametersJsonSchema: { type: 'object' },
            },
          ],
        },
      ];

      let capturedOptions: GenerateChatOptions | undefined;
      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          capturedOptions = options;
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
          tools: testTools,
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify tools were passed to delegate
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.tools).toStrictEqual(testTools);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should pass settings to delegate provider', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'settings-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const customSettings = new SettingsService();
      customSettings.set('custom-key', 'custom-value');

      let capturedOptions: GenerateChatOptions | undefined;
      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          capturedOptions = options;
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
          settings: customSettings,
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify settings were passed to delegate
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.settings).toBe(customSettings);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should pass metadata to delegate provider', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'metadata-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const testMetadata = { requestId: 'test-123', source: 'unit-test' };

      let capturedOptions: GenerateChatOptions | undefined;
      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          capturedOptions = options;
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
          metadata: testMetadata,
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify metadata was passed to delegate
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.metadata).toMatchObject(testMetadata);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
