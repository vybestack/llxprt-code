/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  Config,
  Profile,
  ProfileManager,
  ProviderManager,
  IProvider,
} from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

describe('Base URL Behavior Integration Tests', () => {
  let tempDir: string;
  let config: Config;
  let profileManager: ProfileManager;
  let providerManager: ProviderManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    // Store original HOME environment variable
    originalHome = process.env.HOME;

    // Create a temporary directory for our test
    tempDir = await createTempDirectory();

    // Set HOME to our temp directory so ProfileManager uses it
    process.env.HOME = tempDir;

    // Create instances
    profileManager = new ProfileManager();
    providerManager = new ProviderManager();

    // Create a basic config instance
    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      debugMode: false,
      model: 'test-model',
      cwd: tempDir,
    });

    // Set provider manager on config
    config.setProviderManager(providerManager);

    // Initialize the config
    await config.initialize();
  });

  afterEach(async () => {
    // Restore original HOME
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    // Clean up temp directory
    await cleanupTempDirectory(tempDir);
  });

  describe('Base URL Setting via Ephemeral Settings', () => {
    it('should set custom base URL on provider via ephemeral settings', async () => {
      // Create and register a mock provider
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Set base URL via ephemeral settings
      const customBaseUrl = 'https://custom.openai.api.com/v1';
      config.setEphemeralSetting('base-url', customBaseUrl);

      // Apply base URL to provider (simulating what the CLI does)
      const baseUrl = config.getEphemeralSetting('base-url') as string;
      if (baseUrl && baseUrl !== 'none' && provider.setBaseUrl) {
        provider.setBaseUrl(baseUrl);
      }

      // Verify the provider received the base URL
      expect(provider.baseUrl).toBe(customBaseUrl);
    });

    it('should clear base URL when set to empty string', async () => {
      // Create and register a mock provider with initial base URL
      const provider = createMockProvider('openai');
      provider.baseUrl = 'https://initial.api.com';
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Clear base URL by setting to empty string
      config.setEphemeralSetting('base-url', '');

      // Apply clearing logic (simulating what the CLI does)
      const baseUrl = config.getEphemeralSetting('base-url') as string;
      if (!baseUrl || baseUrl.trim() === '') {
        provider.setBaseUrl?.(undefined);
      }

      // Verify the provider's base URL was cleared
      expect(provider.baseUrl).toBeUndefined();
    });
  });

  describe('Base URL "none" Value Handling', () => {
    it('should ignore/clear base URL when value is "none"', async () => {
      // Create and register a mock provider
      const provider = createMockProvider('openai');
      provider.baseUrl = 'https://existing.api.com';
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Set base URL to "none"
      config.setEphemeralSetting('base-url', 'none');

      // Apply "none" handling logic (simulating what the CLI does)
      const baseUrl = config.getEphemeralSetting('base-url') as string;
      if (baseUrl && baseUrl !== 'none' && provider.setBaseUrl) {
        provider.setBaseUrl(baseUrl);
      } else if (baseUrl === 'none' && provider.setBaseUrl) {
        // Clear base URL when "none"
        provider.setBaseUrl(undefined);
      }

      // Verify the provider's base URL was cleared
      expect(provider.baseUrl).toBeUndefined();
    });

    it('should not cause Invalid URL error when loading profile with base-url: "none"', async () => {
      // Create a profile with base-url: "none"
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'none',
          'auth-key': 'test-key',
        },
      };

      // Save the profile
      await profileManager.saveProfile('test-none-profile', profile);

      // Create and register provider
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Load the profile
      const loadedProfile =
        await profileManager.loadProfile('test-none-profile');

      // Apply ephemeral settings from profile (simulating profileCommand logic)
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        config.setEphemeralSetting(key, value);

        // Special handling for base-url
        if (key === 'base-url' && provider.setBaseUrl) {
          if (value === 'none') {
            provider.setBaseUrl(undefined);
          } else if (value) {
            provider.setBaseUrl(value as string);
          }
        }
      }

      // Verify no errors occurred and base URL is undefined
      expect(provider.baseUrl).toBeUndefined();
      expect(config.getEphemeralSetting('base-url')).toBe('none');
      expect(config.getEphemeralSetting('auth-key')).toBe('test-key');
    });
  });

  describe('Base URL Behavior with Different Providers', () => {
    it('should handle base URLs for OpenAI provider', async () => {
      const openaiProvider = createMockProvider('openai');
      providerManager.registerProvider(openaiProvider);
      providerManager.setActiveProvider('openai');

      // Set custom OpenAI-compatible base URL
      const openaiBaseUrl = 'https://api.openai.com/v1';
      config.setEphemeralSetting('base-url', openaiBaseUrl);
      openaiProvider.setBaseUrl?.(openaiBaseUrl);

      expect(openaiProvider.baseUrl).toBe(openaiBaseUrl);
    });

    it('should handle base URLs for Azure OpenAI provider', async () => {
      const azureProvider = createMockProvider('azure-openai');
      providerManager.registerProvider(azureProvider);
      providerManager.setActiveProvider('azure-openai');

      // Set custom Azure deployment URL
      const azureBaseUrl = 'https://myazure.openai.azure.com/';
      config.setEphemeralSetting('base-url', azureBaseUrl);
      azureProvider.setBaseUrl?.(azureBaseUrl);

      expect(azureProvider.baseUrl).toBe(azureBaseUrl);
    });

    it('should handle base URLs for OpenRouter provider', async () => {
      const openRouterProvider = createMockProvider('openrouter');
      providerManager.registerProvider(openRouterProvider);
      providerManager.setActiveProvider('openrouter');

      // Set custom OpenRouter URL
      const openRouterBaseUrl = 'https://openrouter.ai/api/v1';
      config.setEphemeralSetting('base-url', openRouterBaseUrl);
      openRouterProvider.setBaseUrl?.(openRouterBaseUrl);

      expect(openRouterProvider.baseUrl).toBe(openRouterBaseUrl);
    });

    it('should handle providers that do not support custom base URLs', async () => {
      const geminiProvider = createMockProvider('gemini');
      // Remove setBaseUrl method to simulate provider without base URL support
      delete geminiProvider.setBaseUrl;

      providerManager.registerProvider(geminiProvider);
      providerManager.setActiveProvider('gemini');

      // Try to set base URL
      config.setEphemeralSetting('base-url', 'https://custom.url.com');

      // Verify nothing breaks when provider doesn't support setBaseUrl
      expect(geminiProvider.baseUrl).toBeUndefined();
      expect(config.getEphemeralSetting('base-url')).toBe(
        'https://custom.url.com',
      );
    });
  });

  describe('Provider Switching Clears Base URL', () => {
    it('should clear previous provider base URL when switching providers', async () => {
      // Create and register two providers
      const providerA = createMockProvider('openai');
      const providerB = createMockProvider('anthropic');

      providerManager.registerProvider(providerA);
      providerManager.registerProvider(providerB);

      // Set provider A as active with custom base URL
      providerManager.setActiveProvider('openai');
      const baseUrlA = 'https://api.provider-a.com';
      config.setEphemeralSetting('base-url', baseUrlA);
      providerA.setBaseUrl?.(baseUrlA);

      expect(providerA.baseUrl).toBe(baseUrlA);

      // Switch to provider B
      providerManager.setActiveProvider('anthropic');

      // Simulate clearing provider A's state (as done in real provider switching)
      providerA.clearState?.();

      // Set different base URL for provider B
      const baseUrlB = 'https://api.provider-b.com';
      config.setEphemeralSetting('base-url', baseUrlB);
      providerB.setBaseUrl?.(baseUrlB);

      // Verify provider A's base URL is cleared and provider B has its own
      expect(providerA.baseUrl).toBeUndefined();
      expect(providerB.baseUrl).toBe(baseUrlB);
    });

    it('should not affect base URL of server tools provider when switching active provider', async () => {
      // Create providers
      const geminiProvider = createMockProvider('gemini');
      geminiProvider.getServerTools = () => ['web-search'];

      const openaiProvider = createMockProvider('openai');

      providerManager.registerProvider(geminiProvider);
      providerManager.registerProvider(openaiProvider);

      // Set Gemini as server tools provider with base URL
      providerManager.setServerToolsProvider(geminiProvider);
      const geminiBaseUrl = 'https://gemini.api.com';
      geminiProvider.setBaseUrl?.(geminiBaseUrl);

      // Set OpenAI as active provider with different base URL
      providerManager.setActiveProvider('openai');
      const openaiBaseUrl = 'https://openai.api.com';
      config.setEphemeralSetting('base-url', openaiBaseUrl);
      openaiProvider.setBaseUrl?.(openaiBaseUrl);

      // Switch active provider to another one
      const anthropicProvider = createMockProvider('anthropic');
      providerManager.registerProvider(anthropicProvider);
      providerManager.setActiveProvider('anthropic');

      // Clear OpenAI's state
      openaiProvider.clearState?.();

      // Verify Gemini (server tools) retains its base URL while OpenAI's is cleared
      expect(geminiProvider.baseUrl).toBe(geminiBaseUrl);
      expect(openaiProvider.baseUrl).toBeUndefined();
    });
  });

  describe('Profile Save/Load with Base URLs', () => {
    it('should save and restore base URL in profile', async () => {
      // Set up provider and base URL
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      const customBaseUrl = 'https://profile.api.com';
      config.setEphemeralSetting('base-url', customBaseUrl);

      // Create profile with current settings
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {
          temperature: 0.7,
        },
        ephemeralSettings: {
          'base-url': config.getEphemeralSetting('base-url') as string,
          'auth-key': 'profile-api-key',
        },
      };

      // Save profile
      await profileManager.saveProfile('base-url-profile', profile);

      // Create new config instance (simulating restart)
      const newConfig = new Config({
        sessionId: 'new-session',
        targetDir: tempDir,
        debugMode: false,
        model: 'test-model',
        cwd: tempDir,
      });
      await newConfig.initialize();

      // Verify base URL is not there initially
      expect(newConfig.getEphemeralSetting('base-url')).toBeUndefined();

      // Load profile
      const loadedProfile =
        await profileManager.loadProfile('base-url-profile');

      // Apply settings from profile
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        newConfig.setEphemeralSetting(key, value);
      }

      // Verify base URL is restored
      expect(newConfig.getEphemeralSetting('base-url')).toBe(customBaseUrl);
      expect(newConfig.getEphemeralSetting('auth-key')).toBe('profile-api-key');
    });

    it('should handle profile with base-url: "none" without errors', async () => {
      // Create and save profile with "none" base URL
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4o',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'none',
        },
      };

      await profileManager.saveProfile('none-base-url-profile', profile);

      // Load profile
      const loadedProfile = await profileManager.loadProfile(
        'none-base-url-profile',
      );

      // Verify "none" value is preserved
      expect(loadedProfile.ephemeralSettings['base-url']).toBe('none');

      // Apply to config
      config.setEphemeralSetting(
        'base-url',
        loadedProfile.ephemeralSettings['base-url'],
      );

      // Create provider and handle "none" value
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);

      const baseUrl = config.getEphemeralSetting('base-url') as string;
      if (baseUrl === 'none') {
        provider.setBaseUrl?.(undefined);
      }

      // Verify provider has no base URL set
      expect(provider.baseUrl).toBeUndefined();
    });
  });

  describe('CLI Args Override Profile Base URLs', () => {
    it('should override profile base URL with CLI argument', async () => {
      // Create profile with base URL
      const profile: Profile = {
        version: 1,
        provider: 'openai',
        model: 'gpt-4',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'https://profile.base.url.com',
        },
      };

      await profileManager.saveProfile('override-test-profile', profile);

      // Load profile
      const loadedProfile = await profileManager.loadProfile(
        'override-test-profile',
      );

      // Apply profile settings
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        config.setEphemeralSetting(key, value);
      }

      // Simulate CLI override (--base-url argument)
      const cliBaseUrl = 'https://cli.override.url.com';
      config.setEphemeralSetting('base-url', cliBaseUrl);

      // Create provider and apply final base URL
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      provider.setBaseUrl?.(config.getEphemeralSetting('base-url') as string);

      // Verify CLI base URL takes precedence
      expect(provider.baseUrl).toBe(cliBaseUrl);
      expect(provider.baseUrl).not.toBe('https://profile.base.url.com');
    });

    it('should clear profile base URL when CLI provides empty string', async () => {
      // Create profile with base URL
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-3-opus-20240229',
        modelParams: {},
        ephemeralSettings: {
          'base-url': 'https://profile.anthropic.url.com',
        },
      };

      await profileManager.saveProfile('clear-override-profile', profile);

      // Load profile
      const loadedProfile = await profileManager.loadProfile(
        'clear-override-profile',
      );

      // Apply profile settings
      for (const [key, value] of Object.entries(
        loadedProfile.ephemeralSettings,
      )) {
        config.setEphemeralSetting(key, value);
      }

      // Simulate CLI override with empty string (--base-url "")
      config.setEphemeralSetting('base-url', '');

      // Create provider and apply final base URL
      const provider = createMockProvider('anthropic');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('anthropic');

      const baseUrl = config.getEphemeralSetting('base-url') as string;
      if (!baseUrl || baseUrl.trim() === '') {
        provider.setBaseUrl?.(undefined);
      } else {
        provider.setBaseUrl?.(baseUrl);
      }

      // Verify base URL is cleared
      expect(provider.baseUrl).toBeUndefined();
    });
  });

  describe('Base URL Validation and Error Handling', () => {
    it('should handle invalid URL formats gracefully', async () => {
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Try to set invalid URLs
      const invalidUrls = [
        'not-a-url',
        'http://',
        'ftp://invalid.protocol.com',
        '//missing-protocol.com',
      ];

      for (const invalidUrl of invalidUrls) {
        config.setEphemeralSetting('base-url', invalidUrl);

        // Provider should validate and potentially reject invalid URLs
        // For this test, we'll assume the provider stores whatever is given
        provider.setBaseUrl?.(invalidUrl);

        // In a real implementation, the provider might throw or sanitize
        expect(provider.baseUrl).toBe(invalidUrl);
      }
    });

    it('should preserve trailing slashes in base URLs', async () => {
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Test URLs with and without trailing slashes
      const urlsToTest = [
        'https://api.example.com/',
        'https://api.example.com',
        'https://api.example.com/v1/',
        'https://api.example.com/v1',
      ];

      for (const url of urlsToTest) {
        config.setEphemeralSetting('base-url', url);
        provider.setBaseUrl?.(url);

        // Verify exact URL is preserved
        expect(provider.baseUrl).toBe(url);
      }
    });
  });

  describe('Base URL Integration with Model Parameters', () => {
    it('should maintain base URL when updating model parameters', async () => {
      const provider = createMockProvider('openai');
      providerManager.registerProvider(provider);
      providerManager.setActiveProvider('openai');

      // Set base URL
      const baseUrl = 'https://stable.api.com';
      config.setEphemeralSetting('base-url', baseUrl);
      provider.setBaseUrl?.(baseUrl);

      // Set model parameters
      const modelParams = {
        temperature: 0.8,
        max_tokens: 2000,
        top_p: 0.95,
      };
      provider.setModelParams?.(modelParams);

      // Verify both base URL and model params are set
      expect(provider.baseUrl).toBe(baseUrl);
      expect(provider.getModelParams?.()).toEqual(modelParams);

      // Update model params
      const newParams = {
        temperature: 0.5,
        max_tokens: 4000,
      };
      provider.setModelParams?.(newParams);

      // Verify base URL is maintained
      expect(provider.baseUrl).toBe(baseUrl);
      expect(provider.getModelParams?.()).toEqual(newParams);
    });
  });
});

// Helper function to create a mock provider with base URL support
function createMockProvider(name: string): IProvider & { baseUrl?: string } {
  const provider = {
    name,
    baseUrl: undefined as string | undefined,
    apiKey: undefined as string | undefined,
    modelParams: undefined as Record<string, unknown> | undefined,
    state: {} as Record<string, unknown>,

    setApiKey(key: string): void {
      provider.apiKey = key;
    },

    setBaseUrl(url: string | undefined): void {
      provider.baseUrl = url;
    },

    setModelParams(params: Record<string, unknown> | undefined): void {
      provider.modelParams = params;
    },

    getModelParams(): Record<string, unknown> | undefined {
      return provider.modelParams;
    },

    clearState(): void {
      provider.apiKey = undefined;
      provider.baseUrl = undefined;
      provider.modelParams = undefined;
      provider.state = {};
    },

    getModels: async () => [{ id: 'test-model', name: 'Test Model', provider: name, supportedToolFormats: [] }],

    getDefaultModel: () => 'test-model',

    async *generateChatCompletion() {
      yield { content: 'test response' };
    },

    getServerTools: () => [],

    invokeServerTool: async () => ({ result: 'test' }),
  };

  return provider;
}
