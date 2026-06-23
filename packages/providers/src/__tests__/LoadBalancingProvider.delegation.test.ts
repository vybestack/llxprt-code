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
import { LoadBalancingProvider } from '../LoadBalancingProvider.js';

function extractTextFromChunk(chunk: unknown): string | null {
  if (chunk === null || typeof chunk !== 'object') return null;
  if (!('parts' in chunk)) return null;
  const parts = (chunk as { parts: unknown[] }).parts;
  if (!Array.isArray(parts) || parts[0] == null) return null;
  if (!('text' in parts[0])) return null;
  return (parts[0] as { text: string }).text;
}

/**
 * Helper function to collect response text from a provider.
 * Iterates through chunks and extracts text for testing.
 */
async function collectResponseFromProvider(
  provider: IProvider,
  testText: string,
  responses: string[],
): Promise<void> {
  const iterator = provider.generateChatCompletion({
    contents: [{ role: 'user', parts: [{ text: testText }] }],
  });
  for await (const chunk of iterator) {
    const text = extractTextFromChunk(chunk);
    if (text !== null) {
      responses.push(text);
    }
  }
}

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

  describe('generateChatCompletion delegates to correct provider', () => {
    it('should call selectNextSubProfile on each generateChatCompletion call', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'delegation-test',
        strategy: 'round-robin',
        subProfiles: [
          { name: 'sub-1', providerName: 'gemini', modelId: 'gemini-flash' },
          { name: 'sub-2', providerName: 'gemini', modelId: 'gemini-pro' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Track which sub-profiles are selected during generateChatCompletion
      const selectionOrder: string[] = [];
      const originalSelectNext = (
        provider as unknown as {
          selectNextSubProfile: () => { name: string };
        }
      ).selectNextSubProfile.bind(provider);
      (
        provider as unknown as {
          selectNextSubProfile: () => { name: string };
        }
      ).selectNextSubProfile = () => {
        const selected = originalSelectNext();
        selectionOrder.push(selected.name);
        return selected;
      };

      // Create mock provider to be returned by ProviderManager
      const mockProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'test response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      // Mock ProviderManager.getProviderByName to return our mock
      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = () => mockProvider as IProvider;

      try {
        // First call
        const iterator1 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        // Consume the iterator to trigger the delegation
        for await (const _chunk of iterator1) {
          // Consume iterator
        }

        // Second call
        const iterator2 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
        });
        for await (const _chunk of iterator2) {
          // Consume iterator
        }

        // Verify selectNextSubProfile was called in correct order
        expect(selectionOrder).toStrictEqual(['sub-1', 'sub-2']);
      } finally {
        // Restore original method
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should delegate to correct provider based on sub-profile providerName', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'provider-delegation-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'gemini-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
          { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Track which providers were requested from ProviderManager
      const providerRequests: string[] = [];
      const mockGeminiProvider = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'gemini response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const mockOpenAIProvider = {
        name: 'openai',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'openai response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gpt-4',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        providerRequests.push(name);
        if (name === 'gemini') return mockGeminiProvider as IProvider;
        if (name === 'openai') return mockOpenAIProvider as IProvider;
        return originalGetProvider(name);
      };

      try {
        // First call should go to gemini
        const iterator1 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test1' }] }],
        });
        for await (const _chunk of iterator1) {
          // Consume
        }

        // Second call should go to openai
        const iterator2 = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test2' }] }],
        });
        for await (const _chunk of iterator2) {
          // Consume
        }

        // Verify correct providers were requested
        expect(providerRequests).toStrictEqual(['gemini', 'openai']);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('passes resolved settings to delegate provider', () => {
    it('should pass resolved baseURL, authToken, and model via options.resolved', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'resolved-settings-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'custom-sub',
            providerName: 'gemini',
            modelId: 'custom-model',
            baseURL: 'https://custom.api.com',
            authToken: 'custom-token-123',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      // Capture the options passed to delegate provider
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
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify options.resolved was passed with correct values
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.resolved).toBeDefined();
        expect(capturedOptions!.resolved!.model).toBe('custom-model');
        expect(capturedOptions!.resolved!.baseURL).toBe(
          'https://custom.api.com',
        );
        expect(capturedOptions!.resolved!.authToken).toBe('custom-token-123');
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should preserve existing resolved options if sub-profile does not override them', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'preserve-resolved-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'minimal-sub',
            providerName: 'gemini',
            // modelId, baseURL, authToken not specified
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

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
        // Pass existing resolved options
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          resolved: {
            model: 'original-model',
            baseURL: 'https://original.api.com',
            authToken: 'original-token',
          },
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify original resolved options were preserved
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.resolved).toBeDefined();
        expect(capturedOptions!.resolved!.model).toBe('original-model');
        expect(capturedOptions!.resolved!.baseURL).toBe(
          'https://original.api.com',
        );
        expect(capturedOptions!.resolved!.authToken).toBe('original-token');
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should override existing resolved options with sub-profile settings', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'override-resolved-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'override-sub',
            providerName: 'gemini',
            modelId: 'override-model',
            baseURL: 'https://override.api.com',
            authToken: 'override-token',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

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
        // Pass existing resolved options that should be overridden
        const iterator = provider.generateChatCompletion({
          contents: [{ role: 'user', parts: [{ text: 'test' }] }],
          resolved: {
            model: 'original-model',
            baseURL: 'https://original.api.com',
            authToken: 'original-token',
          },
        });
        for await (const _chunk of iterator) {
          // Consume
        }

        // Verify sub-profile settings took precedence
        expect(capturedOptions).toBeDefined();
        expect(capturedOptions!.resolved).toBeDefined();
        expect(capturedOptions!.resolved!.model).toBe('override-model');
        expect(capturedOptions!.resolved!.baseURL).toBe(
          'https://override.api.com',
        );
        expect(capturedOptions!.resolved!.authToken).toBe('override-token');
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
  describe('handles sub-profiles with different provider types', () => {
    it('should delegate to different provider types in round-robin fashion', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'mixed-providers-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'gemini-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
          { name: 'openai-sub', providerName: 'openai', modelId: 'gpt-4' },
          {
            name: 'anthropic-sub',
            providerName: 'anthropic',
            modelId: 'claude-3',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const responses: string[] = [];
      const mockGemini = {
        name: 'gemini',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'gemini-response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const mockOpenAI = {
        name: 'openai',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'openai-response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gpt-4',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const mockAnthropic = {
        name: 'anthropic',
        async *generateChatCompletion(): AsyncIterableIterator<IContent> {
          yield { role: 'model', parts: [{ text: 'anthropic-response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'claude-3',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        if (name === 'gemini') return mockGemini as IProvider;
        if (name === 'openai') return mockOpenAI as IProvider;
        if (name === 'anthropic') return mockAnthropic as IProvider;
        return originalGetProvider(name);
      };

      try {
        // Make 3 calls to cycle through all providers
        for (let i = 0; i < 3; i++) {
          await collectResponseFromProvider(provider, `test ${i}`, responses);
        }

        // Verify responses came from different providers in order
        expect(responses).toStrictEqual([
          'gemini-response',
          'openai-response',
          'anthropic-response',
        ]);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });

    it('should pass correct model for each provider type', async () => {
      const lbConfig: LoadBalancingProviderConfig = {
        profileName: 'mixed-models-test',
        strategy: 'round-robin',
        subProfiles: [
          {
            name: 'gemini-sub',
            providerName: 'gemini',
            modelId: 'gemini-flash',
          },
          {
            name: 'openai-sub',
            providerName: 'openai',
            modelId: 'gpt-4-turbo',
          },
        ],
      };

      const provider = new LoadBalancingProvider(lbConfig, providerManager);

      const capturedModels: string[] = [];
      const mockGemini = {
        name: 'gemini',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          capturedModels.push(options.resolved?.model ?? 'no-model');
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gemini-flash',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const mockOpenAI = {
        name: 'openai',
        async *generateChatCompletion(
          options: GenerateChatOptions,
        ): AsyncIterableIterator<IContent> {
          capturedModels.push(options.resolved?.model ?? 'no-model');
          yield { role: 'model', parts: [{ text: 'response' }] };
        },
        getModels: async () => [],
        getDefaultModel: () => 'gpt-4',
        getServerTools: () => [],
        invokeServerTool: async () => ({}),
      };

      const originalGetProvider =
        providerManager.getProviderByName.bind(providerManager);
      providerManager.getProviderByName = (name: string) => {
        if (name === 'gemini') return mockGemini as IProvider;
        if (name === 'openai') return mockOpenAI as IProvider;
        return originalGetProvider(name);
      };

      try {
        // Make 2 calls to cycle through providers
        for (let i = 0; i < 2; i++) {
          const iterator = provider.generateChatCompletion({
            contents: [{ role: 'user', parts: [{ text: `test ${i}` }] }],
          });
          for await (const _chunk of iterator) {
            // Consume
          }
        }

        // Verify correct models were passed to each provider
        expect(capturedModels).toStrictEqual(['gemini-flash', 'gpt-4-turbo']);
      } finally {
        providerManager.getProviderByName = originalGetProvider;
      }
    });
  });
});
