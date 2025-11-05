/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  Config,
  IProvider,
  ProviderManager,
  SettingsService,
  createProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';
import { createProviderManager } from '../providers/providerManagerInstance.js';
import {
  setCliRuntimeContext,
  switchActiveProvider,
  setActiveModelParam,
  getActiveModelParams,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
} from '../runtime/runtimeSettings.js';
import { setProviderApiKey } from '../providers/providerConfigUtils.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * Ensures provider switching flows rely on runtime helpers instead of
 * mutating providers directly.
 * @pseudocode:cli-runtime.md lines 9-15
 */
describe('Runtime Provider Switching Integration', () => {
  let tempDir: string;
  let config: Config;
  let providerManager: ProviderManager;
  let settingsService: SettingsService;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    config = new Config({
      sessionId: 'switch-session',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'test-model',
    });
    await config.initialize();

    settingsService = config.getSettingsService();
    const runtime = createProviderRuntimeContext({
      settingsService,
      config,
      metadata: { source: 'provider-switch-test' },
    });
    const { manager, oauthManager } = createProviderManager(runtime, {
      allowBrowserEnvironment: true,
    });
    providerManager = manager;
    registerCliProviderInfrastructure(providerManager, oauthManager);
    setCliRuntimeContext(settingsService, config, {
      metadata: { source: 'provider-switch-test' },
    });
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    await cleanupTempDirectory(tempDir);
  });

  it('clears previous provider API key and auth state', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    providerManager.setActiveProvider('providerA');
    const setResult = await setProviderApiKey('key-for-provider-a');
    expect(setResult.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('providerA').apiKey,
    ).toBe('key-for-provider-a');
    expect(config.getEphemeralSetting('auth-key')).toBe('key-for-provider-a');

    await switchActiveProvider('providerB');
    expect(
      config.getSettingsService().getProviderSettings('providerA').apiKey,
    ).toBeUndefined();
    expect(config.getEphemeralSetting('auth-key')).toBeUndefined();

    const resultB = await setProviderApiKey('key-for-provider-b');
    expect(resultB.success).toBe(true);
    expect(
      config.getSettingsService().getProviderSettings('providerB').apiKey,
    ).toBe('key-for-provider-b');

    await switchActiveProvider('providerA');
    expect(
      config.getSettingsService().getProviderSettings('providerB').apiKey,
    ).toBeUndefined();
  });

  it('resets provider model parameters when switching', async () => {
    const providerA = createMockProvider('providerA');
    const providerB = createMockProvider('providerB');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    providerManager.setActiveProvider('providerA');
    setActiveModelParam('temperature', 0.7);
    setActiveModelParam('top_p', 0.9);
    expect(getActiveModelParams()).toEqual({
      temperature: 0.7,
      top_p: 0.9,
    });

    await switchActiveProvider('providerB');
    expect(
      config.getSettingsService().getProviderSettings('providerA').temperature,
    ).toBeUndefined();
    expect(getActiveModelParams()).toEqual({});

    setActiveModelParam('temperature', 0.3);
    expect(getActiveModelParams()).toEqual({ temperature: 0.3 });

    await switchActiveProvider('providerA');
    expect(
      config.getSettingsService().getProviderSettings('providerB').temperature,
    ).toBeUndefined();
    expect(getActiveModelParams()).toEqual({});
  });

  it('does not clear server tools provider state when switching active provider', async () => {
    const geminiProvider = createMockProvider('gemini');
    geminiProvider.getServerTools = () => ['web-search'];
    const otherProvider = createMockProvider('other');

    providerManager.registerProvider(geminiProvider);
    providerManager.registerProvider(otherProvider);

    providerManager.setServerToolsProvider(geminiProvider);
    providerManager.setActiveProvider('gemini');
    // Align server tools provider with wrapped instance used internally
    providerManager.setServerToolsProvider(providerManager.getActiveProvider());
    config
      .getSettingsService()
      .setProviderSetting('gemini', 'baseUrl', 'https://gemini.server-tools');

    await switchActiveProvider('other');
    expect(
      config.getSettingsService().getProviderSettings('gemini').baseUrl,
    ).toBe('https://gemini.server-tools');

    await switchActiveProvider('gemini');
    expect(
      config.getSettingsService().getProviderSettings('gemini').baseUrl,
    ).toBeUndefined();
  });

  it('is idempotent when switching to the same provider', async () => {
    const providerA = createMockProvider('providerA');
    providerManager.registerProvider(providerA);

    providerManager.setActiveProvider('providerA');
    providerA.clearState = vi.fn(providerA.clearState);

    const result = await switchActiveProvider('providerA');
    expect(result.changed).toBe(false);
    expect(providerA.clearState).not.toHaveBeenCalled();
  });

  it('clears legacy base URL and resets model when switching back to provider', async () => {
    const providerA = createMockProvider('providerA');
    providerA.getDefaultModel = vi.fn(() => 'providerA-default');
    const providerB = createMockProvider('providerB');

    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    providerManager.setActiveProvider('providerA');
    settingsService.setProviderSetting(
      'providerA',
      'baseUrl',
      'https://legacy.example/v1',
    );
    settingsService.setProviderSetting(
      'providerA',
      'baseURL',
      'https://legacy.example/v1',
    );
    settingsService.setProviderSetting('providerA', 'model', 'legacy-model');
    config.setEphemeralSetting('base-url', 'https://legacy.example/v1');
    config.setModel('legacy-model');

    await switchActiveProvider('providerB');
    await switchActiveProvider('providerA');

    const refreshedSettings = settingsService.getProviderSettings('providerA');
    expect(refreshedSettings.baseUrl).toBeUndefined();
    expect(refreshedSettings.baseURL).toBeUndefined();
    expect(refreshedSettings.model).toBe('providerA-default');
    expect(config.getModel()).toBe('providerA-default');
    expect(config.getEphemeralSetting('base-url')).toBeUndefined();
  });
});

function createMockProvider(name: string): IProvider & {
  apiKey?: string;
  baseUrl?: string;
  clearState?: () => void;
} {
  const provider: IProvider & {
    apiKey?: string;
    baseUrl?: string;
    clearState?: () => void;
  } = {
    name,
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
    clearState() {
      provider.apiKey = undefined;
      provider.baseUrl = undefined;
    },
    getDefaultModel() {
      return 'test-model';
    },
  };

  return provider;
}
