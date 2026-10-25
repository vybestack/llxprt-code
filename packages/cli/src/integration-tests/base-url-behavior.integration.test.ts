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
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import type { ProviderSwitcher } from '@vybestack/llxprt-code-core';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
import { cleanupAfterFailure } from '../../../agents/src/core/subagent-cleanup.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
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
  let root: BaseUrlRoot;
  let settingsOwner: SessionSettingsOwner;
  let profileManager: ProfileManager;
  let settingsService: SettingsService;
  let preflight: RouteBPreflight['preflight'];
  let switchProvider: ProviderSwitcher;

  beforeEach(async () => {
    root = await openBaseUrlRoot(credentials().authority);
    settingsOwner = root.settingsOwner;
    settingsService = root.route.settings;
    preflight = root.route.preflight;
    switchProvider = root.switchProvider;

    // Explicit per-test directory: the no-argument constructor resolves the
    // ambient global config root, which is the developer's own on a machine
    // where the suite runs without storage isolation.
    profileManager = new ProfileManager(
      path.join(root.route.directory, 'profiles'),
    );
  });

  afterEach(async () => {
    await root.close();
  });

  it('applies custom base URL via runtime helper', async () => {
    const agent = await root.openAgent();
    await preflight.setActiveProvider('openai');

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
    expect(agent.getEphemeralSetting('base-url')).toBe(customUrl);
  });

  it('clears base URL when helper receives empty or "none" values', async () => {
    const agent = await root.openAgent();
    await preflight.setActiveProvider('openai');

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
    expect(agent.getEphemeralSetting('base-url')).toBeUndefined();

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
    await preflight.setActiveProvider('gemini');

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
    await preflight.setActiveProvider('openai');
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

    await switchProvider('switch-target', {});
    expect(
      settingsService.getProviderSettings('openai')['base-url'],
    ).toBeUndefined();
    expect(
      settingsService.getProviderSettings('switch-target')['base-url'],
    ).toBeUndefined();
  });

  it('preserves profile base URL when loading via ProfileManager', async () => {
    await preflight.setActiveProvider('openai');

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

interface BaseUrlRoot {
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  /** The production provider switch of the prepared preflight. */
  readonly switchProvider: ProviderSwitcher;
  /** Builds the foreground Agent with `openai` active. */
  readonly openAgent: () => Promise<Agent>;
  readonly close: () => Promise<void>;
}

async function openBaseUrlRoot(
  authority: RouteBPreflight['authority'],
): Promise<BaseUrlRoot> {
  const route = await openRouteBPreflight({
    authority,
    runtimeId: 'base-url-test-runtime',
    contributions: contributeMockProviders(['gemini', 'switch-target']),
    config: {
      sessionId: 'test-session',
      provider: undefined,
      model: 'test-model',
    },
  });
  const settingsOwner = new SessionSettingsOwner(route.settings);
  let agent: Agent | undefined;
  const close = async (): Promise<void> => {
    try {
      await agent?.dispose();
    } finally {
      try {
        await route.close();
      } finally {
        await settingsOwner.dispose();
      }
    }
  };
  try {
    for (const [key, value] of Object.entries(
      route.config.getInitialSettings(),
    ))
      route.settings.set(key, value);
    settingsOwner.initializeProviderSelection(
      route.config.getProvider(),
      route.config.getModel(),
    );
    await route.prepare({ settingsOwner });
    return {
      route,
      settingsOwner,
      switchProvider: route.preflight.captureSwitchOperation(),
      openAgent: async () => {
        agent = await route.createAgent({
          provider: 'openai',
          model: 'test-model',
        });
        return agent;
      },
      close,
    };
  } catch (primary) {
    return cleanupAfterFailure(primary, close);
  }
}

function createMockProvider(name: string): IProvider {
  return {
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
    getDefaultModel() {
      return 'test-model';
    },
  };
}

/** Registers each mock the way a host registers a provider: as a contribution. */
function contributeMockProviders(
  names: readonly string[],
): ProviderContributionRegistry {
  return buildProviderContributionRegistry(
    names.map((name) => {
      const providerId = `${name}-mock-provider`;
      return {
        specifier: `memory:${providerId}`,
        manifest: {
          apiVersion: 1,
          id: providerId,
          providers: [
            {
              providerId,
              createProvider: () => createMockProvider(name),
              builtinAliases: [
                {
                  alias: name,
                  config: {
                    baseProvider: providerId,
                    'requires-auth': false,
                  },
                },
              ],
            },
          ],
        },
      };
    }),
  );
}
