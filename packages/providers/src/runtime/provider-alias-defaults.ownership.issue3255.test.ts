import { Config as RealConfig } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService as RealSettingsService } from '@vybestack/llxprt-code-settings';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { assembleModelSelection } from './providerMutations.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
let initializeClient = async (): Promise<void> => {};

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  createProviderRuntimeContext,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
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

const { switchActiveProvider } = await import('./providerSwitch.js');
const { setEphemeralSetting, clearEphemeralSetting } = await import(
  './ownerSettingsOperations.js'
);
const { setActiveModel } = await import('./providerMutations.js');

const mockOAuthManager = {
  clearRetryHandlers: () => {},

  isOAuthEnabled: vi.fn(() => false),
  toggleOAuthEnabled: vi.fn(),
  authenticate: vi.fn(),
  setMessageBus: vi.fn(),
  setConfigGetter: vi.fn(),
} as never;

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

function stubOverrideInputs(): [
  Parameters<typeof setActiveModel>[1],
  RealSettingsService,
] {
  return [assembleModelSelection(settingsOwner), stubSettingsService];
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
    await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());
    activeProviderName = 'anthropic';
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      'anthropic',
    );

    // Explicit session write carrying the same scalar as the source alias
    // default: ownership, not value equality, decides what survives.
    setEphemeralSetting(
      'reasoning.effortWireFormat',
      'anthropic',
      settingsOwner,
    );

    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());
    activeProviderName = 'openrouter';

    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
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
    await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());
    activeProviderName = 'anthropic';
    expect(
      settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({ high: 'provider-high' });

    // Fresh object with equal content: neither identity nor equality can
    // classify it, only explicit ownership can.
    setEphemeralSetting(
      'reasoning.effortMap',
      { high: 'provider-high' },
      settingsOwner,
    );

    pushOpenRouterReasoningAlias({
      'reasoning.effortMap': { high: 'openrouter-high' },
    });
    await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());
    activeProviderName = 'openrouter';

    expect(
      settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({ high: 'provider-high' });
  });

  it('replaces a default-owned selector with the target provider default on switch', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
    });
    await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());
    activeProviderName = 'anthropic';

    // No explicit write: the source alias default owns the key, so the
    // conflicting target provider default must replace it.
    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());
    activeProviderName = 'openrouter';

    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      'openrouter',
    );
  });

  it('applies the target provider default after an explicit selector is cleared', async () => {
    pushAnthropicAlias({
      ephemeralSettings: {
        maxOutputTokens: 40000,
        'reasoning.effortWireFormat': 'anthropic',
      },
    });
    await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());
    activeProviderName = 'anthropic';
    setEphemeralSetting('reasoning.effortWireFormat', 'openai', settingsOwner);
    clearEphemeralSetting('reasoning.effortWireFormat', settingsOwner);

    // Clearing releases explicit ownership, so the target default applies
    // instead of the key staying permanently user-owned.
    pushOpenRouterReasoningAlias({
      'reasoning.effortWireFormat': 'openrouter',
    });
    await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());
    activeProviderName = 'openrouter';

    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
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
    await switchActiveProvider('anthropic', {}, ...stubSwitchInputs());
    activeProviderName = 'anthropic';

    // The alias default and the matching model default both claimed the
    // key: the model default owns the visible value, the alias default is
    // the provider-owned restore point behind it.
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      'anthropic-budget',
    );

    clearEphemeralSetting('reasoning.effortWireFormat', settingsOwner);
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      undefined,
    );

    // Departing the default-owning model must not resurrect the cleared
    // alias default through a stale provider-owned restore point.
    await setActiveModel(
      'plain-model',
      ...stubOverrideInputs(),
      mockProviderManager.getActiveProvider(),
    );
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      undefined,
    );

    // Re-entering the default-owning model re-applies the model default
    // through normal default ownership, not through the stale record.
    await setActiveModel(
      'model-with-defaults',
      ...stubOverrideInputs(),
      mockProviderManager.getActiveProvider(),
    );
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      'anthropic-budget',
    );

    await setActiveModel(
      'plain-model',
      ...stubOverrideInputs(),
      mockProviderManager.getActiveProvider(),
    );
    expect(settingsOwner.readNamedParameter('reasoning.effortWireFormat')).toBe(
      undefined,
    );
  });
});

describe('alias reasoning maps propagate to request preparation (issue #3255)', () => {
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
    await switchActiveProvider('openrouter', {}, ...stubSwitchInputs());
    activeProviderName = 'openrouter';
    return settingsOwner.captureNamedParameters();
  }

  async function prepareAliasRequest(
    ephemeralsSnapshot: Record<string, unknown>,
  ): Promise<unknown> {
    // The real invocation context derives modelBehavior from the switched
    // ephemerals through separateSettings, so the alias value must survive
    // the full runtime hand-off to reach request preparation.
    const invocation = createRuntimeInvocationContext({
      runtimeId: createProviderRuntimeContext({
        settingsService: stubSettingsService as never,
        runtimeId: 'alias-request-test',
      }).runtimeId,
      runtimeMetadata: createProviderRuntimeContext({
        settingsService: stubSettingsService as never,
        runtimeId: 'alias-request-test',
      }).metadata,

      providerName: 'openrouter',
      ephemeralsSnapshot,
    });
    const options: NormalizedGenerateChatOptions = {
      contents: [],
      tools: undefined,
      metadata: {},

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
    expect(
      settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual(['high']);

    await expect(prepareAliasRequest(ephemerals)).rejects.toThrow(
      'reasoning.effortMap must be a JSON object',
    );
  });

  it('rejects an alias effort map with an unknown key before transport', async () => {
    const ephemerals = await switchToOpenRouterAlias({ turbo: 'high' });

    expect(
      settingsOwner.readNamedParameter('reasoning.effortMap'),
    ).toStrictEqual({
      turbo: 'high',
    });

    await expect(prepareAliasRequest(ephemerals)).rejects.toThrow(
      "reasoning.effortMap contains unsupported key 'turbo'",
    );
  });
});

let settingsOwner: SessionSettingsOwner;
const retainedRoots: Array<{
  config: RealConfig;
  settingsOwner: SessionSettingsOwner;
}> = [];
