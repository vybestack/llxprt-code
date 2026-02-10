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

    vi.clearAllMocks();
  });

  afterEach(() => {
    debugLoggerWarnSpy.mockReset();
    vi.clearAllMocks();
  });

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
});
