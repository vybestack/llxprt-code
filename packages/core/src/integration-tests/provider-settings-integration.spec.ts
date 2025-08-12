/**
 * Integration tests for Phase 12: Provider Settings Integration
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SettingsService } from '../settings/SettingsService.js';
import { FileSystemSettingsRepository } from '../settings/FileSystemSettingsRepository.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import { getSettingsService } from '../settings/settingsServiceInstance.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

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
  let tempDir: string;
  let settingsPath: string;

  beforeEach(async () => {
    // Create temporary directory for test settings
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'provider-settings-test-'),
    );
    settingsPath = path.join(tempDir, 'settings.json');

    // Create settings service
    const repository = new FileSystemSettingsRepository(settingsPath);
    settingsService = new SettingsService(repository);

    // Mock getSettingsService to return our test instance
    mockGetSettingsService.mockReturnValue(settingsService);

    // Create test provider with settings service using supported provider name
    testProvider = new TestProvider({
      name: 'openai',
      settingsService,
    });

    // Wait for settings service to initialize
    await new Promise((resolve) => {
      settingsService.on('initialized' as never, resolve);
    });
  });

  afterEach(async () => {
    // Clean up temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
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

    // Verify settings were updated directly through SettingsService
    const providerSettings = await settingsService.getSettings('openai');
    expect(providerSettings.model).toBe(testModel);

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

    // Verify settings are persisted to file
    const fileContent = await fs.readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(fileContent);
    expect(settings.providers.openai).toBeDefined();
    expect(settings.providers.openai.model).toBe(testModel);
    expect(settings.providers.openai.apiKey).toBe(testApiKey);
    expect(settings.providers.openai.baseUrl).toBe(testBaseUrl);
    expect(settings.providers.openai.temperature).toBe(0.8);
    expect(settings.providers.openai.maxTokens).toBe(2048);
  });

  it('should gracefully handle missing SettingsService', async () => {
    // Test provider without settings service
    const providerWithoutSettings = new TestProvider({
      name: 'test-no-settings',
    });

    // These should not throw errors even when SettingsService is not available
    await expect(
      providerWithoutSettings.setModelInSettings('test-model'),
    ).resolves.toBeUndefined();
    await expect(
      providerWithoutSettings.getModelFromSettings(),
    ).resolves.toBeUndefined();
    await expect(
      providerWithoutSettings.setApiKeyInSettings('test-key'),
    ).resolves.toBeUndefined();
    await expect(
      providerWithoutSettings.getApiKeyFromSettings(),
    ).resolves.toBeUndefined();
  });

  it('should use SettingsService for provider switching', async () => {
    // SettingsService is always enabled
    // Test provider switching through SettingsService with a known provider
    await settingsService.switchProvider('openai');

    // Verify the default provider was updated
    const settings = await settingsService.getSettings();
    expect(settings.defaultProvider).toBe('openai');

    // Verify the provider settings exist
    expect(settings.providers.openai).toBeDefined();
    expect(settings.providers.openai.enabled).toBe(true);
  });

  it('should maintain backward compatibility with SettingsService always enabled', async () => {
    // SettingsService is always enabled in the new architecture
    // Provider methods should work properly with SettingsService
    const provider = new TestProvider({
      name: 'test-compat',
      settingsService,
    });

    // These should work with SettingsService integration
    await expect(provider.getModelFromSettings()).resolves.not.toThrow();
    await expect(provider.getApiKeyFromSettings()).resolves.not.toThrow();
    await expect(provider.getBaseUrlFromSettings()).resolves.not.toThrow();
    await expect(provider.getModelParamsFromSettings()).resolves.not.toThrow();
  });
});
