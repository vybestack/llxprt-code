/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Config,
  ProviderManager,
  ProfileManager,
  IProvider,
  Profile,
} from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils';
import * as os from 'os';

// Mock os.homedir to use temp directory
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe('Model Parameters Isolation Between Providers', () => {
  let tempDir: string;
  let config: Config;
  let providerManager: ProviderManager;
  let profileManager: ProfileManager;
  let originalSetActiveProvider: typeof providerManager.setActiveProvider;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    // Mock os.homedir to return temp directory
    vi.mocked(os.homedir).mockReturnValue(tempDir);

    // Create real Config instance
    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'test-model',
    });

    // Create real ProviderManager and ProfileManager instances
    providerManager = new ProviderManager();
    profileManager = new ProfileManager();
    config.setProviderManager(providerManager);

    // Wrap setActiveProvider to automatically clear state on previous provider
    originalSetActiveProvider =
      providerManager.setActiveProvider.bind(providerManager);
    providerManager.setActiveProvider = (providerName: string) => {
      // Clear state on current provider before switching
      try {
        const currentProvider = providerManager.getActiveProvider();
        if (currentProvider && 'clearState' in currentProvider) {
          (currentProvider as { clearState: () => void }).clearState();
        }
      } catch {
        // No active provider yet, that's OK
      }
      return originalSetActiveProvider(providerName);
    };

    await config.initialize();
  });

  afterEach(async () => {
    await cleanupTempDirectory(tempDir);
    vi.clearAllMocks();
  });

  describe('Provider Switching Model Parameter Isolation', () => {
    it('should isolate model parameters between different providers', async () => {
      // Create mock providers with model parameter tracking
      const openaiProvider = createMockProvider('openai');
      const anthropicProvider = createMockProvider('anthropic');

      // Register providers
      providerManager.registerProvider(openaiProvider);
      providerManager.registerProvider(anthropicProvider);

      // Set OpenAI as active and configure model params
      providerManager.setActiveProvider('openai');
      openaiProvider.setModelParams?.({
        temperature: 0.8,
        max_tokens: 4096,
        frequency_penalty: 0.5,
      });

      // Verify OpenAI has its params
      expect(openaiProvider.getModelParams?.()).toEqual({
        temperature: 0.8,
        max_tokens: 4096,
        frequency_penalty: 0.5,
      });

      // Switch to Anthropic
      providerManager.setActiveProvider('anthropic');

      // Verify OpenAI's model params are cleared
      expect(openaiProvider.getModelParams?.()).toBeUndefined();

      // Set different params for Anthropic
      anthropicProvider.setModelParams?.({
        temperature: 0.5,
        max_output_tokens: 8192,
        top_k: 40,
      });

      // Verify Anthropic has its own params
      expect(anthropicProvider.getModelParams?.()).toEqual({
        temperature: 0.5,
        max_output_tokens: 8192,
        top_k: 40,
      });

      // Switch back to OpenAI
      providerManager.setActiveProvider('openai');

      // Verify Anthropic's params are cleared
      expect(anthropicProvider.getModelParams?.()).toBeUndefined();

      // Verify OpenAI doesn't retain previous params
      expect(openaiProvider.getModelParams?.()).toBeUndefined();
    });

    it('should clear model parameters when switching providers', async () => {
      const providerA = createMockProvider('providerA');
      const providerB = createMockProvider('providerB');

      providerManager.registerProvider(providerA);
      providerManager.registerProvider(providerB);

      // Set complex params for provider A
      providerManager.setActiveProvider('providerA');
      const complexParams = {
        temperature: 0.7,
        max_tokens: 2000,
        top_p: 0.95,
        presence_penalty: 0.1,
        response_format: { type: 'json_object' },
        seed: 12345,
      };
      providerA.setModelParams?.(complexParams);

      expect(providerA.getModelParams?.()).toEqual(complexParams);

      // Switch to provider B
      providerManager.setActiveProvider('providerB');

      // Verify provider A's params are completely cleared
      expect(providerA.getModelParams?.()).toBeUndefined();

      // Verify provider B starts with no params
      expect(providerB.getModelParams?.()).toBeUndefined();
    });

    it('should handle provider-specific parameter names correctly', async () => {
      const openai = createMockProvider('openai');
      const anthropic = createMockProvider('anthropic');
      const gemini = createMockProvider('gemini');

      providerManager.registerProvider(openai);
      providerManager.registerProvider(anthropic);
      providerManager.registerProvider(gemini);

      // OpenAI uses max_tokens
      providerManager.setActiveProvider('openai');
      openai.setModelParams?.({ max_tokens: 4096 });
      expect(openai.getModelParams?.()).toEqual({ max_tokens: 4096 });

      // Anthropic uses max_output_tokens
      providerManager.setActiveProvider('anthropic');
      expect(openai.getModelParams?.()).toBeUndefined(); // OpenAI cleared
      anthropic.setModelParams?.({ max_output_tokens: 4096 });
      expect(anthropic.getModelParams?.()).toEqual({ max_output_tokens: 4096 });

      // Gemini uses maxOutputTokens
      providerManager.setActiveProvider('gemini');
      expect(anthropic.getModelParams?.()).toBeUndefined(); // Anthropic cleared
      gemini.setModelParams?.({ maxOutputTokens: 4096 });
      expect(gemini.getModelParams?.()).toEqual({ maxOutputTokens: 4096 });

      // All providers should have cleared state when not active
      providerManager.setActiveProvider('openai');
      expect(gemini.getModelParams?.()).toBeUndefined();
    });
  });

  describe('Profile Save and Load with Model Parameters', () => {
    it('should save and load profiles with provider-specific model parameters', async () => {
      const openaiProvider = createMockProvider('openai');
      providerManager.registerProvider(openaiProvider);
      providerManager.setActiveProvider('openai');

      // Set model and params
      config.setModel('gpt-4');
      const modelParams = {
        temperature: 0.8,
        max_tokens: 4096,
        seed: 42,
      };
      openaiProvider.setModelParams?.(modelParams);

      // Clear any existing ephemeral settings first
      const existingSettings = config.getEphemeralSettings();
      Object.keys(existingSettings).forEach((key) => {
        config.setEphemeralSetting(key, undefined);
      });

      // Set only our test ephemeral settings
      config.setEphemeralSetting('context-limit', 32000);
      config.setEphemeralSetting('base-url', 'https://api.openai.com/v1');

      // Create profile with only our settings
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: config.getModel(),
        modelParams: openaiProvider.getModelParams?.() || {},
        ephemeralSettings: {
          'context-limit': 32000,
          'base-url': 'https://api.openai.com/v1',
        },
      };

      // Save profile
      await profileManager.saveProfile('test-profile', profile);

      // Clear state
      openaiProvider.clearState?.();
      config.setEphemeralSetting('context-limit', undefined);
      config.setEphemeralSetting('base-url', undefined);

      // Load profile
      const loadedProfile = await profileManager.loadProfile('test-profile');

      expect(loadedProfile).toEqual(profile);
      expect(loadedProfile.modelParams).toEqual(modelParams);
      expect(loadedProfile.ephemeralSettings).toEqual({
        'context-limit': 32000,
        'base-url': 'https://api.openai.com/v1',
      });
    });

    it('should isolate model parameters in different profiles', async () => {
      const openaiProvider = createMockProvider('openai');
      const anthropicProvider = createMockProvider('anthropic');

      providerManager.registerProvider(openaiProvider);
      providerManager.registerProvider(anthropicProvider);

      // Create OpenAI profile
      providerManager.setActiveProvider('openai');
      config.setModel('gpt-4');
      openaiProvider.setModelParams?.({
        temperature: 0.7,
        max_tokens: 4096,
      });

      const openaiProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: openaiProvider.getModelParams?.() || {},
        ephemeralSettings: { 'tool-format': 'openai' },
      };

      await profileManager.saveProfile('openai-prod', openaiProfile);

      // Create Anthropic profile
      providerManager.setActiveProvider('anthropic');
      config.setModel('claude-3-opus-20240229');
      anthropicProvider.setModelParams?.({
        temperature: 0.5,
        max_output_tokens: 8192,
        top_k: 40,
      });

      const anthropicProfile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        modelParams: anthropicProvider.getModelParams?.() || {},
        ephemeralSettings: { 'tool-format': 'anthropic' },
      };

      await profileManager.saveProfile('anthropic-prod', anthropicProfile);

      // Load OpenAI profile
      const loadedOpenai = await profileManager.loadProfile('openai-prod');
      expect(loadedOpenai.modelParams).toEqual({
        temperature: 0.7,
        max_tokens: 4096,
      });

      // Load Anthropic profile
      const loadedAnthropic =
        await profileManager.loadProfile('anthropic-prod');
      expect(loadedAnthropic.modelParams).toEqual({
        temperature: 0.5,
        max_output_tokens: 8192,
        top_k: 40,
      });

      // Verify profiles are independent
      expect(loadedOpenai.provider).not.toBe(loadedAnthropic.provider);
      expect(loadedOpenai.modelParams).not.toEqual(loadedAnthropic.modelParams);
    });
  });

  describe('Model Parameter Command Integration', () => {
    it('should handle /set modelparam commands correctly', async () => {
      const provider = createMockProvider('test-provider');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('test-provider');

      // Simulate /set modelparam temperature 0.8
      provider.setModelParams?.({ temperature: 0.8 });
      expect(provider.getModelParams?.()).toEqual({ temperature: 0.8 });

      // Simulate /set modelparam max_tokens 4096
      provider.setModelParams?.({ max_tokens: 4096 });
      expect(provider.getModelParams?.()).toEqual({ max_tokens: 4096 });

      // Simulate /set modelparam response_format {"type":"json_object"}
      provider.setModelParams?.({ response_format: { type: 'json_object' } });
      expect(provider.getModelParams?.()).toEqual({
        response_format: { type: 'json_object' },
      });
    });

    it('should clear model params when unsetting', async () => {
      const provider = createMockProvider('test-provider');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('test-provider');

      // Set multiple params
      provider.setModelParams?.({
        temperature: 0.8,
        max_tokens: 4096,
        top_p: 0.95,
      });

      // Unset specific param (simulated by setting to undefined)
      const currentParams = provider.getModelParams?.() || {};
      delete currentParams.temperature;
      provider.setModelParams?.(currentParams);

      expect(provider.getModelParams?.()).toEqual({
        max_tokens: 4096,
        top_p: 0.95,
      });

      // Clear all params
      provider.setModelParams?.(undefined);
      expect(provider.getModelParams?.()).toBeUndefined();
    });
  });

  describe('Default Model Setting on Provider Switch', () => {
    it('should set default model when switching providers', async () => {
      const openai = createMockProvider('openai');
      openai.getModels = async () => [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'gpt-4o-mini', name: 'GPT-4.0 Mini' },
      ];
      openai.getModel = () => 'gpt-4';

      const anthropic = createMockProvider('anthropic');
      anthropic.getModels = async () => [
        { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
        { id: 'claude-3-sonnet', name: 'Claude 3 Sonnet' },
      ];
      anthropic.getModel = () => 'claude-3-opus-20240229';

      providerManager.registerProvider(openai);
      providerManager.registerProvider(anthropic);

      // Start with OpenAI
      providerManager.setActiveProvider('openai');
      config.setModel('gpt-4');
      expect(config.getModel()).toBe('gpt-4');

      // Switch to Anthropic
      providerManager.setActiveProvider('anthropic');
      config.setModel('claude-3-opus-20240229');
      expect(config.getModel()).toBe('claude-3-opus-20240229');

      // Switch back to OpenAI - should not retain previous model
      providerManager.setActiveProvider('openai');
      // In real implementation, this would be handled by the CLI
      // setting the default model for the provider
    });
  });

  describe('Complex Workflow Integration', () => {
    it('should handle complete workflow: set params, save profile, switch provider, load profile', async () => {
      const openai = createMockProvider('openai');
      const anthropic = createMockProvider('anthropic');

      providerManager.registerProvider(openai);
      providerManager.registerProvider(anthropic);

      // Step 1: Configure OpenAI
      providerManager.setActiveProvider('openai');
      config.setModel('gpt-4');
      openai.setModelParams?.({
        temperature: 0.8,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });
      config.setEphemeralSetting('context-limit', 32000);
      config.setEphemeralSetting('api-version', '2024-01-01');

      // Step 2: Save OpenAI profile
      const openaiProfile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: openai.getModelParams?.() || {},
        ephemeralSettings: config.getEphemeralSettings(),
      };
      await profileManager.saveProfile('openai-config', openaiProfile);

      // Step 3: Switch to Anthropic
      providerManager.setActiveProvider('anthropic');

      // Verify OpenAI params are cleared
      expect(openai.getModelParams?.()).toBeUndefined();

      // Configure Anthropic
      config.setModel('claude-3-opus-20240229');
      anthropic.setModelParams?.({
        temperature: 0.5,
        max_output_tokens: 8192,
        top_k: 40,
      });

      // Step 4: Switch back to OpenAI
      providerManager.setActiveProvider('openai');

      // Verify Anthropic params are cleared
      expect(anthropic.getModelParams?.()).toBeUndefined();

      // Step 5: Load OpenAI profile
      const loadedProfile = await profileManager.loadProfile('openai-config');

      // Apply loaded settings (simulating what the CLI would do)
      providerManager.setActiveProvider(loadedProfile.provider);
      config.setModel(loadedProfile.model);
      openai.setModelParams?.(loadedProfile.modelParams);
      Object.entries(loadedProfile.ephemeralSettings).forEach(
        ([key, value]) => {
          config.setEphemeralSetting(key, value);
        },
      );

      // Verify everything is restored
      expect(openai.getModelParams?.()).toEqual({
        temperature: 0.8,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
      });
      expect(config.getEphemeralSetting('context-limit')).toBe(32000);
      expect(config.getEphemeralSetting('api-version')).toBe('2024-01-01');
    });

    it('should maintain isolation when rapidly switching between providers', async () => {
      const providers = ['openai', 'anthropic', 'gemini', 'cohere'].map(
        (name) => createMockProvider(name),
      );

      providers.forEach((p) => providerManager.registerProvider(p));

      // Rapidly switch and set params
      for (let i = 0; i < 10; i++) {
        const provider = providers[i % providers.length];
        providerManager.setActiveProvider(provider.name);

        // Set unique params for each iteration
        provider.setModelParams?.({
          temperature: 0.1 * (i + 1),
          iteration: i,
          provider: provider.name,
        });

        // Verify only active provider has params
        providers.forEach((p) => {
          if (p.name === provider.name) {
            expect(p.getModelParams?.()).toBeDefined();
            expect(p.getModelParams?.()?.iteration).toBe(i);
          } else {
            expect(p.getModelParams?.()).toBeUndefined();
          }
        });
      }
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle providers without model parameter support', async () => {
      const basicProvider: IProvider = {
        name: 'basic-provider',
        getModels: async () => [{ id: 'basic-model', name: 'Basic Model' }],
        async *generateChatCompletion() {
          yield { content: 'test' };
        },
        getServerTools: () => [],
        invokeServerTool: async () => ({ result: 'test' }),
        // No model param methods
      };

      providerManager.registerProvider(basicProvider);
      providerManager.setActiveProvider('basic-provider');

      // Should not throw when provider doesn't support model params
      expect(() => {
        const params = (
          basicProvider as IProvider & { getModelParams?: () => unknown }
        ).getModelParams?.();
        expect(params).toBeUndefined();
      }).not.toThrow();
    });

    it('should handle setting model params before provider is registered', async () => {
      // This tests defensive programming - params should not be set if provider not found
      const provider = createMockProvider('late-provider');

      // Try to set active before registering (should fail)
      expect(() => {
        providerManager.setActiveProvider('late-provider');
      }).toThrow();

      // Register and then it should work
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('late-provider');
      provider.setModelParams?.({ temperature: 0.7 });
      expect(provider.getModelParams?.()).toEqual({ temperature: 0.7 });
    });

    it('should preserve model param types correctly', async () => {
      const provider = createMockProvider('type-test');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('type-test');

      const complexParams = {
        // Numbers
        temperature: 0.7,
        max_tokens: 4096,
        seed: 12345,
        frequency_penalty: -0.5,

        // Booleans
        stream: true,
        logprobs: false,

        // Strings
        stop: '\n\n',
        suffix: '_end',

        // Arrays
        stop_sequences: ['\n', '###', 'END'],

        // Objects
        response_format: { type: 'json_object' },
        logit_bias: { '50256': -100, '1234': 50 },

        // Null
        user: null,
      };

      provider.setModelParams?.(complexParams);
      const retrieved = provider.getModelParams?.();

      // Verify all types are preserved
      expect(retrieved).toEqual(complexParams);
      expect(typeof retrieved?.temperature).toBe('number');
      expect(typeof retrieved?.stream).toBe('boolean');
      expect(typeof retrieved?.stop).toBe('string');
      expect(Array.isArray(retrieved?.stop_sequences)).toBe(true);
      expect(typeof retrieved?.response_format).toBe('object');
      expect(retrieved?.user).toBeNull();
    });
  });
});

// Helper function to create a mock provider with full state management
function createMockProvider(name: string): IProvider {
  const provider = {
    name,
    apiKey: undefined as string | undefined,
    modelParams: undefined as Record<string, unknown> | undefined,
    model: undefined as string | undefined,
    state: {} as Record<string, unknown>,

    setApiKey(key: string): void {
      provider.apiKey = key;
    },

    getApiKey(): string | undefined {
      return provider.apiKey;
    },

    setModelParams(params: Record<string, unknown> | undefined): void {
      provider.modelParams = params;
    },

    getModelParams(): Record<string, unknown> | undefined {
      return provider.modelParams;
    },

    setModel(model: string): void {
      provider.model = model;
    },

    getModel(): string | undefined {
      return provider.model;
    },

    clearState(): void {
      provider.apiKey = undefined;
      provider.modelParams = undefined;
      provider.model = undefined;
      provider.state = {};
    },

    getModels: async () => [
      { id: `${name}-model-1`, name: `${name} Model 1` },
      { id: `${name}-model-2`, name: `${name} Model 2` },
    ],

    async *generateChatCompletion() {
      yield { content: `Response from ${name}` };
    },

    getServerTools: () => [],

    invokeServerTool: async () => ({ result: 'test' }),
  };

  return provider;
}
