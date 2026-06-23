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

    // Set up runtime context and provider infrastructure
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

    // Ensure provider instance default doesn't match alias default
    providers.qwenvercel.defaultModel = 'gpt-4o';
    providers.qwenvercel.providerConfig.baseUrl = 'https://portal.qwen.ai/v1';

    providers.anthropic.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';
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
});
