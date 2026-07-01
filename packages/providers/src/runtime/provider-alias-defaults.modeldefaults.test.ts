/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugLogger } from '@vybestack/llxprt-code-core';

const { aliasEntries } = vi.hoisted(() => ({
  aliasEntries: [] as Array<Record<string, unknown>>,
}));

const {
  StubSettingsService: StubSettingsServiceClass,
  StubConfig: StubConfigClass,
  StubProvider: StubProviderClass,
} = vi.hoisted(() => {
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
});

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

vi.mock('../composition/providerAliases.js', () => ({
  loadProviderAliasEntries: () => aliasEntries,
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-settings')>();

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
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
} = await import('./runtimeSettings.js');

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

      // reasoning.effort was in old defaults (opus) but NOT in new defaults (sonnet).
      // Current value "high" matches old default "high", so it's cleared.
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('user-set reasoning.effort="low" is NOT cleared when switching from opus to sonnet', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User manually overrides reasoning.effort to "low"
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // Current value "low" differs from old default "high", so it's user-owned — not cleared
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('user-set ephemeral settings NOT overridden by model defaults on model change', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // User sets a custom value for a key that model defaults would set
      stubConfig.setEphemeralSetting('reasoning.enabled', false);

      await setActiveModel('claude-opus-4-6');

      // Current value (false) differs from old default (true), so treated as user-owned
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

    // --- Ambiguous edge case (documenting the policy) ---

    it('clears value matching old default even if user-set (stateless policy trade-off)', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // User explicitly sets reasoning.effort to "high" (same as opus default).
      // The stateless recomputation cannot distinguish this from model-defaulted.
      stubConfig.setEphemeralSetting('reasoning.effort', 'high');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // Per stateless policy: current value "high" === old default "high",
      // so it IS cleared even though the user set it explicitly.
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    // --- Alias-set value vs model-default edge case ---

    it('clears alias-set value that matches model default on switch to non-matching model', async () => {
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

      // reasoning.enabled IS cleared: current value (true) matches old model default (true)
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
    });

    // --- Transition matrix ---

    it('Opus-4-6 -> Sonnet-4-5: reasoning.effort cleared, others stay', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      await setActiveModel('claude-sonnet-4-5-20250929');

      // reasoning.effort: was in opus defaults, not in sonnet defaults, current matches old → cleared
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

      // Old defaults exist, new defaults are {} — all cleared since current matches old
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
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      // setActiveModel for the same model
      await setActiveModel('claude-opus-4-6');

      // Current value "low" differs from old default "high" → user-owned, not overwritten
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('/model opus applies default high, then user sets low, then /model opus again: low stays', async () => {
      await setupAnthropicProvider('claude-opus-4-6');

      // Model defaults applied reasoning.effort: "high"
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');

      // User sets low
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      // /model opus again
      await setActiveModel('claude-opus-4-6');

      // Current value "low" differs from old default "high" → user-owned, stays
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('--set reasoning.effort=low then /model opus: low stays (old model has no effort default)', async () => {
      await setupAnthropicProvider('claude-sonnet-4-5-20250929');

      // Sonnet has no reasoning.effort default
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();

      // User sets reasoning.effort=low
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      // /model opus
      await setActiveModel('claude-opus-4-6');

      // Old model (sonnet) has no effort default, so current "low" doesn't match
      // any old default → treated as user-owned → not overwritten by opus default "high"
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    // --- --profile-load bootstrap interaction ---

    it('--profile-load X --set reasoning.effort=low then setActiveModel: low stays', async () => {
      pushAnthropicAlias();

      // Profile load path: skipModelDefaults: true
      await switchActiveProvider('anthropic', { skipModelDefaults: true });
      activeProviderName = 'anthropic';

      // Then --set is applied after profile load
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');

      // Then user changes model via /model
      await setActiveModel('claude-opus-4-6');

      // Profile load skipped model defaults, so old model has no computed defaults.
      // Current "low" doesn't match any old default → user-owned → stays
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });
  });
});
