/**
 * @requirement:Issue-181 Issue-1769
 * Test suite for Claude Code OAuth default settings
 *
 * Verifies that when switching to Claude Code provider with OAuth (subscription mode),
 * user-set values for context_limit, max_tokens, and maxOutputTokens are preserved.
 * Hardcoded defaults have been removed (Issue #1769); defaults now come from
 * the claudecode.config alias ephemeralSettings instead.
 * This applies when either:
 * - authOnly=true is set (explicit OAuth mode), OR
 * - oauthManager.isOAuthEnabled('claudecode') returns true (OAuth is actively being used)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

    updateSettings = vi.fn(
      async (
        providerOrChanges?: string | Record<string, unknown>,
        maybeChanges?: Record<string, unknown>,
      ) => {
        if (
          typeof providerOrChanges === 'string' &&
          typeof maybeChanges === 'object'
        ) {
          for (const [key, value] of Object.entries(maybeChanges)) {
            this.setProviderSetting(providerOrChanges, key, value);
          }
        }
      },
    );
  }

  class StubConfig {
    private model: string | undefined = undefined;
    private provider = 'openai';
    private ephemeral: Record<string, unknown> = {};
    private providerManager: unknown;
    private settingsService: InstanceType<typeof StubSettingsService>;

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
    model = 'model-a';
    baseUrl: string | undefined;
    defaultModel = 'default-model';

    constructor(name: string) {
      this.name = name;
    }

    getDefaultModel(): string {
      return this.defaultModel;
    }

    getBaseURL(): string | undefined {
      return this.baseUrl;
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
  anthropic: new StubProvider('anthropic'),
  claudecode: new StubProvider('claudecode'),
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
    peekActiveProviderRuntimeContext: () => activeContext,
    getCurrentRuntimeScope: () => undefined,
  };
});

vi.mock(
  '@vybestack/llxprt-code-providers/composition/providerAliases.js',
  () => ({
    loadProviderAliasEntries: () => [],
  }),
);

const {
  switchActiveProvider,
  setCliRuntimeContext,
  registerCliProviderInfrastructure,
} = await import('./runtimeSettings.js');

let mockOAuthEnabledForClaudeCode = false;

const mockOAuthManager = {
  isOAuthEnabled: vi.fn((provider: string) => {
    if (provider === 'claudecode') {
      return mockOAuthEnabledForClaudeCode;
    }
    return false;
  }),
  toggleOAuthEnabled: vi.fn(),
  authenticate: vi.fn(),
  setMessageBus: vi.fn(),
  setConfigGetter: vi.fn(),
} as never;

describe('Claude Code OAuth defaults (Issue #181)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    stubSettingsService = new StubSettingsService();
    stubConfig = new StubConfig(stubSettingsService);
    activeProviderName = 'openai';
    mockOAuthEnabledForClaudeCode = false;

    // Set up the runtime context so switchActiveProvider can find it
    setCliRuntimeContext(stubSettingsService as never, stubConfig as never, {
      runtimeId: 'test-runtime',
    });

    // Register the provider manager
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when switching to Claude Code with authOnly=true', () => {
    it('should NOT inject hardcoded context-limit default (Issue #1769)', async () => {
      stubConfig.setEphemeralSetting('authOnly', true);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
    });

    it('should NOT inject hardcoded max_tokens default (Issue #1769)', async () => {
      stubConfig.setEphemeralSetting('authOnly', true);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });

    it('should restore maxOutputTokens when previously set and no explicit max_tokens (Issue #1769)', async () => {
      stubConfig.setEphemeralSetting('authOnly', true);
      stubConfig.setEphemeralSetting('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('maxOutputTokens')).toBe(40000);
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });

    it('should NOT override existing context_limit ephemeral setting', async () => {
      stubConfig.setEphemeralSetting('authOnly', true);
      stubConfig.setEphemeralSetting('context-limit', 150000);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('context-limit')).toBe(150000);
    });

    it('should NOT override existing max_tokens ephemeral setting', async () => {
      stubConfig.setEphemeralSetting('authOnly', true);
      stubConfig.setEphemeralSetting('max_tokens', 8192);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(8192);
    });
  });

  describe('when switching to Claude Code with authOnly=false', () => {
    it('should NOT set default context_limit when authOnly is false', async () => {
      // Arrange: authOnly disabled (API key mode)
      stubConfig.setEphemeralSetting('authOnly', false);

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode');

      // Assert: context_limit should NOT be set
      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
    });

    it('should NOT set default max_tokens when authOnly is false', async () => {
      // Arrange: authOnly disabled (API key mode)
      stubConfig.setEphemeralSetting('authOnly', false);

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode');

      // Assert: max_tokens should NOT be set
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });
  });

  describe('when switching to Claude Code with authOnly undefined', () => {
    it('should NOT set defaults when authOnly is undefined and OAuth not enabled', async () => {
      // Arrange: authOnly not set (default behavior), OAuth not enabled
      // (don't set authOnly at all)

      // Act: Switch to Claude Code provider
      await switchActiveProvider('claudecode');

      // Assert: No defaults should be applied
      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });
  });

  describe('when switching to Claude Code with OAuth enabled (via oauthManager)', () => {
    it('should NOT inject hardcoded context-limit default (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
    });

    it('should NOT inject hardcoded max_tokens default (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });

    it('should restore maxOutputTokens when previously set and no explicit max_tokens (Issue #1769)', async () => {
      mockOAuthEnabledForClaudeCode = true;
      stubConfig.setEphemeralSetting('maxOutputTokens', 40000);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('maxOutputTokens')).toBe(40000);
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });

    it('should NOT override existing context_limit when OAuth is enabled', async () => {
      mockOAuthEnabledForClaudeCode = true;
      stubConfig.setEphemeralSetting('context-limit', 150000);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('context-limit')).toBe(150000);
    });

    it('should NOT override existing max_tokens when OAuth is enabled', async () => {
      mockOAuthEnabledForClaudeCode = true;
      stubConfig.setEphemeralSetting('max_tokens', 8192);

      await switchActiveProvider('claudecode');

      expect(stubConfig.getEphemeralSetting('max_tokens')).toBe(8192);
    });
  });

  describe('when switching to non-Claude Code providers', () => {
    it('should NOT set defaults for OpenAI even with authOnly=true', async () => {
      // Arrange: authOnly enabled but switching to OpenAI
      stubConfig.setEphemeralSetting('authOnly', true);
      activeProviderName = 'claudecode'; // Start from claudecode

      // Act: Switch to OpenAI
      await switchActiveProvider('openai');

      // Assert: No Claude Code-specific defaults should be set
      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
    });

    it('does not apply OAuth defaults to API-key-only anthropic', async () => {
      mockOAuthEnabledForClaudeCode = true;
      activeProviderName = 'claudecode';

      await switchActiveProvider('anthropic');

      expect(stubConfig.getEphemeralSetting('context-limit')).toBeUndefined();
      expect(stubConfig.getEphemeralSetting('max_tokens')).toBeUndefined();
      expect(stubConfig.getEphemeralSetting('maxOutputTokens')).toBeUndefined();
    });
  });
});
