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

  describe('sandbox-base-url and requires-auth propagation from alias config', () => {
    it('propagates sandbox-base-url from alias config to settings service', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'sandbox-base-url': 'http://host.docker.internal:1234/v1/',
        },
      });

      await switchActiveProvider('openrouter');

      expect(
        stubSettingsService.getProviderSettings('openrouter')[
          'sandbox-base-url'
        ],
      ).toBe('http://host.docker.internal:1234/v1/');
    });

    it('propagates requires-auth false from alias config to settings service', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'requires-auth': false,
        },
      });

      await switchActiveProvider('openrouter');

      expect(
        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
      ).toBe(false);
    });

    it('propagates both sandbox-base-url and requires-auth together', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
          'sandbox-base-url': 'http://host.docker.internal:8080/v1/',
          'requires-auth': false,
        },
      });

      await switchActiveProvider('openrouter');

      const settings = stubSettingsService.getProviderSettings('openrouter');
      expect(settings['sandbox-base-url']).toBe(
        'http://host.docker.internal:8080/v1/',
      );
      expect(settings['requires-auth']).toBe(false);
    });

    it('does not set sandbox-base-url when alias config omits it', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
        },
      });

      await switchActiveProvider('openrouter');

      expect(
        stubSettingsService.getProviderSettings('openrouter')[
          'sandbox-base-url'
        ],
      ).toBeUndefined();
    });

    it('does not set requires-auth when alias config omits it', async () => {
      aliasEntries.push({
        alias: 'openrouter',
        source: 'builtin',
        filePath: '/fake/openrouter.config',
        config: {
          baseProvider: 'openai',
          defaultModel: 'gpt-4o',
        },
      });

      await switchActiveProvider('openrouter');

      expect(
        stubSettingsService.getProviderSettings('openrouter')['requires-auth'],
      ).toBeUndefined();
    });
  });

  describe('Anthropic OAuth maxOutputTokens respect (Issue #1769)', () => {
    const enableOAuth = () =>
      vi
        .mocked(
          (
            mockOAuthManager as unknown as {
              isOAuthEnabled: ReturnType<typeof vi.fn>;
            }
          ).isOAuthEnabled,
        )
        .mockReturnValue(true);
    const disableOAuth = () =>
      vi
        .mocked(
          (
            mockOAuthManager as unknown as {
              isOAuthEnabled: ReturnType<typeof vi.fn>;
            }
          ).isOAuthEnabled,
        )
        .mockReturnValue(false);

    it('should restore maxOutputTokens and not inject max_tokens=10000 when user had maxOutputTokens configured', async () => {
      pushAnthropicAlias();
      enableOAuth();

      stubConfig.setEphemeralSetting('maxOutputTokens', 40000);

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('maxOutputTokens')).toBe(40000);
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should prefer explicit max_tokens over maxOutputTokens when both are set', async () => {
      pushAnthropicAlias();
      enableOAuth();

      stubConfig.setEphemeralSetting('max_tokens', 50000);
      stubConfig.setEphemeralSetting('maxOutputTokens', 40000);

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(50000);

      disableOAuth();
    });

    it('should not inject max_tokens default when neither max_tokens nor maxOutputTokens is set (Issue #1769)', async () => {
      pushAnthropicAlias();
      enableOAuth();

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat maxOutputTokens=0 as not configured and use default', async () => {
      pushAnthropicAlias();
      enableOAuth();

      stubConfig.setEphemeralSetting('maxOutputTokens', 0);

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat negative maxOutputTokens as not configured and use default', async () => {
      pushAnthropicAlias();
      enableOAuth();

      stubConfig.setEphemeralSetting('maxOutputTokens', -1);

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();

      disableOAuth();
    });

    it('should treat non-numeric maxOutputTokens as not configured and use default', async () => {
      pushAnthropicAlias();
      enableOAuth();

      stubConfig.setEphemeralSetting('maxOutputTokens', '40000');

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();

      disableOAuth();
    });
  });
});
