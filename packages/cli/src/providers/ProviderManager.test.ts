/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IProvider, IModel, IMessage, ITool } from './IProvider.js';

// Mock the OpenAIProvider module before importing ProviderManager
vi.mock('./openai/OpenAIProvider.js', () => {
  class MockOpenAIProvider implements IProvider {
    name: string = 'openai';
    constructor(_apiKey: string, _baseURL?: string) {}
    async getModels(): Promise<IModel[]> {
      return [
        {
          id: 'gpt-4',
          name: 'gpt-4',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'gpt-3.5-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
      ];
    }
    async *generateChatCompletion(
      _messages: IMessage[],
      _tools?: ITool[],
      _toolFormat?: string,
    ): AsyncIterableIterator<IMessage> {
      yield { role: 'assistant', content: 'mock response' };
    }
  }

  return {
    OpenAIProvider: MockOpenAIProvider,
  };
});

// Import ProviderManager after the mock
import { ProviderManager } from './ProviderManager.js';

describe('ProviderManager', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    manager = new ProviderManager();
  });

  describe('setActiveProvider', () => {
    it('should set an existing provider', () => {
      // First register a provider
      const mockProvider: IProvider = {
        name: 'openai',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
      };
      manager.registerProvider(mockProvider);

      expect(() => manager.setActiveProvider('openai')).not.toThrow();
    });

    it('should throw error for non-existent provider', () => {
      expect(() => manager.setActiveProvider('anthropic')).toThrow(
        'Provider not found',
      );
    });
  });

  describe('getActiveProvider', () => {
    it('should throw error when no provider is active', () => {
      expect(() => manager.getActiveProvider()).toThrow(
        'No active provider set',
      );
    });

    it('should return an explicitly set active provider', () => {
      // First register a new mock provider
      const mockProvider: IProvider = {
        name: 'test-provider',
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
      };
      manager.registerProvider(mockProvider);

      // Set it as active
      manager.setActiveProvider('test-provider');

      // Get and verify
      const activeProvider = manager.getActiveProvider();
      expect(activeProvider).toBe(mockProvider);
      expect(activeProvider.name).toBe('test-provider');
    });
  });

  describe('getAvailableModels', () => {
    it('should return models from the active provider when no provider name specified', async () => {
      // First register and set a provider
      const mockProvider: IProvider = {
        name: 'openai',
        async getModels() {
          return [
            {
              id: 'gpt-4',
              name: 'gpt-4',
              provider: 'openai',
              supportedToolFormats: ['openai'],
            },
            {
              id: 'gpt-3.5-turbo',
              name: 'gpt-3.5-turbo',
              provider: 'openai',
              supportedToolFormats: ['openai'],
            },
          ];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
      };
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('openai');

      const models = await manager.getAvailableModels();
      expect(models).toHaveLength(2);
      expect(models).toEqual([
        {
          id: 'gpt-4',
          name: 'gpt-4',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
        {
          id: 'gpt-3.5-turbo',
          name: 'gpt-3.5-turbo',
          provider: 'openai',
          supportedToolFormats: ['openai'],
        },
      ]);
    });

    it('should return models from a specific provider when provider name is given', async () => {
      // Register a second mock provider
      const mockProvider: IProvider = {
        name: 'test-provider',
        async getModels() {
          return [
            {
              id: 'test-model-1',
              name: 'Test Model 1',
              provider: 'test-provider',
              supportedToolFormats: ['test'],
            },
          ];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
      };
      manager.registerProvider(mockProvider);

      // Get models from specific provider
      const models = await manager.getAvailableModels('test-provider');
      expect(models).toHaveLength(1);
      expect(models[0].id).toBe('test-model-1');
      expect(models[0].provider).toBe('test-provider');
    });

    it('should throw error when non-existent provider name is given', async () => {
      await expect(manager.getAvailableModels('non-existent')).rejects.toThrow(
        "Provider 'non-existent' not found",
      );
    });
  });
});
