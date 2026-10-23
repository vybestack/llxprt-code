import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  Agent,
  AgentProfilePreflight,
} from '@vybestack/llxprt-code-agents';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

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
import { prepareIntegrationPreflight } from './__tests__/prepare-preflight.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import {
  createTempDirectory,
  cleanupTempDirectory,
  initializeTestAgent,
} from './test-utils.js';
import { switchActiveProvider } from '@vybestack/llxprt-code-agents';
import { setProviderBaseUrl } from '../../../agents/src/api/providerConfigUtils.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * Validates that runtime helpers control provider base-url behavior rather
 * than direct provider mutations.
 * @pseudocode:cli-runtime.md lines 9-15
 */
describe('Base URL Runtime Helper Integration', () => {
  const credentials = useOwnedCredentials();
  let tempDir: string;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let sessionRoot: Awaited<ReturnType<typeof initializeTestAgent>>;
  let providerManager: RuntimeProviderManager;
  let profileManager: ProfileManager;
  let settingsService: SettingsService;
  let preflight: AgentProfilePreflight;
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
    preflight = await prepareIntegrationPreflight(
      config,
      settingsService,
      credentials().authority,
      runtimeId,
      (manager) => {
        providerManager = manager;
      },
    );
    settingsOwner = new SessionSettingsOwner(settingsService);
    sessionRoot = await initializeTestAgent(
      config,
      providerManager,
      settingsService,
      settingsOwner,
    );
    sessionClient = sessionRoot.sessionClient;

    // Explicit per-test directory: the no-argument constructor resolves the
    // ambient global config root, which is the developer's own on a machine
    // where the suite runs without storage isolation.
    profileManager = new ProfileManager(path.join(tempDir, 'profiles'));
  });

  afterEach(async () => {
    await preflight.dispose();
    await cleanupTempDirectory(tempDir);
  });

  it('applies custom base URL via runtime helper', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('openai');

    const customUrl = 'https://custom.openai.api/v1';
    const result = await setProviderBaseUrl(
      customUrl,
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
    );

    expect(result.success).toBe(true);
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      customUrl,
    );
    expect(sessionRoot.getEphemeralSetting('base-url')).toBe(customUrl);
  });

  it('clears base URL when helper receives empty or "none" values', async () => {
    const provider = createMockProvider('openai');
    providerManager.registerProvider(provider);
    await providerManager.setActiveProvider('openai');

    await setProviderBaseUrl(
      'https://custom.openai.api/v1',
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
    );
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      'https://custom.openai.api/v1',
    );

    const clearResult = await setProviderBaseUrl(
      'none',
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
    );
    expect(clearResult.success).toBe(true);
    expect(
      settingsService.getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(sessionRoot.getEphemeralSetting('base-url')).toBeUndefined();

    const emptyResult = await setProviderBaseUrl(
      '',
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
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
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
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
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
    );
    expect(settingsService.getProviderSettings('openai')['base-url']).toBe(
      'https://provider-a.example',
    );

    await switchActiveProvider(
      'anthropic',
      {},
      config,
      settingsService,
      providerManager,
      null,
      undefined,
      () => sessionClient.refreshAuth(),
      settingsOwner,
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
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
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
