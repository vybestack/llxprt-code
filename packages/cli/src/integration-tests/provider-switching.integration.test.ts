import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type { Agent } from '@vybestack/llxprt-code-agents';
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

/**
 * @plan:PLAN-20260603-ISSUE1584.P14
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-18
 */
import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'bun:test';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IProvider } from '@vybestack/llxprt-code-providers';
import { buildProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/index.js';
import type { ProviderContributionRegistry } from '@vybestack/llxprt-code-providers/composition/runtimePlugins/types.js';
import type { Config, ProviderSwitcher } from '@vybestack/llxprt-code-core';
import { cleanupAfterFailure } from '../../../agents/src/core/subagent-cleanup.js';
import {
  openRouteBPreflight,
  type RouteBPreflight,
} from '../../../agents/src/api/__tests__/helpers/route-b-preflight.js';
import { setActiveModelParam } from '../../../agents/src/api/model-parameters.js';
import { useOwnedCredentials } from '../../../agents/src/api/__tests__/helpers/owned-credential-fixture.js';
import { setProviderApiKey } from '../../../agents/src/api/providerConfigUtils.js';

/**
 * @plan:PLAN-20250218-STATELESSPROVIDER.P07
 * @requirement:REQ-SP-005
 * Ensures provider switching flows rely on runtime helpers instead of
 * mutating providers directly.
 * @pseudocode:cli-runtime.md lines 9-15
 */
describe('Runtime Provider Switching Integration', () => {
  const credentials = useOwnedCredentials();
  let root: SwitchingRoot;
  let config: Config;
  let settingsOwner: SessionSettingsOwner;
  let settingsService: SettingsService;
  let preflight: RouteBPreflight['preflight'];
  let switchProvider: ProviderSwitcher;
  let mocks: MockProviders;

  beforeEach(async () => {
    root = await openSwitchingRoot(
      credentials().authority,
      'switch-session',
      'provider-switch-test',
      createMockProviders(),
    );
    config = root.route.config;
    settingsOwner = root.settingsOwner;
    settingsService = root.route.settings;
    preflight = root.route.preflight;
    switchProvider = root.switchProvider;
    mocks = root.mocks;
  });

  afterEach(async () => {
    await root.close();
  });

  it('binds a provider-file lifecycle to the exact foreground Config', async () => {
    let close: (() => void | Promise<void>) | undefined;
    preflight.transferActivation((activation) => {
      close = () => activation.dispose();
      expect(activation.sessionClient.workspaceDirectories()).toStrictEqual([
        config.getTargetDir(),
      ]);
      expect(preflight.readProviderDefaultModel('providerA')).toBe(
        'test-model',
      );
    });
    try {
      expect(preflight.captureProviderFiles().retainedFiles > 0).toBe(false);
    } finally {
      await close?.();
    }
  });

  it('clears previous provider API key and auth state', async () => {
    const agent = await root.openAgent();
    const providerA = mocks.providerA;
    const providerB = mocks.providerB;

    await preflight.setActiveProvider('providerA');
    const setResult = await setProviderApiKey(
      'key-for-provider-a',
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
      providerA,
    );
    expect(setResult.success).toBe(true);
    expect(settingsService.getProviderSettings('providerA')['auth-key']).toBe(
      'key-for-provider-a',
    );
    expect(agent.getEphemeralSetting('auth-key')).toBe('key-for-provider-a');

    await switchProvider('providerB', {});
    expect(
      settingsService.getProviderSettings('providerA')['auth-key'],
    ).toBeUndefined();
    expect(agent.getEphemeralSetting('auth-key')).toBeUndefined();

    const resultB = await setProviderApiKey(
      'key-for-provider-b',
      {
        setEphemeralSetting: (key, value) =>
          settingsOwner.writeUserParameter(key, value),
      },
      settingsService,
      providerB,
    );
    expect(resultB.success).toBe(true);
    expect(settingsService.getProviderSettings('providerB')['auth-key']).toBe(
      'key-for-provider-b',
    );

    await switchProvider('providerA', {});
    expect(
      settingsService.getProviderSettings('providerB')['auth-key'],
    ).toBeUndefined();
  });

  it('resets provider model parameters when switching', async () => {
    const agent = await root.openAgent();

    await preflight.setActiveProvider('providerA');
    setActiveModelParam(
      'temperature',
      0.7,
      settingsService,
      preflight.getActiveProviderName(),
    );
    setActiveModelParam(
      'top_p',
      0.9,
      settingsService,
      preflight.getActiveProviderName(),
    );
    expect(agent.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.7,
      top_p: 0.9,
    });

    await switchProvider('providerB', {});
    expect(
      settingsService.getProviderSettings('providerA').temperature,
    ).toBeUndefined();
    expect(agent.providerReads.getActiveModelParams()).toStrictEqual({});

    setActiveModelParam(
      'temperature',
      0.3,
      settingsService,
      preflight.getActiveProviderName(),
    );
    expect(agent.providerReads.getActiveModelParams()).toStrictEqual({
      temperature: 0.3,
    });

    await switchProvider('providerA', {});
    expect(
      settingsService.getProviderSettings('providerB').temperature,
    ).toBeUndefined();
    expect(agent.providerReads.getActiveModelParams()).toStrictEqual({});
  });

  it('clears gemini provider settings when switching active provider', async () => {
    await preflight.setActiveProvider('gemini');
    settingsService.setProviderSetting(
      'gemini',
      'base-url',
      'https://gemini.server-tools',
    );

    await switchProvider('other', {});
    expect(
      settingsService.getProviderSettings('gemini')['base-url'],
    ).toBeUndefined();
  });

  it('is idempotent when switching to the same provider', async () => {
    const providerA = mocks.providerA;

    await preflight.setActiveProvider('providerA');
    providerA.clearState = vi.fn(providerA.clearState);

    const result = await switchProvider('providerA', {});
    expect(result.changed).toBe(false);
    expect(providerA.clearState).not.toHaveBeenCalled();
  });

  it('uses alias default model for openai when switching', async () => {
    // The gemini alias default moved to the google-gemini plugin (#2763);
    // openai's alias config is the base-package representative here.
    // The switch source must be a registered provider; 'other' plays that role
    // the same way it does in the gemini-settings-clearing test above.
    await preflight.setActiveProvider('other');
    await switchProvider('openai', {});

    const openaiSettings = settingsService.getProviderSettings('openai');
    expect(openaiSettings.model).toBe('gpt-5.5');
    expect(settingsOwner.readSelectedModel()).toBe('gpt-5.5');
  });

  it('clears legacy base URL and resets model when switching back to provider', async () => {
    const agent = await root.openAgent();
    const providerA = mocks.providerA;
    providerA.getDefaultModel = vi.fn(() => 'providerA-default');

    await preflight.setActiveProvider('providerA');
    settingsService.setProviderSetting(
      'providerA',
      'base-url',
      'https://legacy.example/v1',
    );
    settingsService.setProviderSetting('providerA', 'model', 'legacy-model');
    agent.setEphemeralSetting('base-url', 'https://legacy.example/v1');
    settingsOwner.chooseModel('legacy-model');

    await switchProvider('providerB', {});
    await switchProvider('providerA', {});

    const refreshedSettings = settingsService.getProviderSettings('providerA');
    expect(refreshedSettings['base-url']).toBeUndefined();
    expect(refreshedSettings.model).toBe('providerA-default');
    expect(settingsOwner.readSelectedModel()).toBe('providerA-default');
    expect(agent.getEphemeralSetting('base-url')).toBeUndefined();
  });

  it('does not call getModels during provider switch', async () => {
    const providerB = mocks.providerB;
    providerB.getModels = vi.fn(providerB.getModels);
    await preflight.setActiveProvider('providerA');

    const result = await switchProvider('providerB', {});

    expect(result.changed).toBe(true);
    expect(result.nextProvider).toBe('providerB');
    expect(providerB.getModels).not.toHaveBeenCalled();
  });

  it('resolves model from provider default without network call', async () => {
    const providerB = mocks.providerB;
    providerB.getDefaultModel = vi.fn(() => 'custom-default-model');
    providerB.getModels = vi.fn(providerB.getModels);
    await preflight.setActiveProvider('providerA');

    await switchProvider('providerB', {});

    expect(settingsOwner.readSelectedModel()).toBe('custom-default-model');
  });
});

describe('First provider selection from no active provider (#2481)', () => {
  const credentials = useOwnedCredentials();
  let root: SwitchingRoot;
  let preflight: RouteBPreflight['preflight'];
  let switchProvider: ProviderSwitcher;

  beforeEach(async () => {
    root = await openSwitchingRoot(
      credentials().authority,
      'first-select-session',
      'first-select-test',
      undefined,
    );
    preflight = root.route.preflight;
    switchProvider = root.switchProvider;
  });

  afterEach(async () => {
    await root.close();
  });

  it('stays closed (no active provider) before any selection', () => {
    expect(preflight.hasActiveProvider()).toBe(false);
    expect(preflight.getActiveProviderName()).toBeUndefined();
  });

  it('transitions from no active provider to an explicit selection', async () => {
    expect(preflight.hasActiveProvider()).toBe(false);

    const result = await switchProvider('openai', {});

    expect(result.changed).toBe(true);
    expect(result.previousProvider).toBeNull();
    expect(result.nextProvider).toBe('openai');
    expect(preflight.hasActiveProvider()).toBe(true);
    expect(preflight.getActiveProviderName()).toBe('openai');
  });

  it('does not issue network requests during the transition', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    setGlobal('fetch', fetchMock);

    try {
      await switchProvider('anthropic', {});
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      restoreGlobals();
    }
  });

  it('permits a subsequent switch to another explicit provider', async () => {
    await switchProvider('openai', {});
    expect(preflight.getActiveProviderName()).toBe('openai');

    const result = await switchProvider('anthropic', {});
    expect(result.changed).toBe(true);
    expect(result.previousProvider).toBe('openai');
    expect(result.nextProvider).toBe('anthropic');
    expect(preflight.getActiveProviderName()).toBe('anthropic');
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

type MockProvider = ReturnType<typeof createMockProvider>;

interface MockProviders {
  readonly providerA: MockProvider;
  readonly providerB: MockProvider;
  readonly gemini: MockProvider;
  readonly other: MockProvider;
}

function createMockProviders(): MockProviders {
  return {
    providerA: createMockProvider('providerA'),
    providerB: createMockProvider('providerB'),
    gemini: createMockProvider('gemini'),
    other: createMockProvider('other'),
  };
}

/** Registers each mock the way a host registers a provider: as a contribution. */
function contributeMockProviders(
  mocks: MockProviders,
): ProviderContributionRegistry {
  return buildProviderContributionRegistry(
    Object.values(mocks).map((provider) => {
      const providerId = `${provider.name}-mock-provider`;
      return {
        specifier: `memory:${providerId}`,
        manifest: {
          apiVersion: 1,
          id: providerId,
          providers: [
            {
              providerId,
              createProvider: () => provider,
              builtinAliases: [
                {
                  alias: provider.name,
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

interface SwitchingRoot {
  readonly route: RouteBPreflight;
  readonly settingsOwner: SessionSettingsOwner;
  /** The production provider switch of the prepared preflight. */
  readonly switchProvider: ProviderSwitcher;
  readonly mocks: MockProviders;
  /** Builds the foreground Agent with `providerA` active. */
  readonly openAgent: () => Promise<Agent>;
  readonly close: () => Promise<void>;
}

async function openSwitchingRoot(
  authority: RouteBPreflight['authority'],
  sessionId: string,
  runtimeId: string,
  mocks: MockProviders | undefined,
): Promise<SwitchingRoot> {
  const route = await openRouteBPreflight({
    authority,
    runtimeId,
    config: { sessionId, provider: undefined, model: 'test-model' },
    ...(mocks === undefined
      ? {}
      : { contributions: contributeMockProviders(mocks) }),
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
      mocks: mocks ?? createMockProviders(),
      openAgent: async () => {
        agent = await route.createAgent({
          provider: 'providerA',
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
