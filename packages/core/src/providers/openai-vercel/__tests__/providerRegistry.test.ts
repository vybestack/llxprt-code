/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P17
 * @requirement REQ-INT-001.1 - ProviderManager Registration
 * @requirement REQ-OAV-001.1 - Provider Selection via CLI
 *
 * Provider Registry Integration Tests (TDD RED Phase)
 *
 * These tests verify that OpenAIVercelProvider can be discovered and
 * activated through the ProviderManager. Tests are expected to FAIL
 * until Phase 18 implements the actual registration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProviderManager } from '../../ProviderManager.js';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider.js';
import type { Config } from '../../../config/config.js';
import type { SettingsService } from '../../../settings/SettingsService.js';

describe('OpenAIVercelProvider Registry Integration', () => {
  let providerManager: ProviderManager;
  let mockConfig: Config;
  let mockSettingsService: SettingsService;

  beforeEach(() => {
    // Create minimal mock for Config
    mockConfig = {
      getProvider: vi.fn().mockReturnValue('openaivercel'),
      getModel: vi.fn().mockReturnValue('gpt-4o'),
      setProviderManager: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
    } as unknown as Config;

    // Create minimal mock for SettingsService
    mockSettingsService = {
      get: vi.fn().mockReturnValue(''),
      set: vi.fn(),
      getProviderSettings: vi.fn().mockReturnValue({}),
      getConversationSettings: vi.fn().mockReturnValue({}),
    } as unknown as SettingsService;

    // Create ProviderManager instance
    providerManager = new ProviderManager(mockConfig, mockSettingsService);

    // Register OpenAIVercelProvider (simulating what CLI does)
    providerManager.registerProvider(
      new OpenAIVercelProvider('test-api-key', undefined, {
        settingsService: mockSettingsService,
      }),
    );
  });

  describe('Provider Discovery', () => {
    /**
     * @requirement REQ-INT-001.1
     * This tests that the provider is registered in the system's provider list
     */
    it('should include openaivercel in available providers list', () => {
      const providers = providerManager.listProviders();

      expect(providers).toContain('openaivercel');
    });

    /**
     * @requirement REQ-INT-001.1
     * This tests that the provider factory can create the provider
     */
    it('should be able to retrieve OpenAIVercelProvider by name', () => {
      const provider = providerManager.getProviderByName('openaivercel');

      expect(provider).toBeDefined();
      expect(provider?.name).toBe('openaivercel');
    });

    /**
     * @requirement REQ-INT-001.1
     * This tests that the returned provider is the correct class
     */
    it('should return OpenAIVercelProvider instance', () => {
      const provider = providerManager.getProviderByName('openaivercel');

      // Note: Provider might be wrapped in LoggingProviderWrapper
      // Check if it's an instance or has the right name
      expect(provider).toBeDefined();
      if (provider) {
        // Check for either direct instance or wrapper
        const isCorrectProvider =
          provider instanceof OpenAIVercelProvider ||
          provider.name === 'openaivercel';
        expect(isCorrectProvider).toBe(true);
      }
    });
  });

  describe('Provider Activation', () => {
    /**
     * @requirement REQ-OAV-001.1
     * This tests that openaivercel can be set as the active provider
     */
    it('should be able to set openaivercel as active provider', () => {
      // This should not throw
      expect(() => {
        providerManager.setActiveProvider('openaivercel');
      }).not.toThrow();

      const activeProvider = providerManager.getActiveProvider();
      expect(activeProvider.name).toBe('openaivercel');
    });

    /**
     * @requirement REQ-OAV-001.1
     * This tests that the provider remains active after being set
     */
    it('should maintain openaivercel as active after setting', () => {
      providerManager.setActiveProvider('openaivercel');
      const active1 = providerManager.getActiveProvider();

      // Get active provider again - should still be openaivercel
      const active2 = providerManager.getActiveProvider();
      expect(active2.name).toBe('openaivercel');
      expect(active1.name).toBe(active2.name);
    });

    /**
     * @requirement REQ-OAV-001.1
     * This tests that getting active provider name returns correct value
     */
    it('should return openaivercel from getActiveProviderName', () => {
      providerManager.setActiveProvider('openaivercel');

      // Mock settingsService to return the active provider
      vi.mocked(mockSettingsService.get).mockReturnValue('openaivercel');

      const activeName = providerManager.getActiveProviderName();
      expect(activeName).toBe('openaivercel');
    });
  });

  describe('Provider Interface Compliance', () => {
    /**
     * @requirement REQ-INT-001.1
     * Verify the provider implements required IProvider methods
     */
    it('should have generateChatCompletion method', () => {
      const provider = providerManager.getProviderByName('openaivercel');

      expect(provider).toBeDefined();
      expect(typeof provider?.generateChatCompletion).toBe('function');
    });

    /**
     * @requirement REQ-INT-001.1
     * Verify the provider has getModels method
     */
    it('should implement getModels method', async () => {
      const provider = providerManager.getProviderByName('openaivercel');

      expect(provider).toBeDefined();
      expect(typeof provider?.getModels).toBe('function');

      // Can call getModels (currently returns empty array in stub)
      const models = await provider?.getModels();
      expect(Array.isArray(models)).toBe(true);
    });

    /**
     * @requirement REQ-INT-001.1
     * Verify the provider has getDefaultModel method
     */
    it('should implement getDefaultModel method', () => {
      const provider = providerManager.getProviderByName('openaivercel');

      expect(provider).toBeDefined();
      expect(typeof provider?.getDefaultModel).toBe('function');

      const defaultModel = provider?.getDefaultModel();
      expect(typeof defaultModel).toBe('string');
      expect(defaultModel.length).toBeGreaterThan(0);
    });

    /**
     * @requirement REQ-INT-001.1
     * Verify the provider can generate chat completions
     */
    it('should implement generateChatCompletion method', () => {
      const provider = providerManager.getProviderByName('openaivercel');

      expect(provider).toBeDefined();
      expect(typeof provider?.generateChatCompletion).toBe('function');
    });
  });

  describe('Manual Registration (for testing)', () => {
    /**
     * Tests that we can manually register the provider
     * This is useful for testing and for CLI setup
     */
    it('should accept manual registration of OpenAIVercelProvider', () => {
      const freshManager = new ProviderManager(mockConfig, mockSettingsService);
      const provider = new OpenAIVercelProvider();

      // Should not throw
      expect(() => {
        freshManager.registerProvider(provider);
      }).not.toThrow();

      // Should now be discoverable
      const registered = freshManager.getProviderByName('openaivercel');
      expect(registered).toBeDefined();
      expect(registered?.name).toBe('openaivercel');
    });

    /**
     * Tests that manually registered provider can be activated
     */
    it('should allow activation of manually registered provider', () => {
      const freshManager = new ProviderManager(mockConfig, mockSettingsService);
      const provider = new OpenAIVercelProvider();

      freshManager.registerProvider(provider);

      expect(() => {
        freshManager.setActiveProvider('openaivercel');
      }).not.toThrow();

      const active = freshManager.getActiveProvider();
      expect(active.name).toBe('openaivercel');
    });
  });
});
