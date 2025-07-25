/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderManager } from './ProviderManager.js';
import { IProvider, IModel, IMessage, ITool } from './IProvider.js';
import { ContentGeneratorRole } from './ContentGeneratorRole.js';

// Helper function to create mock providers
function createMockProvider(
  name: string,
  models: IModel[] = [],
  response: string = 'mock response',
  isDefault: boolean = false,
): IProvider {
  return {
    name,
    isDefault,
    async getModels(): Promise<IModel[]> {
      return models;
    },
    async *generateChatCompletion(
      _messages: IMessage[],
      _tools?: ITool[],
      _toolFormat?: string,
    ): AsyncIterableIterator<IMessage> {
      yield { role: ContentGeneratorRole.ASSISTANT, content: response };
    },
    getServerTools(): string[] {
      return [];
    },
    async invokeServerTool(
      _toolName: string,
      _params: unknown,
      _config?: unknown,
    ): Promise<unknown> {
      throw new Error('Server tools not supported by mock provider');
    },
  };
}

describe('ProviderManager', () => {
  let manager: ProviderManager;

  beforeEach(() => {
    manager = new ProviderManager();
  });

  describe('provider registration', () => {
    it('should allow registering a provider', () => {
      const mockProvider = createMockProvider('test-provider');

      expect(() => manager.registerProvider(mockProvider)).not.toThrow();
      expect(manager.listProviders()).toContain('test-provider');
    });

    it('should allow registering multiple providers', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');
      const provider3 = createMockProvider('provider-3');

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);
      manager.registerProvider(provider3);

      const providers = manager.listProviders();
      expect(providers).toContain('provider-1');
      expect(providers).toContain('provider-2');
      expect(providers).toContain('provider-3');
      expect(providers).toHaveLength(3);
    });

    it('should overwrite provider with same name', () => {
      const provider1 = createMockProvider('duplicate-name', [
        {
          id: 'model1',
          name: 'Model 1',
          provider: 'duplicate-name',
          supportedToolFormats: [],
        },
      ]);
      const provider2 = createMockProvider('duplicate-name', [
        {
          id: 'model2',
          name: 'Model 2',
          provider: 'duplicate-name',
          supportedToolFormats: [],
        },
      ]);

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      expect(manager.listProviders()).toHaveLength(1);
      expect(manager.listProviders()).toContain('duplicate-name');
    });

    it('should set default provider as active if no active provider', () => {
      const mockProvider = createMockProvider(
        'default-provider',
        [],
        'response',
        true,
      );

      manager.registerProvider(mockProvider);
      expect(manager.getActiveProviderName()).toBe('default-provider');
      expect(manager.hasActiveProvider()).toBe(true);
    });

    it('should not change active provider when registering default provider if one is already active', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider(
        'default-provider',
        [],
        'response',
        true,
      );

      manager.registerProvider(provider1);
      manager.setActiveProvider('provider-1');
      manager.registerProvider(provider2);

      expect(manager.getActiveProviderName()).toBe('provider-1');
    });
  });

  describe('setActiveProvider', () => {
    it('should set an existing provider as active', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);

      expect(() => manager.setActiveProvider('test-provider')).not.toThrow();
      expect(manager.getActiveProviderName()).toBe('test-provider');
    });

    it('should throw error for non-existent provider', () => {
      expect(() => manager.setActiveProvider('non-existent')).toThrow(
        'Provider not found',
      );
    });

    it('should allow switching between providers', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      manager.setActiveProvider('provider-1');
      expect(manager.getActiveProviderName()).toBe('provider-1');

      manager.setActiveProvider('provider-2');
      expect(manager.getActiveProviderName()).toBe('provider-2');
    });

    it('should call clearState on all providers when switching', () => {
      const clearState1 = vi.fn();
      const clearState2 = vi.fn();

      const provider1: IProvider = {
        name: 'provider-1',
        clearState: clearState1,
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      const provider2: IProvider = {
        name: 'provider-2',
        clearState: clearState2,
        async getModels() {
          return [];
        },
        async *generateChatCompletion() {
          yield { role: 'assistant', content: 'test' };
        },
        getServerTools: () => [],
        invokeServerTool: vi
          .fn()
          .mockRejectedValue(new Error('Server tools not supported')),
      };

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      manager.setActiveProvider('provider-1');
      // No clearState calls on the first setActiveProvider (no previous provider)
      expect(clearState1).toHaveBeenCalledTimes(0);
      expect(clearState2).toHaveBeenCalledTimes(0);

      manager.setActiveProvider('provider-2');
      // Only provider-1's clearState should be called when switching away from it
      expect(clearState1).toHaveBeenCalledTimes(1);
      expect(clearState2).toHaveBeenCalledTimes(0);
    });
  });

  describe('clearActiveProvider', () => {
    it('should clear the active provider', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');

      expect(manager.hasActiveProvider()).toBe(true);

      manager.clearActiveProvider();
      expect(manager.hasActiveProvider()).toBe(false);
      expect(manager.getActiveProviderName()).toBe('');
    });
  });

  describe('getActiveProvider', () => {
    it('should throw error when no provider is active', () => {
      expect(() => manager.getActiveProvider()).toThrow(
        'No active provider set',
      );
    });

    it('should return the active provider', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');

      const activeProvider = manager.getActiveProvider();
      expect(activeProvider).toBe(mockProvider);
      expect(activeProvider.name).toBe('test-provider');
    });
  });

  describe('hasActiveProvider', () => {
    it('should return false when no active provider', () => {
      expect(manager.hasActiveProvider()).toBe(false);
    });

    it('should return true when provider is active', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');

      expect(manager.hasActiveProvider()).toBe(true);
    });

    it('should return false after clearing active provider', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');
      manager.clearActiveProvider();

      expect(manager.hasActiveProvider()).toBe(false);
    });
  });

  describe('getAvailableModels', () => {
    it('should return models from the active provider when no provider name specified', async () => {
      const models: IModel[] = [
        {
          id: 'model-1',
          name: 'Model 1',
          provider: 'test-provider',
          supportedToolFormats: ['format1'],
        },
        {
          id: 'model-2',
          name: 'Model 2',
          provider: 'test-provider',
          supportedToolFormats: ['format1', 'format2'],
        },
      ];

      const mockProvider = createMockProvider('test-provider', models);
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');

      const availableModels = await manager.getAvailableModels();
      expect(availableModels).toHaveLength(2);
      expect(availableModels).toEqual(models);
    });

    it('should return models from a specific provider when provider name is given', async () => {
      const models1: IModel[] = [
        {
          id: 'model-a',
          name: 'Model A',
          provider: 'provider-1',
          supportedToolFormats: ['format1'],
        },
      ];

      const models2: IModel[] = [
        {
          id: 'model-b',
          name: 'Model B',
          provider: 'provider-2',
          supportedToolFormats: ['format2'],
        },
      ];

      const provider1 = createMockProvider('provider-1', models1);
      const provider2 = createMockProvider('provider-2', models2);

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);

      const modelsFromProvider1 =
        await manager.getAvailableModels('provider-1');
      expect(modelsFromProvider1).toHaveLength(1);
      expect(modelsFromProvider1[0].id).toBe('model-a');
      expect(modelsFromProvider1[0].provider).toBe('provider-1');

      const modelsFromProvider2 =
        await manager.getAvailableModels('provider-2');
      expect(modelsFromProvider2).toHaveLength(1);
      expect(modelsFromProvider2[0].id).toBe('model-b');
      expect(modelsFromProvider2[0].provider).toBe('provider-2');
    });

    it('should throw error when non-existent provider name is given', async () => {
      await expect(manager.getAvailableModels('non-existent')).rejects.toThrow(
        "Provider 'non-existent' not found",
      );
    });

    it('should throw error when no active provider and no provider name given', async () => {
      await expect(manager.getAvailableModels()).rejects.toThrow(
        'No active provider set',
      );
    });
  });

  describe('listProviders', () => {
    it('should return empty array when no providers registered', () => {
      expect(manager.listProviders()).toEqual([]);
    });

    it('should return all registered provider names', () => {
      const provider1 = createMockProvider('provider-1');
      const provider2 = createMockProvider('provider-2');
      const provider3 = createMockProvider('provider-3');

      manager.registerProvider(provider1);
      manager.registerProvider(provider2);
      manager.registerProvider(provider3);

      const providers = manager.listProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain('provider-1');
      expect(providers).toContain('provider-2');
      expect(providers).toContain('provider-3');
    });
  });

  describe('getActiveProviderName', () => {
    it('should return empty string when no active provider', () => {
      expect(manager.getActiveProviderName()).toBe('');
    });

    it('should return the name of the active provider', () => {
      const mockProvider = createMockProvider('test-provider');
      manager.registerProvider(mockProvider);
      manager.setActiveProvider('test-provider');

      expect(manager.getActiveProviderName()).toBe('test-provider');
    });
  });
});
