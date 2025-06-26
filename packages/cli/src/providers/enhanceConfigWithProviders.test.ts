/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { enhanceConfigWithProviders } from './enhanceConfigWithProviders.js';
import {
  Config,
  ContentGenerator,
  GeminiClient,
} from '@google/gemini-cli-core';
import { ProviderManager } from './ProviderManager.js';
import { IProvider } from './IProvider.js';
import * as providerManagerInstance from './providerManagerInstance.js';

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
        contentGenerator: null, // Will be updated by enhanceConfigWithProviders
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

    // refreshAuth should be overridden
    expect(mockConfig.refreshAuth).not.toBe(originalRefreshAuth);
  });

  it('should integrate GeminiCompatibleWrapper when provider is active', async () => {
    enhanceConfigWithProviders(mockConfig);

    // Call the enhanced refreshAuth
    await mockConfig.refreshAuth('test-auth');

    // Original refreshAuth should have been called
    expect(originalRefreshAuth).toHaveBeenCalledWith('test-auth');

    // Provider manager should have been queried
    expect(mockProviderManager.listProviders).toHaveBeenCalled();
    expect(mockProviderManager.getActiveProvider).toHaveBeenCalled();
  });

  it('should update contentGenerator in GeminiClient when provider is active', async () => {
    enhanceConfigWithProviders(mockConfig);

    // Call the enhanced refreshAuth
    await mockConfig.refreshAuth('test-auth');

    // Check that contentGenerator was updated
    const chat = (mockGeminiClient as Record<string, unknown>).chat as {
      contentGenerator: ContentGenerator | null;
    };
    expect(chat.contentGenerator).toBeDefined();
    expect(chat.contentGenerator).not.toBeNull();

    // Verify it has the required methods
    expect(chat.contentGenerator.generateContent).toBeDefined();
    expect(chat.contentGenerator.generateContentStream).toBeDefined();
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

  it('should handle errors gracefully', async () => {
    // Setup provider manager to throw error
    mockProviderManager.getActiveProvider = vi.fn().mockImplementation(() => {
      throw new Error('Provider error');
    });

    const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    enhanceConfigWithProviders(mockConfig);

    // Call the enhanced refreshAuth - should not throw
    await mockConfig.refreshAuth('test-auth');

    // Original refreshAuth should have been called
    expect(originalRefreshAuth).toHaveBeenCalledWith('test-auth');

    // Error should be logged
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to enhance with provider support:',
      expect.any(Error),
    );

    consoleSpy.mockRestore();
  });

  it('should create provider ContentGenerator with correct interface', async () => {
    enhanceConfigWithProviders(mockConfig);

    await mockConfig.refreshAuth('test-auth');

    const chat = (mockGeminiClient as Record<string, unknown>).chat as {
      contentGenerator: ContentGenerator | null;
    };
    const contentGenerator = chat.contentGenerator as ContentGenerator;

    // Test that unsupported methods throw appropriate errors
    await expect(
      contentGenerator.countTokens({
        model: 'test',
        contents: [],
      }),
    ).rejects.toThrow(
      'Token counting not supported for provider-based generators',
    );

    await expect(
      contentGenerator.embedContent({
        model: 'test',
        content: 'test',
      }),
    ).rejects.toThrow('Embeddings not supported for provider-based generators');
  });
});
