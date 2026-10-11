import { Config as RealConfig } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService as RealSettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from './providerMutations.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
let initializeClient = async (): Promise<void> => {};

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const realProviderAliasesModule = {
  ...(await import('../composition/providerAliases.js')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const { aliasEntries } = {
  aliasEntries: [] as Array<Record<string, unknown>>,
};

const { StubSettingsService, StubConfig, StubProvider } = (() => {
  const StubSettingsService = RealSettingsService;

  const StubConfig = RealConfig;

  class StubProvider {
    name: string;
    defaultModel = 'gpt-4o';
    providerConfig: { baseUrl?: string } = {};

    constructor(name: string) {
      this.name = name;
    }

    getDefaultModel(): string {
      return this.defaultModel;
    }
  }

  return { StubSettingsService, StubConfig, StubProvider };
})();

type StubSettingsServiceInstance = InstanceType<typeof StubSettingsService>;
type StubConfigInstance = InstanceType<typeof StubConfig>;
type StubProviderInstance = InstanceType<typeof StubProvider>;

const providers: Record<string, StubProviderInstance> = {
  openai: new StubProvider('openai'),
  qwenvercel: new StubProvider('qwenvercel'),
  gemini: new StubProvider('gemini'),
  anthropic: new StubProvider('anthropic'),
  openrouter: new StubProvider('openrouter'),
  zai: new StubProvider('zai'),
};

let activeProviderName = 'openai';

const mockProviderManager = {
  listProviders: vi.fn(() => Object.keys(providers)),
  getActiveProviderName: vi.fn(() => activeProviderName),
  getActiveProvider: vi.fn(() => providers[activeProviderName]),
  setActiveProvider: vi.fn(async (name: string) => {
    activeProviderName = name;
  }),
  getProviderByName: (name: string) => providers[name],
  getAvailableModels: vi.fn(async () => [{ id: 'model-a' }, { id: 'model-b' }]),
  setConfig: vi.fn(),
  prepareStatelessProviderInvocation: vi.fn(),
};

let stubSettingsService: StubSettingsServiceInstance;
let stubConfig: StubConfigInstance;

void vi.mock('../composition/providerAliases.js', () => {
  const actual = realProviderAliasesModule;
  return {
    ...actual,
    loadProviderAliasEntries: () => aliasEntries,
  };
});

void vi.mock('@vybestack/llxprt-code-core', () => {
  const actual = realLlxprtCodeCoreModule;

  return {
    ...actual,
    SettingsService: StubSettingsService,
    Config: StubConfig,
    createProviderRuntimeContext: (context: {
      settingsService: StubSettingsServiceInstance;
      config?: StubConfigInstance;
      runtimeId?: string;
      metadata?: Record<string, unknown>;
    }) => context,
  };
});

const { switchActiveProvider, setActiveModel, setEphemeralSetting } =
  await import('./index.js');

const mockOAuthManager = {
  clearRetryHandlers: () => {},

  isOAuthEnabled: vi.fn(() => false),
  toggleOAuthEnabled: vi.fn(),
  authenticate: vi.fn(),
  setMessageBus: vi.fn(),
  setConfigGetter: vi.fn(),
} as never;

function stubOverrideInputs(): [
  Parameters<typeof setActiveModel>[1],
  Parameters<typeof setActiveModel>[2],
  Parameters<typeof setActiveModel>[3],
] {
  return [
    assembleModelSelection(settingsOwner),
    stubSettingsService,
    mockProviderManager.getActiveProvider(),
  ];
}

function stubSwitchInputs(): [
  Parameters<typeof switchActiveProvider>[2],
  Parameters<typeof switchActiveProvider>[3],
  Parameters<typeof switchActiveProvider>[4],
  Parameters<typeof switchActiveProvider>[5],
  undefined,
  () => Promise<void>,
  Parameters<typeof switchActiveProvider>[8],
] {
  return [
    stubConfig,
    stubSettingsService,
    mockProviderManager as never,
    mockOAuthManager,
    undefined,
    initializeClient,
    settingsOwner,
  ];
}

function switchStubProvider(
  name: string,
  options: Parameters<typeof switchActiveProvider>[1],
): ReturnType<typeof switchActiveProvider> {
  return switchActiveProvider(name, options, ...stubSwitchInputs());
}

const debugLoggerWarnSpy = vi
  .spyOn(DebugLogger.prototype, 'warn')
  .mockImplementation(() => {});

/**
 * Helper to push the anthropic alias entry with modelDefaults (config-driven).
 * This mirrors the structure of the real anthropic.config file.
 */
function pushAnthropicAlias(overrides?: {
  defaultModel?: string;
  ephemeralSettings?: Record<string, unknown>;
  modelDefaults?: Array<{
    pattern: string;
    ephemeralSettings: Record<string, unknown>;
  }>;
}): void {
  aliasEntries.push({
    alias: 'anthropic',
    source: 'builtin',
    filePath: '/fake/anthropic.config',
    config: {
      baseProvider: 'anthropic',
      defaultModel: overrides?.defaultModel ?? 'claude-opus-4-6',
      ephemeralSettings: overrides?.ephemeralSettings ?? {
        maxOutputTokens: 40000,
      },
      modelDefaults: overrides?.modelDefaults ?? [
        {
          pattern: 'claude-(opus|sonnet|haiku)',
          ephemeralSettings: {
            'reasoning.enabled': true,
            'reasoning.adaptiveThinking': true,
            'reasoning.includeInContext': true,
          },
        },
        {
          pattern: 'claude-opus-4-6',
          ephemeralSettings: {
            'reasoning.effort': 'high',
          },
        },
      ],
    },
  });
}

/**
 * Mirrors the shipped zai.config modelDefaults: a broad glm-5 rule plus exact
 * GLM-5.2 and GLM-5.3 overrides with different reasoning maps.
 */
const ZAI_MODEL_DEFAULTS = [
  {
    pattern: 'glm-5',
    ephemeralSettings: {
      'reasoning.enabled': true,
      'reasoning.effort': 'high',
    },
  },
  {
    pattern: '^glm-5\\.2$',
    ephemeralSettings: {
      'reasoning.effortWireFormat': 'anthropic',
      'reasoning.enabledWireFormat': 'thinking',
      'reasoning.effortMap': {
        minimal: 'minimal',
        low: 'high',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      },
      'reasoning.enabledMap': {
        true: 'enabled',
        false: 'disabled',
      },
      'context-limit': 1000000,
      maxOutputTokens: 128000,
    },
  },
  {
    pattern: '^glm-5\\.3$',
    ephemeralSettings: {
      'reasoning.effortWireFormat': 'anthropic',
      'reasoning.enabledWireFormat': 'thinking',
      'reasoning.effortMap': {
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      },
      'reasoning.enabledMap': {
        true: 'enabled',
        false: null,
      },
    },
  },
];

function pushZaiAlias(defaultModel = 'glm-5.2'): void {
  aliasEntries.push({
    alias: 'zai',
    source: 'builtin',
    filePath: '/fake/zai.config',
    config: {
      baseProvider: 'anthropic',
      defaultModel,
      ephemeralSettings: {},
      modelDefaults: structuredClone(ZAI_MODEL_DEFAULTS),
    },
  });
}

/**
 * Simulate production alias reloading: every loadProviderAliasEntries() call
 * reparses the alias config files, so rule objects (and nested maps) get fresh
 * identities on each load.
 */
function reloadZaiAlias(): void {
  const index = aliasEntries.findIndex((entry) => entry.alias === 'zai');
  if (index === -1) {
    throw new Error('zai alias entry was not pushed before reload');
  }
  aliasEntries[index] = structuredClone(aliasEntries[index]);
}

describe('Provider alias defaults (model + ephemerals)', () => {
  afterEach(async () => {
    const retiring = retainedRoots.splice(0);
    await Promise.all(
      retiring.map(async (root) => {
        await root.settingsOwner.dispose();
        await root.config.dispose();
      }),
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    initializeClient = async () => {};

    stubSettingsService = new StubSettingsService();
    stubConfig = new StubConfig({
      sessionId: 'alias-defaults-fixture',
      model: '',
      provider: 'openai',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
    });
    settingsOwner = new SessionSettingsOwner(stubSettingsService);
    settingsOwner.initializeProviderSelection('openai', '');
    retainedRoots.push({ config: stubConfig, settingsOwner });
    activeProviderName = 'openai';

    aliasEntries.length = 0;
    aliasEntries.push({
      alias: 'qwenvercel',
      source: 'builtin',
      filePath: '/fake/qwenvercel.config',
      config: {
        baseProvider: 'openaivercel',
        baseUrl: 'https://portal.qwen.ai/v1',
        defaultModel: 'qwen3-coder-plus',
        ephemeralSettings: {
          'context-limit': 200000,
          max_tokens: 50000,
        },
      },
    });

    providers.qwenvercel.defaultModel = 'gpt-4o';
    providers.qwenvercel.providerConfig.baseUrl = 'https://portal.qwen.ai/v1';

    providers.anthropic.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';
  });

  afterEach(() => {
    debugLoggerWarnSpy.mockReset();
    vi.clearAllMocks();
  });

  describe('model defaults in setActiveModel (stateless recomputation)', () => {
    /**
     * Helper: switch to anthropic first (applies model defaults via switchActiveProvider),
     * then use setActiveModel for subsequent model changes within the same provider.
     */
    async function setupAnthropicProvider(
      defaultModel?: string,
    ): Promise<void> {
      pushAnthropicAlias({ defaultModel });
      await switchStubProvider('anthropic', {});
      // Confirm provider is active with initial model defaults applied
      activeProviderName = 'anthropic';
    }

    // --- Core model-change behavior ---

    it('setActiveModel("claude-opus-4-6") on anthropic provider applies model defaults', async () => {
      // Start with sonnet so we can switch TO opus
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      expect(settingsOwner.readSelectedModel()).toBe('claude-opus-4-6');
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
    });

    it('setActiveModel("claude-sonnet-4-5-20250929") applies reasoning defaults but NOT reasoning.effort', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      await setActiveModel(
        'claude-sonnet-4-5-20250929',
        ...stubOverrideInputs(),
      );

      expect(settingsOwner.readSelectedModel()).toBe(
        'claude-sonnet-4-5-20250929',
      );
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
    });

    it('switching from opus to sonnet CLEARS reasoning.effort (old model default no longer applies)', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Confirm opus defaults were applied by switchActiveProvider
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');

      await setActiveModel(
        'claude-sonnet-4-5-20250929',
        ...stubOverrideInputs(),
      );

      // reasoning.effort was model-owned by the opus rule, the sonnet rule
      // does not supply it, and no provider alias default exists for it, so
      // leaving the opus rule clears the key.
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
    });

    it('user-set reasoning.effort="low" is NOT cleared when switching from opus to sonnet', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User manually overrides reasoning.effort to "low" via the session setter
      setEphemeralSetting('reasoning.effort', 'low', settingsOwner);

      await setActiveModel(
        'claude-sonnet-4-5-20250929',
        ...stubOverrideInputs(),
      );

      // The explicit session value is user-owned and survives the model change
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    it('user-set ephemeral settings NOT overridden by model defaults on model change', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // User sets a custom value for a key that model defaults would set
      setEphemeralSetting('reasoning.enabled', false, settingsOwner);

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value is user-owned and survives the model change
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(false);
    });

    it('when no alias config exists for active provider, model change works without error', async () => {
      // Use openrouter which has no alias entry with modelDefaults
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          ephemeralSettings: { maxOutputTokens: 16384 },
        },
      });

      await switchStubProvider('openrouter', {});
      activeProviderName = 'openrouter';

      // No modelDefaults in openrouter alias config — setActiveModel should work fine
      await setActiveModel('gpt-4o-mini', ...stubOverrideInputs());

      expect(settingsOwner.readSelectedModel()).toBe('gpt-4o-mini');
      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
    });

    it('when model is undefined (no previous model), setActiveModel applies defaults normally', async () => {
      pushAnthropicAlias();
      // Set up anthropic provider without applying model defaults (simulating profile load)
      await switchStubProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';

      // Clear the model to simulate no previous model
      settingsOwner.chooseModel('');
      // Also clear provider settings model
      stubSettingsService.setProviderSetting('anthropic', 'model', undefined);

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // Old defaults are {} (no previous model), all new defaults applied unconditionally
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
    });

    // --- Ambiguous edge case (corrected ownership semantics) ---

    it('keeps a session-set value equal to the old default when the model changes', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User explicitly sets reasoning.effort to "high" (same value as the
      // opus default) through the session setter. Explicit ownership, not
      // value equality, decides whether the default application may change it.
      setEphemeralSetting('reasoning.effort', 'high', settingsOwner);

      await setActiveModel(
        'claude-sonnet-4-5-20250929',
        ...stubOverrideInputs(),
      );

      // The explicit session value is user-owned and survives the model change
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
    });

    // --- Alias-set value vs model-default edge case ---

    it('restores the provider alias default when leaving a matching model rule', async () => {
      // Alias ephemeralSettings sets reasoning.enabled: true at provider level.
      // Model default also sets reasoning.enabled: true.
      pushAnthropicAlias({
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.enabled': true,
        },
      });
      await switchStubProvider('anthropic', {});
      activeProviderName = 'anthropic';

      // Confirm reasoning.enabled is true (from model default, which overrides alias)
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);

      // Switch to a non-Claude model (no modelDefaults entries match)
      await setActiveModel('gpt-4o', ...stubOverrideInputs());

      // The model rule stopped matching; the key falls back to the provider
      // alias default instead of being cleared (provider default > auto).
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
    });

    // --- Transition matrix ---

    it('Opus-4-6 -> Sonnet-4-5: reasoning.effort cleared, others stay', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      await setActiveModel(
        'claude-sonnet-4-5-20250929',
        ...stubOverrideInputs(),
      );

      // reasoning.effort: model-owned by opus, absent from sonnet, no provider
      // alias default to restore, so it is cleared
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
      // These are in both opus and sonnet defaults, values unchanged → stay
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
    });

    it('Sonnet-4-5 -> Opus-4-6: reasoning.effort added, others stay', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // Confirm no reasoning.effort from sonnet
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // reasoning.effort: not in sonnet defaults, IS in opus defaults, key was undefined → applied
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
      // These stay as they were (in both defaults, same value)
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
    });

    it('Opus-4-6 -> non-Claude: ALL Claude model defaults cleared', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Confirm all defaults were applied
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');

      await setActiveModel('gpt-4o', ...stubOverrideInputs());

      // Old defaults exist, new defaults are {}, so every key is model-owned
      // with no provider alias default to restore and is therefore cleared
      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
    });

    it('non-Claude -> Opus-4-6: All defaults applied fresh', async () => {
      pushAnthropicAlias();
      // Start with a non-Claude model — use skipModelDefaults to simulate profile
      // load, then manually set the model
      await switchStubProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';
      settingsOwner.chooseModel('gpt-4o');
      stubSettingsService.setProviderSetting('anthropic', 'model', 'gpt-4o');

      // Confirm no reasoning defaults
      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // Old defaults are {} (gpt-4o matches nothing), all new defaults applied
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
    });

    // --- --set interaction tests ---

    it('--set reasoning.effort=low then setActiveModel("claude-opus-4-6") does NOT overwrite', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Simulate --set reasoning.effort=low (user explicitly overrides)
      setEphemeralSetting('reasoning.effort', 'low', settingsOwner);

      // setActiveModel for the same model
      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value is user-owned and is not overwritten
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    it('/model opus applies default high, then user sets low, then /model opus again: low stays', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Model defaults applied reasoning.effort: "high"
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');

      // User sets low
      setEphemeralSetting('reasoning.effort', 'low', settingsOwner);

      // /model opus again
      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value is user-owned and stays
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    it('--set reasoning.effort=low then /model opus: low stays (old model has no effort default)', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // Sonnet has no reasoning.effort default
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();

      // User sets reasoning.effort=low
      setEphemeralSetting('reasoning.effort', 'low', settingsOwner);

      // /model opus
      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value is user-owned and stays
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    // --- --profile-load bootstrap interaction ---

    it('--profile-load X --set reasoning.effort=low then setActiveModel: low stays', async () => {
      pushAnthropicAlias();

      // Profile load path: skipModelDefaults: true
      await switchStubProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';

      // Then --set is applied after profile load
      setEphemeralSetting('reasoning.effort', 'low', settingsOwner);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');

      // Then user changes model via /model
      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value is user-owned and stays
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });
  });

  describe('reasoning wire setting precedence', () => {
    it('clears alias and model defaults when switching to another provider', async () => {
      pushAnthropicAlias({
        ephemeralSettings: {
          'reasoning.effortWireFormat': 'openrouter',
          'reasoning.enabledWireFormat': 'openrouter',
        },
        modelDefaults: [
          {
            pattern: 'claude-opus-4-6',
            ephemeralSettings: {
              'reasoning.effortWireFormat': 'anthropic',
              'reasoning.effortMap': { high: 'model-high' },
              'reasoning.enabledMap': { false: null },
            },
          },
        ],
      });
      await switchStubProvider('anthropic', {});

      expect(settingsOwner.captureNamedParameters()).toMatchObject({
        reasoning: {
          effortWireFormat: 'anthropic',
          enabledWireFormat: 'openrouter',
          effortMap: { high: 'model-high' },
          enabledMap: { false: null },
        },
      });

      await switchStubProvider('openrouter', {});

      expect(
        settingsOwner.readNamedParameter('reasoning.effortWireFormat'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledWireFormat'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toBeUndefined();
    });
  });

  describe('model default ownership across alias reloads (issue #3255)', () => {
    it('replaces reasoning maps when switching glm-5.2 to glm-5.3 with freshly reloaded aliases', async () => {
      pushZaiAlias('glm-5.2');
      await switchStubProvider('zai', {});
      activeProviderName = 'zai';

      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'minimal',
        low: 'high',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: 'disabled' });

      // Reload the alias entries the way production reparses them: new object
      // identities for every rule and nested map.
      reloadZaiAlias();
      await setActiveModel('glm-5.3', ...stubOverrideInputs());

      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: null });
    });

    it('keeps a session selector equal to the old default when the model changes', async () => {
      pushZaiAlias('glm-5.3');
      await switchStubProvider('zai', {});
      activeProviderName = 'zai';
      expect(
        settingsOwner.readNamedParameter('reasoning.effortWireFormat'),
      ).toBe('anthropic');

      // Session-level set equal to the current default: explicit, user-owned.
      setEphemeralSetting(
        'reasoning.effortWireFormat',
        'anthropic',
        settingsOwner,
      );

      // glm-5.4 matches only the broad glm-5 rule; no selector default applies.
      await setActiveModel('glm-5.4', ...stubOverrideInputs());

      expect(
        settingsOwner.readNamedParameter('reasoning.effortWireFormat'),
      ).toBe('anthropic');
    });

    it('keeps a session map equal to the old default when the model changes', async () => {
      pushZaiAlias('glm-5.2');
      await switchStubProvider('zai', {});
      activeProviderName = 'zai';
      const glm52EffortMap = settingsOwner.readNamedParameter(
        'reasoning.effortMap',
      );

      // Session-level set with a fresh object but equal content.
      setEphemeralSetting(
        'reasoning.effortMap',
        structuredClone(glm52EffortMap),
        settingsOwner,
      );

      await setActiveModel('glm-5.3', ...stubOverrideInputs());

      // The explicit session map survives; the GLM-5.3 default map does not
      // replace it.
      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'minimal',
        low: 'high',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
    });
  });
});

let settingsOwner: SessionSettingsOwner;
const retainedRoots: Array<{
  config: RealConfig;
  settingsOwner: SessionSettingsOwner;
}> = [];
