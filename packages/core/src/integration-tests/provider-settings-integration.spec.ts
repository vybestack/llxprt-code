/**
 * Integration tests for Phase 12: Provider Settings Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsService } from '../settings/SettingsService.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import { createProviderWithRuntime } from '../test-utils/runtime.js';

// Mock the settings service instance
vi.mock('../settings/settingsServiceInstance.js');

const mockGetSettingsService = getSettingsService as vi.MockedFunction<
  typeof getSettingsService
>;

// Mock provider for testing
class TestProvider extends BaseProvider {
  protected supportsOAuth(): boolean {
    return false;
  }

  async getModels() {
    return [
      {
        id: 'test-model',
        name: 'Test Model',
        provider: 'test',
        supportedToolFormats: [],
      },
    ];
  }

  async *generateChatCompletion() {
    yield { role: 'assistant' as const, content: 'Test response' };
  }
}

describe('Provider Settings Integration', () => {
  let settingsService: SettingsService;
  let testProvider: TestProvider;
  let instantiateProvider: (name: string) => TestProvider;

  beforeEach(async () => {
    // Create settings service without repository (in-memory only)
    settingsService = new SettingsService();

    // Mock getSettingsService to return our test instance
    mockGetSettingsService.mockReturnValue(settingsService);

    instantiateProvider = (name: string) =>
      createProviderWithRuntime<TestProvider>(
        () =>
          new TestProvider({
            name,
          }),
        {
          settingsService,
          runtimeId: `provider.settings.integration.${name}`,
          metadata: { source: 'provider-settings-integration.spec.ts' },
        },
      ).provider;

    // Create test provider using supported provider name
    testProvider = instantiateProvider('openai');

    // Settings service is immediately ready (in-memory only)
  });

  afterEach(async () => {
    // Clean up settings service
    settingsService.clear();
  });

  it('should integrate provider with SettingsService always enabled', async () => {
    // SettingsService is always enabled in new architecture
    // Initialize provider settings first
    await settingsService.updateSettings('openai', {
      enabled: true,
      model: 'initial-model',
    });

    // Test model persistence
    const testModel = 'test-model-custom';
    await testProvider.setModelInSettings(testModel);
    const retrievedModel = await testProvider.getModelFromSettings();
    expect(retrievedModel).toBe(testModel);

    // Test API key persistence
    const testApiKey = 'test-api-key-12345';
    await testProvider.setApiKeyInSettings(testApiKey);
    const retrievedApiKey = await testProvider.getApiKeyFromSettings();
    expect(retrievedApiKey).toBe(testApiKey);

    // Test base URL persistence
    const testBaseUrl = 'https://test.example.com/v1';
    await testProvider.setBaseUrlInSettings(testBaseUrl);
    const retrievedBaseUrl = await testProvider.getBaseUrlFromSettings();
    expect(retrievedBaseUrl).toBe(testBaseUrl);

    // Test model parameters persistence
    const testParams = { temperature: 0.8, max_tokens: 2048 };
    await testProvider.setModelParamsInSettings(testParams);
    const retrievedParams = await testProvider.getModelParamsFromSettings();
    expect(retrievedParams).toEqual({ temperature: 0.8, max_tokens: 2048 });

    // Verify settings are persisted in memory
    const allSettings = await settingsService.getSettings();
    expect(allSettings.providers.openai).toBeDefined();
  });

  it('should work with global SettingsService', async () => {
    // Test provider uses global settings service
    const providerWithGlobalSettings = instantiateProvider('test-global');

    // These should work with global SettingsService
    await expect(
      providerWithGlobalSettings.setModelInSettings('test-model'),
    ).resolves.toBeUndefined();
    await expect(
      providerWithGlobalSettings.getModelFromSettings(),
    ).resolves.toBe('test-model');
    await expect(
      providerWithGlobalSettings.setApiKeyInSettings('test-key'),
    ).resolves.toBeUndefined();
    await expect(
      providerWithGlobalSettings.getApiKeyFromSettings(),
    ).resolves.toBe('test-key');
  });

  it('should use SettingsService for provider switching', async () => {
    // SettingsService is always enabled
    // Test provider switching through SettingsService with a known provider
    await settingsService.switchProvider('openai');

    // Verify the active provider was updated (not defaultProvider)
    const globalSettings = settingsService.getAllGlobalSettings();
    expect(globalSettings.activeProvider).toBe('openai');

    // Provider settings are created on demand when accessed
    const settings = await settingsService.getSettings();
    expect(settings.providers).toBeDefined();
  });

  it('should maintain backward compatibility with SettingsService always enabled', async () => {
    // SettingsService is always enabled in the new architecture
    // Provider methods should work properly with SettingsService
    const provider = instantiateProvider('test-compat');

    // These should work with SettingsService integration
    await expect(provider.getModelFromSettings()).resolves.not.toThrow();
    await expect(provider.getApiKeyFromSettings()).resolves.not.toThrow();
    await expect(provider.getBaseUrlFromSettings()).resolves.not.toThrow();
    await expect(provider.getModelParamsFromSettings()).resolves.not.toThrow();
  });
});
