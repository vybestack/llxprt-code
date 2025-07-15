/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getProviderManager,
  resetProviderManager,
} from './providerManagerInstance';
import { IProvider, IModel } from './IProvider';
import { enhanceConfigWithProviders } from './enhanceConfigWithProviders';
import { Config } from '@vybestack/llxprt-code-core';

describe('Provider-Gemini Switching', () => {
  let mockProvider: IProvider;

  beforeEach(() => {
    resetProviderManager();

    mockProvider = {
      name: 'test-provider',
      async getModels(): Promise<IModel[]> {
        return [
          { id: 'model-1', name: 'Test Model 1' },
          { id: 'model-2', name: 'Test Model 2' },
        ];
      },
      async *generateChatCompletion() {
        yield { role: 'assistant', content: 'test response' };
      },
      getCurrentModel() {
        return 'model-1';
      },
      setModel(model: string) {
        console.log(`Provider model set to: ${model}`);
      },
    };
  });

  afterEach(() => {
    resetProviderManager();
  });

  it('should use Gemini when no provider is active', async () => {
    const manager = getProviderManager();

    // Clear any auto-loaded active provider
    if (manager.hasActiveProvider()) {
      manager.clearActiveProvider();
    }

    // Register provider but don't activate it
    manager.registerProvider(mockProvider);

    // Should not have an active provider
    expect(manager.hasActiveProvider()).toBe(false);

    // Create a mock config
    const originalRefreshAuth = vi.fn().mockResolvedValue(undefined);
    const config = {
      refreshAuth: originalRefreshAuth,
      getGeminiClient: vi.fn().mockReturnValue(null),
      getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    } as unknown as Config;

    // Enhance config
    enhanceConfigWithProviders(config);

    // Call refreshAuth
    await config.refreshAuth('test-auth');

    // Should have called the original since no provider is active
    expect(originalRefreshAuth).toHaveBeenCalled();
  });

  it('should use provider when active', async () => {
    const manager = getProviderManager();

    // Register and activate provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('test-provider');

    // Should have an active provider
    expect(manager.hasActiveProvider()).toBe(true);

    // Create a mock config with a mock GeminiClient
    const mockGeminiClient = {
      chat: {
        contentGenerator: null,
      },
    };

    const config = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    } as unknown as Config;

    // Store original refreshAuth
    const originalRefreshAuth = config.refreshAuth;

    // Enhance config
    enhanceConfigWithProviders(config);

    // refreshAuth should remain the same (no wrapping in new implementation)
    expect(config.refreshAuth).toBe(originalRefreshAuth);

    // Call refreshAuth
    await config.refreshAuth('test-auth');

    // Content generator remains null (provider support is in core now)
    expect(mockGeminiClient.chat.contentGenerator).toBeNull();
  });

  it('should switch back to Gemini when provider is cleared', async () => {
    const manager = getProviderManager();

    // Start with active provider
    manager.registerProvider(mockProvider);
    manager.setActiveProvider('test-provider');
    expect(manager.hasActiveProvider()).toBe(true);

    // Clear provider (switch back to Gemini)
    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);

    // Create a mock config
    const mockGeminiClient = {
      chat: {
        contentGenerator: null,
      },
    };

    const config = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    } as unknown as Config;

    // Enhance config
    enhanceConfigWithProviders(config);

    // Call refreshAuth
    await config.refreshAuth('test-auth');

    // Should NOT update content generator since no provider is active
    expect(mockGeminiClient.chat.contentGenerator).toBeNull();
  });
});
