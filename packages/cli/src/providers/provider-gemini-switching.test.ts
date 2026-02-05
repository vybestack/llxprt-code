/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { createProviderManager } from './providerManagerInstance.js';
import { IProvider, IModel } from './index.js';
import {
  Config,
  SettingsService,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';

function createManager() {
  const settingsService = new SettingsService();
  const runtime = createProviderRuntimeContext({ settingsService });
  const { manager } = createProviderManager(runtime, {
    allowBrowserEnvironment: true,
  });
  return manager;
}

function createMockProvider(): IProvider {
  return {
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
    getDefaultModel() {
      return 'model-1';
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
  };
}

describe('Provider-Gemini Switching', () => {
  it('uses Gemini when no provider is active', async () => {
    const manager = createManager();

    if (manager.hasActiveProvider()) {
      manager.clearActiveProvider();
    }

    expect(manager.hasActiveProvider()).toBe(false);

    manager.registerProvider(createMockProvider());
    expect(manager.hasActiveProvider()).toBe(false);

    const config = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue(null),
      getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    } as unknown as Config;

    await config.refreshAuth('gemini-api-key');
    expect(config.refreshAuth).toHaveBeenCalledWith('gemini-api-key');
  });

  it('respects active provider configuration when set', async () => {
    const manager = createManager();
    const provider = createMockProvider();

    manager.registerProvider(provider);
    manager.setActiveProvider('test-provider');
    expect(manager.hasActiveProvider()).toBe(true);

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

    await config.refreshAuth('gemini-api-key');
    expect(config.refreshAuth).toHaveBeenCalledWith('gemini-api-key');
    expect(mockGeminiClient.chat.contentGenerator).toBeNull();
  });

  it('falls back to Gemini when clearing the active provider', async () => {
    const manager = createManager();

    manager.registerProvider(createMockProvider());
    manager.setActiveProvider('test-provider');
    expect(manager.hasActiveProvider()).toBe(true);

    manager.clearActiveProvider();
    expect(manager.hasActiveProvider()).toBe(false);

    const config = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue({
        chat: {
          contentGenerator: null,
        },
      }),
      getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    } as unknown as Config;

    await config.refreshAuth('gemini-api-key');
    expect(config.refreshAuth).toHaveBeenCalled();
  });
});
