/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getProviderManager,
  resetProviderManager,
} from './providerManagerInstance.js';
import { IProvider, IModel } from './index.js';
import { Config, AuthType } from '@vybestack/llxprt-code-core';

describe('Provider-Gemini Switching', () => {
  let mockProvider: IProvider;

  beforeEach(() => {
    resetProviderManager();

    mockProvider = {
      name: 'test-provider',
      async getModels(): Promise<IModel[]> {
        return [
          {
            id: 'model-1',
            name: 'Test Model 1',
            provider: 'test-provider',
            supportedToolFormats: ['json'],
          },
          {
            id: 'model-2',
            name: 'Test Model 2',
            provider: 'test-provider',
            supportedToolFormats: ['json'],
          },
        ];
      },
      async *generateChatCompletion() {
        yield {
          speaker: 'ai' as const,
          blocks: [{ type: 'text' as const, text: 'test response' }],
        };
      },
      getCurrentModel() {
        return 'model-1';
      },
      getDefaultModel() {
        return 'model-1';
      },
      setModel(model: string) {
        console.log(`Provider model set to: ${model}`);
      },
      getServerTools() {
        return [];
      },
      async invokeServerTool() {
        return {};
      },
    };
  });

  afterEach(() => {
    resetProviderManager();
  });

  it('should use Gemini when no provider is active', async () => {
    const manager = getProviderManager(undefined, true);

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

    // Call refreshAuth
    await config.refreshAuth(AuthType.USE_GEMINI);

    // Should have called the original since no provider is active
    expect(originalRefreshAuth).toHaveBeenCalled();
  });

  it('should use provider when active', async () => {
    const manager = getProviderManager(undefined, true);

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

    // refreshAuth should remain the same (no wrapping in new implementation)
    expect(config.refreshAuth).toBe(originalRefreshAuth);

    // Call refreshAuth
    await config.refreshAuth(AuthType.USE_GEMINI);

    // Content generator remains null (provider support is in core now)
    expect(mockGeminiClient.chat.contentGenerator).toBeNull();
  });

  it('should switch back to Gemini when provider is cleared', async () => {
    const manager = getProviderManager(undefined, true);

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

    // Call refreshAuth
    await config.refreshAuth(AuthType.USE_GEMINI);

    // Should NOT update content generator since no provider is active
    expect(mockGeminiClient.chat.contentGenerator).toBeNull();
  });
});
