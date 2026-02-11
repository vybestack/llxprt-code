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
      if (!this.providers[provider]) {
        this.providers[provider] = {};
      }
      if (value === undefined) {
        delete this.providers[provider][key];
      } else {
        this.providers[provider][key] = value;
      }
    }

    getProviderSettings(provider: string): Record<string, unknown> {
      return this.providers[provider] || {};
    }

    switchProvider = vi.fn(async (provider: string) => {
      this.set('activeProvider', provider);
    });

    async updateSettings(
      providerOrChanges?: string | Record<string, unknown>,
      changes?: Record<string, unknown>,
    ): Promise<void> {
      if (typeof providerOrChanges === 'string' && changes) {
        for (const [key, value] of Object.entries(changes)) {
          this.setProviderSetting(providerOrChanges, key, value);
        }
      } else if (providerOrChanges && typeof providerOrChanges === 'object') {
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

vi.mock('../providers/providerAliases.js', () => ({
  loadProviderAliasEntries: () => aliasEntries,
}));

vi.mock('@vybestack/llxprt-code-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@vybestack/llxprt-code-core')>();

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
    stubSettingsService = new StubSettingsService();
    stubConfig = new StubConfig(stubSettingsService);
    activeProviderName = 'openai';

    // Set up runtime context and provider infrastructure
    setCliRuntimeContext(stubSettingsService as never, stubConfig as never, {
      runtimeId: 'test-runtime',
    });
    registerCliProviderInfrastructure(
      mockProviderManager as never,
      mockOAuthManager,
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

    // Ensure provider instance default doesn't match alias default
    providers.qwenvercel.defaultModel = 'gpt-4o';
    providers.qwenvercel.providerConfig.baseUrl = 'https://portal.qwen.ai/v1';

    providers.anthropic.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';

    vi.clearAllMocks();
  });

  afterEach(() => {
    debugLoggerWarnSpy.mockReset();
    vi.clearAllMocks();
  });

  // --- Existing alias default tests (non-model-defaults) ---

  it('applies alias defaultModel + alias ephemeralSettings on switch', async () => {
    await switchActiveProvider('qwenvercel');

    expect(stubConfig.getModel()).toBe('qwen3-coder-plus');
    expect(stubConfig.getEphemeralSetting('context-limit')).toBe(200000);
    expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(50000);

    expect(stubSettingsService.getProviderSettings('qwenvercel').model).toBe(
      'qwen3-coder-plus',
    );
  });

  it('warns if content generator config initialization fails when switching providers', async () => {
    stubConfig.setEphemeralSetting('auth-key', 'test-key');
    const initError = new Error('init failed');
    stubConfig.initializeContentGeneratorConfig = vi.fn(async () => {
      throw initError;
    });

    await switchActiveProvider('gemini');

    expect(stubConfig.initializeContentGeneratorConfig).toHaveBeenCalledTimes(
      1,
    );
    expect(debugLoggerWarnSpy).toHaveBeenCalledWith(expect.any(Function));
  });

  it('does not override preserved ephemerals', async () => {
    stubConfig.setEphemeralSetting('max_tokens', 8192);

    await switchActiveProvider('qwenvercel', {
      preserveEphemerals: ['max_tokens'],
    });

    expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(8192);
  });

  it('does not allow alias ephemerals to set auth-like keys', async () => {
    const entry = aliasEntries[0] as {
      config?: { ephemeralSettings?: Record<string, unknown> };
    };
    entry.config = entry.config ?? {};
    entry.config.ephemeralSettings = {
      'api-key': 'should-not-apply',
      max_tokens: 50000,
    };

    await switchActiveProvider('qwenvercel');

    expect(stubConfig.getEphemeralSetting('api-key')).toBeUndefined();
    expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(50000);
  });

  it('uses gemini alias default model and provider auth on switch', async () => {
    aliasEntries.push({
      alias: 'gemini',
      source: 'builtin',
      filePath: '/fake/gemini.config',
      config: {
        baseProvider: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        defaultModel: 'gemini-2.5-pro',
      },
    });

    await switchActiveProvider('gemini');

    expect(stubConfig.getModel()).toBe('gemini-2.5-pro');
    expect(stubSettingsService.getProviderSettings('gemini').model).toBe(
      'gemini-2.5-pro',
    );
  });

  it('ignores non-scalar alias ephemeral values', async () => {
    const entry = aliasEntries[0] as {
      config?: { ephemeralSettings?: Record<string, unknown> };
    };
    entry.config = entry.config ?? {};
    entry.config.ephemeralSettings = {
      'context-limit': [200000],
      max_tokens: 50000,
    };

    await switchActiveProvider('qwenvercel');

    expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
    expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(50000);
  });

  // --- Model defaults from alias config ---

  describe('config-driven model defaults in switchActiveProvider', () => {
    it('applies all model defaults for claude-opus-4-6 from alias config modelDefaults', async () => {
      pushAnthropicAlias();

      await switchActiveProvider('anthropic');

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

    it('applies broad-pattern defaults but not effort for claude-sonnet-4-5-20250929', async () => {
      pushAnthropicAlias({ defaultModel: 'claude-sonnet-4-5-20250929' });

      await switchActiveProvider('anthropic');

      expect(stubConfig.getModel()).toBe('claude-sonnet-4-5-20250929');
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      // Sonnet does NOT match the claude-opus-4-6 pattern, so no effort
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('does not apply model defaults for a non-Claude model', async () => {
      // Use openrouter with no modelDefaults
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

    it('skips model defaults when skipModelDefaults is true (profile path)', async () => {
      pushAnthropicAlias();

      await switchActiveProvider('anthropic', { skipModelDefaults: true });

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

    it('model defaults override alias-level ephemeralSettings (precedence flip)', async () => {
      // Alias sets reasoning.effort: "medium" at the provider level.
      // Model default sets reasoning.effort: "high" for claude-opus-4-6.
      // Model default WINS because alias keys are NOT in preAliasEphemeralKeys.
      pushAnthropicAlias({
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.effort': 'medium',
        },
      });

      await switchActiveProvider('anthropic');

      // Model default "high" overrides alias "medium"
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
      // Other model defaults also apply
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
    });

    it('pre-existing preserved ephemeral settings are NOT overridden by model defaults (snapshot protection)', async () => {
      // Simulate a preserved ephemeral: reasoning.effort was set before the switch
      // and is listed in preserveEphemerals. After the ephemeral clear, it survives
      // and should be in preAliasEphemeralKeys, protecting it from model defaults.
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      pushAnthropicAlias();

      await switchActiveProvider('anthropic', {
        preserveEphemerals: ['reasoning.effort'],
      });

      // The preserved "low" value must survive, model default "high" must NOT override it
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
      // Other model defaults that weren't preserved DO apply
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
    });

    it('multiple rules merge in order — broad pattern sets base, specific pattern adds/overrides', async () => {
      pushAnthropicAlias({
        modelDefaults: [
          {
            pattern: 'claude-(opus|sonnet|haiku)',
            ephemeralSettings: {
              'reasoning.enabled': true,
              'reasoning.adaptiveThinking': true,
              'reasoning.includeInContext': true,
              'reasoning.effort': 'medium',
            },
          },
          {
            pattern: 'claude-opus-4-6',
            ephemeralSettings: {
              'reasoning.effort': 'high',
            },
          },
        ],
      });

      await switchActiveProvider('anthropic');

      // Broad rule sets base, specific rule overrides effort
      expect(stubConfig.getEphemeralSetting('reasoning.enabled')).toBe(true);
      expect(stubConfig.getEphemeralSetting('reasoning.adaptiveThinking')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.includeInContext')).toBe(
        true,
      );
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');
    });
  });

  // --- --set interaction tests ---

  describe('--set interaction tests with switchActiveProvider', () => {
    it('--set reasoning.effort=low preserved in preserveEphemerals survives provider switch', async () => {
      // Simulate: --set reasoning.effort=low applied before provider switch,
      // listed in preserveEphemerals so it survives the ephemeral clear.
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      pushAnthropicAlias();

      await switchActiveProvider('anthropic', {
        preserveEphemerals: ['reasoning.effort'],
      });

      // User's --set value survives; model default "high" must not override
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('--set reasoning.effort=low AFTER provider switch overrides model default', async () => {
      pushAnthropicAlias();

      await switchActiveProvider('anthropic');

      // Model default applied reasoning.effort: "high"
      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('high');

      // User runs --set reasoning.effort=low after the switch
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });

    it('--profile-load X --set reasoning.effort=low keeps low', async () => {
      pushAnthropicAlias();

      // Profile load path: skipModelDefaults: true
      await switchActiveProvider('anthropic', { skipModelDefaults: true });

      // Model defaults NOT applied (profile path)
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();

      // Then --set is applied after
      stubConfig.setEphemeralSetting('reasoning.effort', 'low');

      expect(stubConfig.getEphemeralSetting('reasoning.effort')).toBe('low');
    });
  });

  // --- Profile/subagent path tests ---

  describe('profile and subagent paths skip model defaults', () => {
    it('applyProfileWithGuards path skips model defaults via skipModelDefaults: true', async () => {
      pushAnthropicAlias();

      // applyProfileWithGuards internally calls switchActiveProvider with
      // skipModelDefaults: true. We simulate the same call here.
      await switchActiveProvider('anthropic', { skipModelDefaults: true });

      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
    });

    it('applyProfileSnapshot path skips model defaults via skipModelDefaults: true', async () => {
      pushAnthropicAlias();

      // applyProfileSnapshot → applyProfileWithGuards → switchActiveProvider
      // with skipModelDefaults: true. Same end result.
      await switchActiveProvider('anthropic', { skipModelDefaults: true });

      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        stubConfig.getEphemeralSetting('reasoning.effort'),
      ).toBeUndefined();
      // Alias ephemeralSettings still apply when not preserved
      expect(stubConfig.getEphemeralSetting('maxOutputTokens')).toBe(40000);
    });
  });

  // --- No modelDefaults in alias config ---

  describe('aliases without modelDefaults', () => {
    it('works normally when alias has no modelDefaults field', async () => {
      // qwenvercel has no modelDefaults — should work fine
      await switchActiveProvider('qwenvercel');

      expect(stubConfig.getModel()).toBe('qwen3-coder-plus');
      expect(stubConfig.getEphemeralSetting('context-limit')).toBe(200000);
      expect(
        stubConfig.getEphemeralSetting('reasoning.enabled'),
      ).toBeUndefined();
    });
  });

  // --- Model defaults in setActiveModel (stateless recomputation) ---

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
