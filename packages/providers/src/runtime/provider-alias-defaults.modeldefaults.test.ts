/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core';
import type { Profile } from '@vybestack/llxprt-code-settings';

const realProviderAliasesModule = {
  ...(await import('../composition/providerAliases.js')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const { aliasEntries } = {
  aliasEntries: [] as Array<Record<string, unknown>>,
};

function getBuiltinAnthropicAlias() {
  const builtinAnthropic = realProviderAliasesModule
    .loadProviderAliasEntries()
    .find((entry) => entry.source === 'builtin' && entry.alias === 'anthropic');
  if (builtinAnthropic === undefined) {
    throw new Error('Builtin anthropic alias entry not found');
  }
  return builtinAnthropic;
}

const {
  StubSettingsService: StubSettingsServiceClass,
  StubConfig: StubConfigClass,
  StubProvider: StubProviderClass,
} = (() => {
  class StubSettingsService {
    providers: Record<string, Record<string, unknown>> = {};
    global: Record<string, unknown> = {};

    set(key: string, value: unknown): void {
      this.global[key] = value;
    }

    get(key: string): unknown {
      return this.global[key];
    }

    getAllGlobalSettings(): Record<string, unknown> {
      return { ...this.global };
    }

    setProviderSetting(provider: string, key: string, value: unknown): void {
      this.providers[provider] ??= {};
      if (value === undefined) {
        delete this.providers[provider][key];
      } else {
        this.providers[provider][key] = value;
      }
    }

    getProviderSettings(provider: string): Record<string, unknown> {
      return this.providers[provider] ?? {};
    }

    switchProvider = vi.fn(async (provider: string) => {
      this.set('activeProvider', provider);
    });

    async updateSettings(
      providerOrChanges?: string | Record<string, unknown>,
      changes?: Record<string, unknown>,
    ): Promise<void> {
      if (typeof providerOrChanges === 'string') {
        for (const [key, value] of Object.entries(changes!)) {
          this.setProviderSetting(providerOrChanges, key, value);
        }
      } else if (typeof providerOrChanges === 'object') {
        for (const [key, value] of Object.entries(providerOrChanges)) {
          this.set(key, value);
        }
      }
    }
  }

  class StubConfig {
    private model: string | undefined = undefined;
    private provider = 'openai';
    private ephemeral: Record<string, unknown> = {};
    private providerManager: unknown;
    private settingsService: InstanceType<typeof StubSettingsService>;
    initializeContentGeneratorConfig = vi.fn(async () => {});

    constructor(settingsService: InstanceType<typeof StubSettingsService>) {
      this.settingsService = settingsService;
    }

    getSettingsService(): unknown {
      return this.settingsService;
    }

    setEphemeralSetting(key: string, value: unknown): void {
      if (value === undefined) {
        delete this.ephemeral[key];
      } else {
        this.ephemeral[key] = value;
      }
    }

    getEphemeralSetting(key: string): unknown {
      return this.ephemeral[key];
    }

    getEphemeralSettings(): Record<string, unknown> {
      return { ...this.ephemeral };
    }

    getModel(): string | undefined {
      return this.model;
    }

    setModel(model: string | undefined): void {
      this.model = model;
    }

    setProvider(provider: string): void {
      this.provider = provider;
    }

    getProvider(): string {
      return this.provider;
    }

    setProviderManager(manager: unknown): void {
      this.providerManager = manager;
    }

    getProviderManager(): unknown {
      return this.providerManager;
    }
  }

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

type StubSettingsServiceInstance = InstanceType<
  typeof StubSettingsServiceClass
>;
type StubConfigInstance = InstanceType<typeof StubConfigClass>;
type StubProviderInstance = InstanceType<typeof StubProviderClass>;

const StubSettingsService = StubSettingsServiceClass;
const StubConfig = StubConfigClass;
const StubProvider = StubProviderClass;

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

  let activeContext: {
    settingsService: StubSettingsServiceInstance;
    config?: StubConfigInstance;
    runtimeId?: string;
    metadata?: Record<string, unknown>;
  } | null = null;

  return {
    ...actual,
    SettingsService: StubSettingsServiceClass,
    Config: StubConfigClass,
    createProviderRuntimeContext: (context: {
      settingsService: StubSettingsServiceInstance;
      config?: StubConfigInstance;
      runtimeId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      activeContext = context;
      return context;
    },
    getActiveProviderRuntimeContext: () => {
      if (!activeContext) {
        throw new Error(
          'MissingProviderRuntimeError(provider-runtime): runtime registration missing',
        );
      }
      return activeContext;
    },
    setActiveProviderRuntimeContext: (context: {
      settingsService: StubSettingsServiceInstance;
      config?: StubConfigInstance;
      runtimeId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      activeContext = context;
    },
    peekActiveProviderRuntimeContext: () => activeContext,
    getCurrentRuntimeScope: () => undefined,
  };
});

const {
  switchActiveProvider,
  setActiveModel,
  setEphemeralSetting,
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
} = await import('./runtimeSettings.js');
const { applyProfileWithGuards } = await import('./profileApplication.js');

const mockOAuthManager = {
  isOAuthEnabled: vi.fn(() => false),
  toggleOAuthEnabled: vi.fn(),
  authenticate: vi.fn(),
  setMessageBus: vi.fn(),
  setConfigGetter: vi.fn(),
} as never;

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
  beforeEach(() => {
    vi.clearAllMocks();

    stubSettingsService = new StubSettingsService();
    stubConfig = new StubConfig(stubSettingsService);
    activeProviderName = 'openai';

    setCliRuntimeContext(stubSettingsService as never, stubConfig as never, {
      runtimeId: 'test-runtime',
    });
    const runtimeMessageBus = {} as never;
    (
      mockOAuthManager as unknown as { runtimeMessageBus?: unknown }
    ).runtimeMessageBus = runtimeMessageBus;
    registerCliProviderInfrastructure(
      mockProviderManager as never,
      mockOAuthManager,
      {
        messageBus: runtimeMessageBus,
        runtimeId: 'test-runtime',
      },
    );

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
      await switchActiveProvider('anthropic');
      // Confirm provider is active with initial model defaults applied
      activeProviderName = 'anthropic';
    }

    // --- Core model-change behavior ---

    it('setActiveModel("claude-opus-4-6") on anthropic provider applies model defaults', async () => {
      // Start with sonnet so we can switch TO opus
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      await setActiveModel('claude-opus-4-6');

      expect(stubConfig.getModel()).toBe('claude-opus-4-6');
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
    });

    it('setActiveModel("claude-sonnet-4-5-20250929") applies reasoning defaults but NOT reasoning.effort', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      await setActiveModel('claude-sonnet-4-5-20250929');

      expect(stubConfig.getModel()).toBe('claude-sonnet-4-5-20250929');
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('switching from opus to sonnet CLEARS reasoning.effort (old model default no longer applies)', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Confirm opus defaults were applied by switchActiveProvider
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // reasoning.effort was model-owned by the opus rule, the sonnet rule
      // does not supply it, and no provider alias default exists for it, so
      // leaving the opus rule clears the key.
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('user-set reasoning.effort="low" is NOT cleared when switching from opus to sonnet', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User manually overrides reasoning.effort to "low" via the session setter
      setEphemeralSetting('reasoning.effort', 'low');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // The explicit session value is user-owned and survives the model change
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('user-set ephemeral settings NOT overridden by model defaults on model change', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // User sets a custom value for a key that model defaults would set
      setEphemeralSetting('reasoning.enabled', false);

      await setActiveModel('claude-opus-4-6');

      // The explicit session value is user-owned and survives the model change
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(false);
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

      await switchActiveProvider('openrouter');
      activeProviderName = 'openrouter';

      // No modelDefaults in openrouter alias config — setActiveModel should work fine
      await setActiveModel('gpt-4o-mini');

      expect(stubConfig.getModel()).toBe('gpt-4o-mini');
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
    });

    it('when model is undefined (no previous model), setActiveModel applies defaults normally', async () => {
      pushAnthropicAlias();
      // Set up anthropic provider without applying model defaults (simulating profile load)
      await switchActiveProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';

      // Clear the model to simulate no previous model
      stubConfig.setModel(undefined);
      // Also clear provider settings model
      stubSettingsService.setProviderSetting('anthropic', 'model', undefined);

      await setActiveModel('claude-opus-4-6');

      // Old defaults are {} (no previous model), all new defaults applied unconditionally
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
    });

    // --- Ambiguous edge case (corrected ownership semantics) ---

    it('keeps a session-set value equal to the old default when the model changes', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User explicitly sets reasoning.effort to "high" (same value as the
      // opus default) through the session setter. Explicit ownership, not
      // value equality, decides whether the default application may change it.
      setEphemeralSetting('reasoning.effort', 'high');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // The explicit session value is user-owned and survives the model change
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
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
      await switchActiveProvider('anthropic');
      activeProviderName = 'anthropic';

      // Confirm reasoning.enabled is true (from model default, which overrides alias)
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);

      // Switch to a non-Claude model (no modelDefaults entries match)
      await setActiveModel('gpt-4o');

      // The model rule stopped matching; the key falls back to the provider
      // alias default instead of being cleared (provider default > auto).
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
    });

    // --- Transition matrix ---

    it('Opus-4-6 -> Sonnet-4-5: reasoning.effort cleared, others stay', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // reasoning.effort: model-owned by opus, absent from sonnet, no provider
      // alias default to restore, so it is cleared
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
      // These are in both opus and sonnet defaults, values unchanged → stay
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
    });

    it('Sonnet-4-5 -> Opus-4-6: reasoning.effort added, others stay', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // Confirm no reasoning.effort from sonnet
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();

      await setActiveModel('claude-opus-4-6');

      // reasoning.effort: not in sonnet defaults, IS in opus defaults, key was undefined → applied
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
      // These stay as they were (in both defaults, same value)
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
    });

    it('Opus-4-6 -> non-Claude: ALL Claude model defaults cleared', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Confirm all defaults were applied
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');

      await setActiveModel('gpt-4o');

      // Old defaults exist, new defaults are {}, so every key is model-owned
      // with no provider alias default to restore and is therefore cleared
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.adaptiveThinking'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.includeInContext'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('non-Claude -> Opus-4-6: All defaults applied fresh', async () => {
      pushAnthropicAlias();
      // Start with a non-Claude model — use skipModelDefaults to simulate profile
      // load, then manually set the model
      await switchActiveProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';
      stubConfig.setModel('gpt-4o');
      stubSettingsService.setProviderSetting('anthropic', 'model', 'gpt-4o');

      // Confirm no reasoning defaults
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();

      await setActiveModel('claude-opus-4-6');

      // Old defaults are {} (gpt-4o matches nothing), all new defaults applied
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
    });

    // --- --set interaction tests ---

    it('--set reasoning.effort=low then setActiveModel("claude-opus-4-6") does NOT overwrite', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Simulate --set reasoning.effort=low (user explicitly overrides)
      setEphemeralSetting('reasoning.effort', 'low');

      // setActiveModel for the same model
      await setActiveModel('claude-opus-4-6');

      // The explicit session value is user-owned and is not overwritten
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('/model opus applies default high, then user sets low, then /model opus again: low stays', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Model defaults applied reasoning.effort: "high"
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');

      // User sets low
      setEphemeralSetting('reasoning.effort', 'low');

      // /model opus again
      await setActiveModel('claude-opus-4-6');

      // The explicit session value is user-owned and stays
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('--set reasoning.effort=low then /model opus: low stays (old model has no effort default)', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // Sonnet has no reasoning.effort default
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();

      // User sets reasoning.effort=low
      setEphemeralSetting('reasoning.effort', 'low');

      // /model opus
      await setActiveModel('claude-opus-4-6');

      // The explicit session value is user-owned and stays
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    // --- --profile-load bootstrap interaction ---

    it('--profile-load X --set reasoning.effort=low then setActiveModel: low stays', async () => {
      pushAnthropicAlias();

      // Profile load path: skipModelDefaults: true
      await switchActiveProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';

      // Then --set is applied after profile load
      setEphemeralSetting('reasoning.effort', 'low');
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');

      // Then user changes model via /model
      await setActiveModel('claude-opus-4-6');

      // The explicit session value is user-owned and stays
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });
  });

  describe('reasoning wire setting precedence', () => {
    it('resolves profile values over shipped Opus 5 alias defaults', async () => {
      aliasEntries.push({ ...getBuiltinAnthropicAlias() });
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-opus-5',
        modelParams: {},
        ephemeralSettings: {
          'reasoning.effortWireFormat': 'openai',
          'reasoning.enabledWireFormat': 'openrouter',
          'reasoning.effortMap': { low: 'profile-low' },
          'reasoning.enabledMap': { false: null },
        },
      };

      await applyProfileWithGuards(profile, {
        profileName: 'reasoning-profile',
      });

      expect(stubConfig.getEphemeralSettings()).toMatchObject({
        'reasoning.effortWireFormat': 'openai',
        'reasoning.enabledWireFormat': 'openrouter',
        'reasoning.effortMap': { low: 'profile-low' },
        'reasoning.enabledMap': { false: null },
      });
    });

    it('applies target model defaults during profile application without leaking old provider values', async () => {
      stubConfig.setEphemeralSetting(
        'reasoning.effortWireFormat',
        'openai-responses',
      );
      stubConfig.setEphemeralSetting('reasoning.enabledWireFormat', 'thinking');
      stubConfig.setEphemeralSetting('reasoning.effortMap', {
        low: 'old-provider-low',
      });
      stubConfig.setEphemeralSetting('reasoning.enabledMap', { false: null });
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
            },
          },
        ],
      });
      const profile: Profile = {
        version: 1,
        provider: 'anthropic',
        model: 'claude-opus-4-6',
        modelParams: {},
        ephemeralSettings: {},
      };

      await applyProfileWithGuards(profile, {
        profileName: 'defaulted-profile',
      });

      expect(stubConfig.getEphemeralSettings()).toMatchObject({
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'openrouter',
        'reasoning.effortMap': { high: 'model-high' },
      });
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabledMap'),
      ).toBeUndefined();
    });

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
      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSettings()).toMatchObject({
        'reasoning.effortWireFormat': 'anthropic',
        'reasoning.enabledWireFormat': 'openrouter',
        'reasoning.effortMap': { high: 'model-high' },
        'reasoning.enabledMap': { false: null },
      });

      await switchActiveProvider('openrouter');

      expect(
        stubConfig.getEphemeralSetting('reasoning.effortWireFormat'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabledWireFormat'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.effortMap'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabledMap'),
      ).toBeUndefined();
    });
  });

  describe('model default ownership across alias reloads (issue #3255)', () => {
    it('replaces reasoning maps when switching glm-5.2 to glm-5.3 with freshly reloaded aliases', async () => {
      pushZaiAlias('glm-5.2');
      await switchActiveProvider('zai');
      activeProviderName = 'zai';

      expect(
        stubConfig.getEphemeralSetting('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'minimal',
        low: 'high',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: 'disabled' });

      // Reload the alias entries the way production reparses them: new object
      // identities for every rule and nested map.
      reloadZaiAlias();
      await setActiveModel('glm-5.3');

      expect(
        stubConfig.getEphemeralSetting('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'low',
        low: 'low',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: null });
    });

    it('keeps a session selector equal to the old default when the model changes', async () => {
      pushZaiAlias('glm-5.3');
      await switchActiveProvider('zai');
      activeProviderName = 'zai';
      expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
        'anthropic',
      );

      // Session-level set equal to the current default: explicit, user-owned.
      setEphemeralSetting('reasoning.effortWireFormat', 'anthropic');

      // glm-5.4 matches only the broad glm-5 rule; no selector default applies.
      await setActiveModel('glm-5.4');

      expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
        'anthropic',
      );
    });

    it('keeps a session map equal to the old default when the model changes', async () => {
      pushZaiAlias('glm-5.2');
      await switchActiveProvider('zai');
      activeProviderName = 'zai';
      const glm52EffortMap = stubConfig.getEphemeralSetting(
        'reasoning.effortMap',
      );

      // Session-level set with a fresh object but equal content.
      setEphemeralSetting(
        'reasoning.effortMap',
        structuredClone(glm52EffortMap),
      );

      await setActiveModel('glm-5.3');

      // The explicit session map survives; the GLM-5.3 default map does not
      // replace it.
      expect(
        stubConfig.getEphemeralSetting('reasoning.effortMap'),
      ).toStrictEqual({
        minimal: 'minimal',
        low: 'high',
        medium: 'high',
        high: 'high',
        xhigh: 'max',
        max: 'max',
      });
    });

    it('keeps an explicit profile selector equal to the old default through later model changes', async () => {
      pushZaiAlias('glm-5.2');
      const profile: Profile = {
        version: 1,
        provider: 'zai',
        model: 'glm-5.2',
        modelParams: {},
        ephemeralSettings: {
          'reasoning.effortWireFormat': 'anthropic',
        },
      };

      await applyProfileWithGuards(profile, { profileName: 'zai-explicit' });
      activeProviderName = 'zai';

      await setActiveModel('glm-5.4');

      expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
        'anthropic',
      );
    });
  });
});
