/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  Config,
  Profile,
  ProfileManager,
  ProviderManager,
  IProvider,
  createProviderRuntimeContext,
  SettingsService,
} from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';
import { createProviderManager } from '../providers/providerManagerInstance.js';
import {
  setCliRuntimeContext,
  switchActiveProvider,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
} from '../runtime/runtimeSettings.js';
import { setProviderBaseUrl } from '../providers/providerConfigUtils.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * Validates that runtime helpers control provider base-url behavior rather
 * than direct provider mutations.
 * @pseudocode:cli-runtime.md lines 9-15
 */
describe('Base URL Runtime Helper Integration', () => {
  let tempDir: string;
  let config: Config;
  let providerManager: ProviderManager;
  let profileManager: ProfileManager;
  let settingsService: SettingsService;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      debugMode: false,
      model: 'test-model',
      cwd: tempDir,
    });
    await config.initialize();

    settingsService = config.getSettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      config,
      metadata: { source: 'base-url-test' },
    });
    const { manager, oauthManager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });
    providerManager = manager;
    registerCliProviderInfrastructure(providerManager, oauthManager);
    setCliRuntimeContext(settingsService, config, {
      metadata: { source: 'base-url-test' },
    });

    profileManager = new ProfileManager();
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    await cleanupTempDirectory(tempDir);
  });

  it('applies custom base URL via runtime helper', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    providerManager.setActiveProvider('openai');

    const customUrl = 'https://custom.openai.api/v1';
    const result = await setProviderBaseUrl(customUrl);

    expect(result.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBe(customUrl);
    expect(config.getEphemeralSetting('base-url')).toBe(customUrl);
  });

  it('clears base URL when helper receives empty or "none" values', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    providerManager.setActiveProvider('openai');

    await setProviderBaseUrl('https://custom.openai.api/v1');
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBe('https://custom.openai.api/v1');

    const clearResult = await setProviderBaseUrl('none');
    expect(clearResult.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(config.getEphemeralSetting('base-url')).toBeUndefined();

    const emptyResult = await setProviderBaseUrl('');
    expect(emptyResult.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
  });

  it('stores base URL even when provider lacks direct override hook', async () => {
    const provider = createMockProvider('gemini');

    providerManager.registerProvider(provider);
    providerManager.setActiveProvider('gemini');

    const result = await setProviderBaseUrl('https://gemini.example/v1');
    expect(result.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('gemini')['base-url'],
    ).toBe('https://gemini.example/v1');
  });

  it('clears previous provider base URL when switching providers', async () => {
    const providerA = createMockProvider('openai');
    const providerB = createMockProvider('anthropic');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    providerManager.setActiveProvider('openai');
    await setProviderBaseUrl('https://provider-a.example');
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBe('https://provider-a.example');

    await switchActiveProvider('anthropic');
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(
      config.getSettingsService().getProviderSettings('anthropic')['base-url'],
    ).toBeUndefined();
  });

  it('preserves profile base URL when loading via ProfileManager', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    providerManager.setActiveProvider('openai');

    const profile: Profile = {
      version: 1,
      provider: 'openai',
      model: 'gpt-4o-mini',
      modelParams: {},
      ephemeralSettings: {
        'base-url': 'https://profile.base.url',
      },
    };
    await profileManager.saveProfile('profile-with-base', profile);

    const loaded = await profileManager.loadProfile('profile-with-base');
    expect(loaded.ephemeralSettings['base-url']).toBe(
      'https://profile.base.url',
    );

    const result = await setProviderBaseUrl(
      loaded.ephemeralSettings['base-url'] as string,
    );
    expect(result.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('openai')['base-url'],
    ).toBe('https://profile.base.url');
  });
});

function createMockProvider(
  name: string,
): IProvider & { baseUrl?: string; clearState?: () => void } {
  const provider: IProvider & {
    baseUrl?: string;
    clearState?: () => void;
  } = {
    name,
    baseUrl: undefined,
    async getModels() {
      return [
        {
          id: 'test-model',
          name: 'Test Model',
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: 'test response' }],
      };
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
    getDefaultModel() {
      return 'test-model';
    },
  };

  provider.clearState = () => {
    provider.baseUrl = undefined;
  };

  return provider;
}
