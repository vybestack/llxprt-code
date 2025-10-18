/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import {
  Config,
  ProviderManager,
  Profile,
  SettingsService,
  type IProvider,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../auth/oauth-manager.js';
import {
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
  setActiveModelParam,
  clearActiveModelParam,
  getActiveModelParams,
  switchActiveProvider,
  buildRuntimeProfileSnapshot,
  applyProfileSnapshot,
  setActiveModel,
} from '../runtime/runtimeSettings.js';
import { createTempDirectory, cleanupTempDirectory } from './test-utils.js';

function createStubProvider(name: string): IProvider {
  return {
    name,
    async getModels() {
      return [
        {
          id: `${name}-model`,
          name: `${name}-model`,
          provider: name,
          supportedToolFormats: [],
        },
      ];
    },
    getDefaultModel() {
      return `${name}-model`;
    },
    async *generateChatCompletion() {
      yield {
        speaker: 'ai' as const,
        blocks: [{ type: 'text' as const, text: `response-from-${name}` }],
      };
    },
    getServerTools() {
      return [];
    },
    async invokeServerTool() {
      return {};
    },
    clearState() {
      // Intentionally blank; runtime helpers now manage state in SettingsService.
    },
  };
}

describe('Runtime model parameter isolation', () => {
  let tempDir: string;
  let config: Config;
  let providerManager: ProviderManager;
  let settingsService: SettingsService;

  beforeEach(async () => {
    tempDir = await createTempDirectory();
    config = new Config({
      sessionId: 'model-params-isolation',
      targetDir: tempDir,
      debugMode: false,
      cwd: tempDir,
      model: 'alpha-model',
    });
    await config.initialize();

    settingsService = config.getSettingsService();
    providerManager = new ProviderManager({ settingsService, config });

    // Register stub providers used by the tests.
    providerManager.registerProvider(createStubProvider('alpha'));
    providerManager.registerProvider(createStubProvider('beta'));
    providerManager.registerProvider(createStubProvider('gamma'));

    registerCliProviderInfrastructure(
      providerManager,
      {} as unknown as OAuthManager,
    );
    setCliRuntimeContext(settingsService, config, {
      metadata: { source: 'model-params-isolation.integration.test.ts' },
    });

    providerManager.setActiveProvider('alpha');
    await setActiveModel('alpha-model');
  });

  afterEach(async () => {
    resetCliProviderInfrastructure();
    await cleanupTempDirectory(tempDir);
  });

  it('keeps model parameters scoped to the active provider', async () => {
    expect(getActiveModelParams()).toEqual({});

    setActiveModelParam('temperature', 0.8);
    setActiveModelParam('max_tokens', 2048);

    expect(getActiveModelParams()).toEqual({
      temperature: 0.8,
      max_tokens: 2048,
    });
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.8);

    await switchActiveProvider('beta');
    expect(getActiveModelParams()).toEqual({});
    expect(settingsService.getProviderSettings('alpha').temperature).toBe(0.8);

    setActiveModelParam('temperature', 0.35);
    expect(getActiveModelParams()).toEqual({ temperature: 0.35 });

    await switchActiveProvider('alpha');
    expect(getActiveModelParams()).toEqual({});
    expect(
      settingsService.getProviderSettings('alpha').temperature,
    ).toBeUndefined();
    expect(settingsService.getProviderSettings('beta').temperature).toBe(0.35);
  });

  it('builds runtime profile snapshots with provider-scoped params', () => {
    setActiveModelParam('top_p', 0.91);
    setActiveModelParam('response_format', { type: 'json_object' });

    const snapshot = buildRuntimeProfileSnapshot();
    expect(snapshot.provider).toBe('alpha');
    expect(snapshot.model).toBe('alpha-model');
    expect(snapshot.modelParams).toEqual({
      top_p: 0.91,
      response_format: { type: 'json_object' },
    });
  });

  it('applies profile snapshots and refreshes runtime state', async () => {
    const profile: Profile = {
      version: 1,
      provider: 'beta',
      model: 'beta-model',
      modelParams: {
        temperature: 0.55,
        top_p: 0.88,
      },
      ephemeralSettings: {
        'context-limit': 64000,
      },
    };

    await applyProfileSnapshot(profile, { profileName: 'beta-profile' });

    expect(settingsService.get('activeProvider')).toBe('beta');
    expect(config.getModel()).toBe('beta-model');
    expect(settingsService.getProviderSettings('beta').temperature).toBe(0.55);
    expect(settingsService.getProviderSettings('beta').top_p).toBe(0.88);
    expect(config.getEphemeralSetting('context-limit')).toBe(64000);
  });

  it('clears individual model params via helper', () => {
    setActiveModelParam('temperature', 0.42);
    expect(getActiveModelParams()).toEqual({ temperature: 0.42 });

    clearActiveModelParam('temperature');
    expect(getActiveModelParams()).toEqual({});
  });
});
