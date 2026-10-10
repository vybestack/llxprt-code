import type { Agent } from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  overrideInputs,
  providerSwitchInputs,
} from '../../../providers/src/runtime/__tests__/provider-switch-inputs.js';

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import { beforeEach, afterEach, describe, expect, it } from 'bun:test';
import * as path from 'node:path';
import {
  Profile,
  SettingsService,
  ProfileManager,
} from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import {
  Config,
  type RuntimeProviderManager,
} from '@vybestack/llxprt-code-core';
import { assembleCliProviderRuntime } from '@vybestack/llxprt-code-providers/runtime/assembleCliProviderRuntime.js';
import type { CliRuntimeRegistrationHandle } from '@vybestack/llxprt-code-providers/runtime/cliForegroundRuntime.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestSessionRoot,
  type CliTestSessionRoot,
} from './test-utils.js';
import { switchActiveProvider } from '@vybestack/llxprt-code-providers/runtime.js';
import { setProviderBaseUrl } from '@vybestack/llxprt-code-providers/runtime/providerConfigUtils.js';

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
  let sessionRoot: CliTestSessionRoot;
  let providerManager: RuntimeProviderManager;
  let profileManager: ProfileManager;
  let settingsService: SettingsService;
  let registration: CliRuntimeRegistrationHandle;
  let sessionClient: Pick<Agent['sessionClient'], 'refreshAuth'>;

  beforeEach(async () => {
    tempDir = await createTempDirectory();

    config = new Config({
      sessionId: 'test-session',
      targetDir: tempDir,
      debugMode: false,
      model: 'test-model',
      cwd: tempDir,
    });
    settingsService = new SettingsService();
    const runtimeId = 'base-url-test-runtime';
    const assembled = assembleCliProviderRuntime({
      settingsService,
      config,
      runtimeId,
      metadata: { source: 'base-url-test' },
    });
    providerManager = assembled.providerManager;
    registration = assembled.registration;
    sessionRoot = await initializeTestSessionRoot(
      config,
      providerManager,
      settingsService,
    );
    sessionClient = sessionRoot.agent.sessionClient;

    // Explicit per-test directory: the no-argument constructor resolves the
    // ambient global config root, which is the developer's own on a machine
    // where the suite runs without storage isolation.
    profileManager = new ProfileManager(path.join(tempDir, 'profiles'));
  });

  afterEach(async () => {
    registration.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('applies custom base URL via runtime helper', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('openai');

    const customUrl = 'https://custom.openai.api/v1';
    const result = await setProviderBaseUrl(
      customUrl,
      ...(await overrideInputs(sessionRoot)),
    );

    expect(result.success).toBe(true);
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      customUrl,
    );
    expect(sessionRoot.agent.getEphemeralSetting('base-url')).toBe(customUrl);
  });

  it('clears base URL when helper receives empty or "none" values', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('openai');

    await setProviderBaseUrl(
      'https://custom.openai.api/v1',
      ...(await overrideInputs(sessionRoot)),
    );
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      'https://custom.openai.api/v1',
    );

    const clearResult = await setProviderBaseUrl(
      'none',
      ...(await overrideInputs(sessionRoot)),
    );
    expect(clearResult.success).toBe(true);
    expect(
      settingsService.getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(sessionRoot.agent.getEphemeralSetting('base-url')).toBeUndefined();

    const emptyResult = await setProviderBaseUrl(
      '',
      ...(await overrideInputs(sessionRoot)),
    );
    expect(emptyResult.success).toBe(true);
    expect(
      settingsService.getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
  });

  it('stores base URL even when provider lacks direct override hook', async () => {
    const provider = createMockProvider('gemini');

    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('gemini');

    const result = await setProviderBaseUrl(
      'https://gemini.example/v1',
      ...(await overrideInputs(sessionRoot)),
    );
    expect(result.success).toBe(true);
    expect(settingsService.getProviderSettings('gemini')['base-url']).toBe(
      'https://gemini.example/v1',
    );
  });

  it('clears previous provider base URL when switching providers', async () => {
    const providerA = createMockProvider('openai');
    const providerB = createMockProvider('anthropic');
    providerManager.registerProvider(providerA);
    providerManager.registerProvider(providerB);

    await providerManager.setActiveProvider('openai');
    await setProviderBaseUrl(
      'https://provider-a.example',
      ...(await overrideInputs(sessionRoot)),
    );
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      'https://provider-a.example',
    );

    await switchActiveProvider(
      'anthropic',
      {},
      ...(await providerSwitchInputs(sessionRoot, providerManager, () =>
        sessionClient.refreshAuth(),
      )),
    );
    expect(
      settingsService.getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(
      settingsService.getProviderSettings('anthropic')['base-url'],
    ).toBeUndefined();
  });

  it('preserves profile base URL when loading via ProfileManager', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('openai');

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
      ...(await overrideInputs(sessionRoot)),
    );
    expect(result.success).toBe(true);
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      'https://profile.base.url',
    );
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
    getDefaultModel() {
      return 'test-model';
    },
  };

  provider.clearState = () => {
    provider.baseUrl = undefined;
  };

  return provider;
}
