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

interface AliasEntryWithConfig {
  config?: { ephemeralSettings?: Record<string, unknown> };
}

function ensureAliasConfig(entry: AliasEntryWithConfig): {
  ephemeralSettings?: Record<string, unknown>;
} {
  entry.config ??= {};
  return entry.config;
}

const {
  StubSettingsService: StubSettingsServiceClass,
  StubConfig: StubConfigClass,
  StubProvider: StubProviderClass,
} = (() => {
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
  qwen: new StubProvider('qwen'),
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
    SettingsService: StubSettingsServiceClass,
    Config: StubConfigClass,
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
    await switchStubProvider('qwenvercel', {});

    expect(settingsOwner.readSelectedModel()).toBe('qwen3-coder-plus');
    expect(settingsOwner.readNamedParameter('context-limit')).toBe(200000);
    expect(settingsOwner.readNamedParameter('max_tokens')).toBe(50000);

    expect(stubSettingsService.getProviderSettings('qwenvercel').model).toBe(
      'qwen3-coder-plus',
    );
  });

  it('rejects content generator initialization failure when switching providers', async () => {
    settingsOwner.writeUserParameter('auth-key', 'test-key');
    const initError = new Error('init failed');
    initializeClient = async (): Promise<void> => {
      throw initError;
    };

    await expect(switchStubProvider('gemini', {})).rejects.toBe(initError);
  });

  it('does not override preserved ephemerals', async () => {
    settingsOwner.writeUserParameter('max_tokens', 8192);

    await switchStubProvider('qwenvercel', {
      preserveEphemerals: ['max_tokens'],
    });

    expect(settingsOwner.readNamedParameter('max_tokens')).toBe(8192);
  });

  it('does not allow alias ephemerals to set protected canonical keys', async () => {
    const entry = aliasEntries[0] as {
      config?: { ephemeralSettings?: Record<string, unknown> };
    };
    ensureAliasConfig(entry).ephemeralSettings = {
      'auth-key': 'should-not-apply',
      'auth-keyfile': '/should/not/apply',
      'base-url': 'https://alias.example/v1',
      max_tokens: 50000,
    };

    await switchStubProvider('qwenvercel', {});

    expect(settingsOwner.readNamedParameter('auth-key')).toBeUndefined();
    expect(settingsOwner.readNamedParameter('auth-keyfile')).toBeUndefined();
    expect(settingsOwner.readNamedParameter('base-url')).toBeUndefined();
    expect(settingsOwner.readNamedParameter('max_tokens')).toBe(50000);
  });

  it('does not let a legacy auth spelling reach the canonical auth slot', async () => {
    // Exact-key semantics (issue #2533): 'api-key' is not resolved to
    // 'auth-key' anywhere in the runtime, so a legacy spelling in alias
    // data can never populate the canonical credential slot.
    const entry = aliasEntries[0] as {
      config?: { ephemeralSettings?: Record<string, unknown> };
    };
    ensureAliasConfig(entry).ephemeralSettings = {
      'api-key': 'legacy-value',
      max_tokens: 50000,
    };

    await switchStubProvider('qwenvercel', {});

    expect(settingsOwner.readNamedParameter('auth-key')).toBeUndefined();
    expect(settingsOwner.readNamedParameter('max_tokens')).toBe(50000);
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

    await switchStubProvider('gemini', {});

    expect(settingsOwner.readSelectedModel()).toBe('gemini-2.5-pro');
    expect(stubSettingsService.getProviderSettings('gemini').model).toBe(
      'gemini-2.5-pro',
    );
  });

  it('ignores non-scalar alias ephemeral values', async () => {
    const entry = aliasEntries[0] as {
      config?: { ephemeralSettings?: Record<string, unknown> };
    };
    ensureAliasConfig(entry).ephemeralSettings = {
      'context-limit': [200000],
      max_tokens: 50000,
    };

    await switchStubProvider('qwenvercel', {});

    expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
    expect(settingsOwner.readNamedParameter('max_tokens')).toBe(50000);
  });

  // --- Model defaults from alias config ---

  describe('config-driven model defaults in switchActiveProvider', () => {
    it('applies all model defaults for claude-opus-4-6 from alias config modelDefaults', async () => {
      pushAnthropicAlias();

      await switchStubProvider('anthropic', {});

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

    it('applies broad-pattern defaults but not effort for claude-sonnet-4-5-20250929', async () => {
      pushAnthropicAlias({ defaultModel: 'claude-sonnet-4-5-20250929' });

      await switchStubProvider('anthropic', {});

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
      // Sonnet does NOT match the claude-opus-4-6 pattern, so no effort
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
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

      await switchStubProvider('openrouter', {});

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

    it('skips model defaults when skipModelDefaults is true (profile path)', async () => {
      pushAnthropicAlias();

      await switchStubProvider('anthropic', { skipModelDefaults: true });

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

      await switchStubProvider('anthropic', {});

      // Model default "high" overrides alias "medium"
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
      // Other model defaults also apply
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
    });

    it('pre-existing preserved ephemeral settings are NOT overridden by model defaults (snapshot protection)', async () => {
      // Simulate a preserved ephemeral: reasoning.effort was set before the switch
      // and is listed in preserveEphemerals. After the ephemeral clear, it survives
      // and should be in preAliasEphemeralKeys, protecting it from model defaults.
      settingsOwner.writeUserParameter('reasoning.effort', 'low');

      pushAnthropicAlias();

      await switchStubProvider('anthropic', {
        preserveEphemerals: ['reasoning.effort'],
      });

      // The preserved "low" value must survive, model default "high" must NOT override it
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
      // Other model defaults that weren't preserved DO apply
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
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

      await switchStubProvider('anthropic', {});

      // Broad rule sets base, specific rule overrides effort
      expect(settingsOwner.readNamedParameter('reasoning.enabled')).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.adaptiveThinking'),
      ).toBe(true);
      expect(
        settingsOwner.readNamedParameter('reasoning.includeInContext'),
      ).toBe(true);
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');
    });
  });

  // --- Provider alias default fallback (issue #3255 precedence) ---

  describe('provider alias default fallback (issue #3255 precedence)', () => {
    it('applies provider-level reasoning map alias defaults when no model rule supplies them', async () => {
      pushAnthropicAlias({
        defaultModel: 'claude-sonnet-4-5-20250929',
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.effortMap': { high: 'provider-high' },
          'reasoning.enabledMap': { true: 'enabled', false: null },
        },
      });
      await switchStubProvider('anthropic', {});
      activeProviderName = 'anthropic';

      // The broad sonnet rule sets no maps, so the provider-level maps are
      // the effective defaults for the session.
      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({ high: 'provider-high' });
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: null });
    });

    it('overrides a provider-level reasoning map with a matching model map and restores it when leaving that model', async () => {
      pushAnthropicAlias({
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.effortMap': { high: 'provider-high' },
          'reasoning.enabledMap': { true: 'enabled', false: null },
        },
        modelDefaults: [
          {
            pattern: 'claude-opus-4-6',
            ephemeralSettings: {
              'reasoning.effortMap': { high: 'model-high' },
            },
          },
        ],
      });
      await switchStubProvider('anthropic', {});
      activeProviderName = 'anthropic';

      // Model default > provider alias default while the rule matches.
      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({ high: 'model-high' });
      // No model rule owns enabledMap, so the provider map stays in force.
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: null });

      await setActiveModel('gpt-4o', ...stubOverrideInputs());

      // Leaving the matching model rule restores the provider alias default.
      expect(
        settingsOwner.readNamedParameter('reasoning.effortMap'),
      ).toStrictEqual({ high: 'provider-high' });
      expect(
        settingsOwner.readNamedParameter('reasoning.enabledMap'),
      ).toStrictEqual({ true: 'enabled', false: null });
    });

    it('a new matching model default overrides a provider-owned value and the provider default is restored when leaving', async () => {
      pushAnthropicAlias({
        defaultModel: 'claude-sonnet-4-5-20250929',
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.effort': 'medium',
        },
      });
      await switchStubProvider('anthropic', {});
      activeProviderName = 'anthropic';

      // The sonnet rule sets no effort, so the provider default owns the key.
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe(
        'medium',
      );

      // The opus rule starts matching: model default > provider alias default.
      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');

      // Leaving the opus rule restores the provider alias default.
      await setActiveModel('gpt-4o', ...stubOverrideInputs());
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe(
        'medium',
      );
    });

    it('keeps a session value equal to the provider default when a model default starts matching', async () => {
      pushAnthropicAlias({
        defaultModel: 'claude-sonnet-4-5-20250929',
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'reasoning.effort': 'medium',
        },
      });
      await switchStubProvider('anthropic', {});
      activeProviderName = 'anthropic';

      // Explicit session write carrying the same value as the provider
      // default: the session owns the key from here on, regardless of value.
      setEphemeralSetting('reasoning.effort', 'medium', settingsOwner);

      await setActiveModel('claude-opus-4-6', ...stubOverrideInputs());

      // The explicit session value survives the matching model default.
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe(
        'medium',
      );
    });

    it('still skips object alias ephemerals for non-reasoning-map keys', async () => {
      pushAnthropicAlias({
        ephemeralSettings: {
          maxOutputTokens: 40000,
          'context-limit': { limit: 200000 },
        },
      });
      await switchStubProvider('anthropic', {});

      // Object values are only permitted for the registered reasoning map
      // keys; every other object ephemeral is still rejected.
      expect(settingsOwner.readNamedParameter('context-limit')).toBeUndefined();
      expect(settingsOwner.readNamedParameter('maxOutputTokens')).toBe(40000);
    });
  });

  describe('--set interaction tests with switchActiveProvider', () => {
    it('--set reasoning.effort=low preserved in preserveEphemerals survives provider switch', async () => {
      // Simulate: --set reasoning.effort=low applied before provider switch,
      // listed in preserveEphemerals so it survives the ephemeral clear.
      settingsOwner.writeUserParameter('reasoning.effort', 'low');

      pushAnthropicAlias();

      await switchStubProvider('anthropic', {
        preserveEphemerals: ['reasoning.effort'],
      });

      // User's --set value survives; model default "high" must not override
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    it('--set reasoning.effort=low AFTER provider switch overrides model default', async () => {
      pushAnthropicAlias();

      await switchStubProvider('anthropic', {});

      // Model default applied reasoning.effort: "high"
      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('high');

      // User runs --set reasoning.effort=low after the switch
      settingsOwner.writeUserParameter('reasoning.effort', 'low');

      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });

    it('--profile-load X --set reasoning.effort=low keeps low', async () => {
      pushAnthropicAlias();

      // Profile load path: skipModelDefaults: true
      await switchStubProvider('anthropic', { skipModelDefaults: true });

      // Model defaults NOT applied (profile path)
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();

      // Then --set is applied after
      settingsOwner.writeUserParameter('reasoning.effort', 'low');

      expect(settingsOwner.readNamedParameter('reasoning.effort')).toBe('low');
    });
  });

  // --- Profile/subagent path tests ---

  describe('profile and subagent paths skip model defaults', () => {
    it('applyProfileWithGuards path skips model defaults via skipModelDefaults: true', async () => {
      pushAnthropicAlias();

      // applyProfileWithGuards internally calls switchActiveProvider with
      // skipModelDefaults: true. We simulate the same call here.
      await switchStubProvider('anthropic', { skipModelDefaults: true });

      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
    });

    it('applyProfileSnapshot path skips model defaults via skipModelDefaults: true', async () => {
      pushAnthropicAlias();

      // applyProfileSnapshot → applyProfileWithGuards → switchActiveProvider
      // with skipModelDefaults: true. Same end result.
      await switchStubProvider('anthropic', { skipModelDefaults: true });

      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
      expect(
        settingsOwner.readNamedParameter('reasoning.effort'),
      ).toBeUndefined();
      // Alias ephemeralSettings still apply when not preserved
      expect(settingsOwner.readNamedParameter('maxOutputTokens')).toBe(40000);
    });
  });

  // --- No modelDefaults in alias config ---

  describe('aliases without modelDefaults', () => {
    it('works normally when alias has no modelDefaults field', async () => {
      // qwenvercel has no modelDefaults — should work fine
      await switchStubProvider('qwenvercel', {});

      expect(settingsOwner.readSelectedModel()).toBe('qwen3-coder-plus');
      expect(settingsOwner.readNamedParameter('context-limit')).toBe(200000);
      expect(
        settingsOwner.readNamedParameter('reasoning.enabled'),
      ).toBeUndefined();
    });
  });

  // --- Qwen is API-key-only via Alibaba Cloud DashScope (OAuth removed) ---

  describe('qwen resolves to the DashScope API-key base URL', () => {
    const DASHSCOPE_BASE_URL =
      'https://dashscope.aliyuncs.com/compatible-mode/v1';

    beforeEach(() => {
      aliasEntries.push({
        alias: 'qwen',
        source: 'builtin',
        filePath: '/fake/qwen.config',
        config: {
          baseProvider: 'openai',
          'base-url': DASHSCOPE_BASE_URL,
          defaultModel: 'qwen3-coder-plus',
          apiKeyEnv: 'DASHSCOPE_API_KEY',
          ephemeralSettings: {
            'context-limit': 200000,
            max_tokens: 50000,
          },
        },
      });
    });

    it('pins the qwen base-url ephemeral to the DashScope compatible-mode endpoint', async () => {
      await switchStubProvider('qwen', {});

      expect(settingsOwner.readNamedParameter('base-url')).toBe(
        DASHSCOPE_BASE_URL,
      );
      expect(stubSettingsService.getProviderSettings('qwen')['base-url']).toBe(
        DASHSCOPE_BASE_URL,
      );
    });

    it('applies the qwen alias default model on switch', async () => {
      await switchStubProvider('qwen', {});

      expect(settingsOwner.readSelectedModel()).toBe('qwen3-coder-plus');
      expect(stubSettingsService.getProviderSettings('qwen').model).toBe(
        'qwen3-coder-plus',
      );
    });
  });

  // --- Model defaults in setActiveModel (stateless recomputation) ---

  // --- Session identity preservation (issue #2501) ---

  describe('currentProfile survives provider switch (issue #2501)', () => {
    it('preserves currentProfile ephemeral when switching providers', async () => {
      pushAnthropicAlias();

      // Simulate applyProfileSnapshot having set the active profile name.
      settingsOwner.writeUserParameter('currentProfile', 'gpt56solhigh');

      await switchStubProvider('anthropic', {});

      // currentProfile is session-level identity state; it must survive the
      // ephemeral clear so the UI can show the profile-qualified model label.
      expect(settingsOwner.readNamedParameter('currentProfile')).toBe(
        'gpt56solhigh',
      );
    });

    it('preserves currentProfile when not included in preserveEphemerals list', async () => {
      pushAnthropicAlias();

      settingsOwner.writeUserParameter('currentProfile', 'work-profile');
      // executeAutoProvider switches with a limited preserveEphemerals list
      // that does NOT include currentProfile.
      await switchStubProvider('anthropic', {
        preserveEphemerals: [
          'auth-key',
          'auth-keyfile',
          'auth-key-name',
          'base-url',
        ],
      });

      expect(settingsOwner.readNamedParameter('currentProfile')).toBe(
        'work-profile',
      );
    });

    it('clears non-identity ephemerals while preserving currentProfile and activeProvider', async () => {
      pushAnthropicAlias();

      settingsOwner.writeUserParameter('currentProfile', 'my-profile');
      settingsOwner.writeUserParameter('temperature', 0.7);

      await switchStubProvider('anthropic', {});

      expect(settingsOwner.readNamedParameter('currentProfile')).toBe(
        'my-profile',
      );
      expect(settingsOwner.readNamedParameter('activeProvider')).toBe(
        'anthropic',
      );
      // Per-provider ephemerals are still cleared.
      expect(settingsOwner.readNamedParameter('temperature')).toBeUndefined();
    });
  });
});

let settingsOwner: SessionSettingsOwner;
const retainedRoots: Array<{
  config: RealConfig;
  settingsOwner: SessionSettingsOwner;
}> = [];
