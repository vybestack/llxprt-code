/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  createProviderRuntimeContext,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import type { Profile } from '@vybestack/llxprt-code-settings';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { prepareRequest } from '../openai/OpenAIRequestPreparation.js';

const realProviderAliasesModule = {
  ...(await import('../composition/providerAliases.js')),
};
const realLlxprtCodeCoreModule = {
  ...(await import('@vybestack/llxprt-code-core')),
};

const { aliasEntries } = {
  aliasEntries: [] as Array<Record<string, unknown>>,
};

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
  setEphemeralSetting,
  clearEphemeralSetting,
  setActiveModel,
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
      ...(overrides?.modelDefaults === undefined
        ? {}
        : { modelDefaults: overrides.modelDefaults }),
    },
  });
}

function pushOpenRouterReasoningAlias(
  ephemeralSettings: Record<string, unknown>,
): void {
  aliasEntries.push({
    alias: 'openrouter',
    source: 'builtin',
    filePath: '/fake/openrouter.config',
    config: {
      baseProvider: 'openai',
      defaultModel: 'gpt-4o',
      ephemeralSettings,
    },
  });
}

describe('explicit ownership across provider switches (issue #3255)', () => {
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
        runtimeId: 'test-runtime',
      },
    );

    aliasEntries.length = 0;
    providers.anthropic.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';
  });

  afterEach(() => {
    // Clear recorded calls only: resetting would strip the module-scope
    // no-op warn implementation and let real warnings print mid-suite.
    debugLoggerWarnSpy.mockClear();
    vi.clearAllMocks();
  });

  it('keeps a session selector equal to the source alias default when switching providers', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
    });
    await switchActiveProvider('anthropic');
    activeProviderName = 'anthropic';
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'anthropic',
    );

    // Explicit session write carrying the same scalar as the source alias
    // default: ownership, not value equality, decides what survives.
    setEphemeralSetting('reasoning.effortWireFormat', 'anthropic');

    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';

    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'anthropic',
    );
  });

  it('keeps a session map equal in content to the source alias default when switching providers', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortMap': { high: 'provider-high' },
      },
    });
    await switchActiveProvider('anthropic');
    activeProviderName = 'anthropic';
    expect(stubConfig.getEphemeralSetting('reasoning.effortMap')).toStrictEqual(
      { high: 'provider-high' },
    );

    // Fresh object with equal content: neither identity nor equality can
    // classify it, only explicit ownership can.
    setEphemeralSetting('reasoning.effortMap', { high: 'provider-high' });

    pushOpenRouterReasoningAlias({
      'reasoning.effortMap': { high: 'openrouter-high' },
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';

    expect(stubConfig.getEphemeralSetting('reasoning.effortMap')).toStrictEqual(
      { high: 'provider-high' },
    );
  });

  it('replaces a default-owned selector with the target provider default on switch', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
    });
    await switchActiveProvider('anthropic');
    activeProviderName = 'anthropic';

    // No explicit write: the source alias default owns the key, so the
    // conflicting target provider default must replace it.
    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';

    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'openrouter',
    );
  });

  it('keeps an explicit profile selector through a later provider switch', async () => {
    pushAnthropicAlias();
    const profile: Profile = {
      version: 1,
      provider: 'anthropic',
      model: 'claude-opus-4-6',
      modelParams: {},
      ephemeralSettings: { 'reasoning.enabledWireFormat': 'thinking' },
    };
    await applyProfileWithGuards(profile, {
      profileName: 'explicit-selector-profile',
    });
    activeProviderName = 'anthropic';
    expect(stubConfig.getEphemeralSetting('reasoning.enabledWireFormat')).toBe(
      'thinking',
    );

    pushOpenRouterReasoningAlias({
      'reasoning.enabledWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';

    expect(stubConfig.getEphemeralSetting('reasoning.enabledWireFormat')).toBe(
      'thinking',
    );
  });

  it('applies the target provider default after an explicit selector is cleared', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
    });
    await switchActiveProvider('anthropic');
    activeProviderName = 'anthropic';
    setEphemeralSetting('reasoning.effortWireFormat', 'openai');
    clearEphemeralSetting('reasoning.effortWireFormat');

    // Clearing releases explicit ownership, so the target default applies
    // instead of the key staying permanently user-owned.
    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';

    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'openrouter',
    );
  });

  it('releases every ownership layer when a cleared key was owned by provider and model defaults', async () => {
    pushAnthropicAlias({
      defaultModel: 'model-with-defaults',
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
      modelDefaults: [
        {
          pattern: '^model-with-defaults$',
          ephemeralSettings: {
            'reasoning.effortWireFormat': 'anthropic-budget',
          },
        },
      ],
    });
    await switchActiveProvider('anthropic');
    activeProviderName = 'anthropic';

    // The alias default and the matching model default both claimed the
    // key: the model default owns the visible value, the alias default is
    // the provider-owned restore point behind it.
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'anthropic-budget',
    );

    clearEphemeralSetting('reasoning.effortWireFormat');
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      undefined,
    );

    // Departing the default-owning model must not resurrect the cleared
    // alias default through a stale provider-owned restore point.
    await setActiveModel('plain-model');
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      undefined,
    );

    // Re-entering the default-owning model re-applies the model default
    // through normal default ownership, not through the stale record.
    await setActiveModel('model-with-defaults');
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      'anthropic-budget',
    );

    await setActiveModel('plain-model');
    expect(stubConfig.getEphemeralSetting('reasoning.effortWireFormat')).toBe(
      undefined,
    );
  });
});

describe('alias reasoning maps propagate to request preparation (issue #3255)', () => {
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
    providers.anthropic.defaultModel = 'claude-opus-4-6';
    providers.openrouter.defaultModel = 'gpt-4o';
  });

  afterEach(() => {
    debugLoggerWarnSpy.mockClear();
    vi.clearAllMocks();
  });

  async function switchToOpenRouterAlias(
    effortMap: unknown,
  ): Promise<Record<string, unknown>> {
    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
      'reasoning.effortMap': effortMap,
    });
    await switchActiveProvider('openrouter');
    activeProviderName = 'openrouter';
    return stubConfig.getEphemeralSettings();
  }

  async function prepareAliasRequest(
    ephemeralsSnapshot: Record<string, unknown>,
  ): Promise<unknown> {
    // The real invocation context derives modelBehavior from the switched
    // ephemerals through separateSettings, so the alias value must survive
    // the full runtime hand-off to reach request preparation.
    const invocation = createRuntimeInvocationContext({
      runtime: createProviderRuntimeContext({
        settingsService: stubSettingsService as never,
        runtimeId: 'alias-request-test',
      }),
      settings: stubSettingsService as never,
      providerName: 'openrouter',
      ephemeralsSnapshot,
    });
    const options: NormalizedGenerateChatOptions = {
      contents: [],
      tools: undefined,
      metadata: {},
      settings: stubSettingsService as never,
      config: undefined,
      invocation,
      systemInstruction: undefined,
      resolved: {
        model: 'gpt-4o',
        baseURL: 'https://openrouter.ai/api/v1',
        authToken: 'test-token',
      },
    };

    return prepareRequest(
      options,
      'gpt-4o',
      undefined,
      new DebugLogger('llxprt:runtime:alias-request-test'),
      'openrouter',
    );
  }

  it('rejects an alias effort map array before transport', async () => {
    const ephemerals = await switchToOpenRouterAlias(['high']);

    // The switch stores alias maps unvalidated by design; rejection is
    // owned by request preparation, proving the malformed value actually
    // propagated through the runtime rather than being dropped earlier.
    expect(ephemerals['reasoning.effortMap']).toStrictEqual(['high']);

    await expect(prepareAliasRequest(ephemerals)).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('rejects an alias effort map with an unknown key before transport', async () => {
    const ephemerals = await switchToOpenRouterAlias({ turbo: 'high' });

    expect(ephemerals['reasoning.effortMap']).toStrictEqual({
      turbo: 'high',
    });

    await expect(prepareAliasRequest(ephemerals)).rejects.toThrow(
      "reasoning.effortMap contains unsupported key 'turbo'",
    );
  });
});
