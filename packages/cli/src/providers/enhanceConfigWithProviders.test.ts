/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enhanceConfigWithProviders } from './enhanceConfigWithProviders';
import {
  Config,
  ContentGenerator,
  GeminiClient,
} from '@vybestack/llxprt-code-core';
import { ProviderManager } from './ProviderManager';
import { IProvider } from './IProvider';
import * as providerManagerInstance from './providerManagerInstance';

// Mock the provider manager
vi.mock('./providerManagerInstance.js');

describe('Phase 07e: Integrate GeminiCompatibleWrapper with ContentGenerator', () => {
  let mockConfig: Config;
  let mockProviderManager: ProviderManager;
  let mockProvider: IProvider;
  let mockGeminiClient: GeminiClient;
  let originalRefreshAuth: typeof mockConfig.refreshAuth;

  beforeEach(() => {
    // Create mock provider
    mockProvider = {
      name: 'test-provider',
      async getModels() {
        return [];
      },
      async *generateChatCompletion() {
        yield { role: 'assistant', content: 'test response' };
      },
    };

    // Create mock provider manager
    mockProviderManager = {
      listProviders: vi.fn().mockReturnValue(['test-provider']),
      getActiveProvider: vi.fn().mockReturnValue(mockProvider),
      getActiveProviderName: vi.fn().mockReturnValue('test-provider'),
      hasActiveProvider: vi.fn().mockReturnValue(true),
      registerProvider: vi.fn(),
      setActiveProvider: vi.fn(),
      getAvailableModels: vi.fn(),
    } as unknown as ProviderManager;

    // Create mock GeminiClient
    mockGeminiClient = {
      chat: {
        contentGenerator: null,
      },
    } as unknown as GeminiClient;

    // Create mock config
    mockConfig = {
      refreshAuth: vi.fn().mockResolvedValue(undefined),
      getGeminiClient: vi.fn().mockReturnValue(mockGeminiClient),
      getModel: vi.fn().mockReturnValue('test-model'),
    } as unknown as Config;

    // Store original refreshAuth for verification
    originalRefreshAuth = mockConfig.refreshAuth;

    // Setup provider manager mock
    vi.mocked(providerManagerInstance.getProviderManager).mockReturnValue(
      mockProviderManager,
    );
  });

  it('should enhance Config with provider support', () => {
    const enhancedConfig = enhanceConfigWithProviders(mockConfig);

    // Should return the same config instance
    expect(enhancedConfig).toBe(mockConfig);

    // refreshAuth should remain the same (no wrapper needed)
    expect(mockConfig.refreshAuth).toBe(originalRefreshAuth);
  });

  it('should not modify refreshAuth', async () => {
    enhanceConfigWithProviders(mockConfig);

    // refreshAuth should remain unchanged
    expect(mockConfig.refreshAuth).toBe(originalRefreshAuth);

    // Call refreshAuth to ensure it works
    await mockConfig.refreshAuth('test-auth');

    // Original refreshAuth should have been called
    expect(originalRefreshAuth).toHaveBeenCalledWith('test-auth');
  });

  it('should not modify contentGenerator in GeminiClient', async () => {
    enhanceConfigWithProviders(mockConfig);

    // Call refreshAuth
    await mockConfig.refreshAuth('test-auth');

    // Check that contentGenerator remains unchanged
    const chat = (mockGeminiClient as Record<string, unknown>).chat as {
      contentGenerator: ContentGenerator | null;
    };
    // contentGenerator should remain null as provider support is in core
    expect(chat.contentGenerator).toBeNull();
  });

  it('should handle case when no providers are available', async () => {
    // Setup no providers
    mockProviderManager.listProviders = vi.fn().mockReturnValue([]);
    mockProviderManager.hasActiveProvider = vi.fn().mockReturnValue(false);

    enhanceConfigWithProviders(mockConfig);

    // Call the enhanced refreshAuth
    await mockConfig.refreshAuth('test-auth');

    // Original refreshAuth should have been called
    expect(originalRefreshAuth).toHaveBeenCalledWith('test-auth');

    // contentGenerator should not be modified
    const chat = (mockGeminiClient as Record<string, unknown>).chat as {
      contentGenerator: ContentGenerator | null;
    };
    expect(chat.contentGenerator).toBeNull();
  });

  it('should not log any debug message (no-op function)', () => {
    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    enhanceConfigWithProviders(mockConfig);

    // Should not log anything since it's a no-op function
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('should be a no-op function for backward compatibility', async () => {
    // Store the config state before enhancement
    const configBefore = { ...mockConfig };

    enhanceConfigWithProviders(mockConfig);

    // Config should be unchanged
    expect(mockConfig.refreshAuth).toBe(configBefore.refreshAuth);
    expect(mockConfig.getGeminiClient).toBe(configBefore.getGeminiClient);
    expect(mockConfig.getModel).toBe(configBefore.getModel);

    // Provider manager should not be used
    expect(mockProviderManager.getActiveProvider).not.toHaveBeenCalled();
    expect(mockProviderManager.hasActiveProvider).not.toHaveBeenCalled();
  });
});
