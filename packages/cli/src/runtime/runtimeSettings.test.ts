import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Config,
  SettingsService,
  ProviderManager,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from '../auth/oauth-manager.js';

const {
  StubSettingsService: StubSettingsServiceClass,
  StubConfig: StubConfigClass,
  StubProvider: StubProviderClass,
} = vi.hoisted(() => {
  class StubSettingsService {
    providers: Record<string, Record<string, unknown>> = {};
    global: Record<string, unknown> = {};
    private currentProfile: string | null = null;

    set(key: string, value: unknown) {
      this.global[key] = value;
    }

    get(key: string): unknown {
      return this.global[key];
    }

    setProviderSetting(provider: string, key: string, value: unknown) {
      if (!this.providers[provider]) {
        this.providers[provider] = {};
      }
      this.providers[provider][key] = value;
    }

    getProviderSettings(provider: string): Record<string, unknown> {
      return this.providers[provider] || {};
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
          maybeChanges &&
          typeof maybeChanges === 'object'
        ) {
          for (const [key, value] of Object.entries(maybeChanges)) {
            this.setProviderSetting(providerOrChanges, key, value);
          }
          return;
        }

        if (
          providerOrChanges &&
          typeof providerOrChanges === 'object' &&
          !Array.isArray(providerOrChanges)
        ) {
          for (const [key, value] of Object.entries(providerOrChanges)) {
            this.set(key, value);
          }
        }
      },
    );

    setCurrentProfileName(name: string | null) {
      this.currentProfile = name;
    }

    getCurrentProfileName() {
      return this.currentProfile;
    }
  }

  class StubConfig {
    private model = 'model-a';
    private provider = 'openai';
    private ephemeral: Record<string, unknown> = {};
    private providerManager: unknown;
    private settingsService: StubSettingsService;
    private lastRefreshedAuthType: string | undefined;

    constructor(settingsService: StubSettingsService) {
      this.settingsService = settingsService;
    }

    getSettingsService() {
      return this.settingsService;
    }

    setEphemeralSetting(key: string, value: unknown) {
      if (value === undefined) {
        delete this.ephemeral[key];
      } else {
        this.ephemeral[key] = value;
      }
    }

    getEphemeralSetting(key: string) {
      return this.ephemeral[key];
    }

    getEphemeralSettings() {
      return { ...this.ephemeral };
    }

    getModel() {
      return this.model;
    }

    setModel(model: string) {
      this.model = model;
    }

    setProvider(provider: string) {
      this.provider = provider;
    }

    getProvider() {
      return this.provider;
    }

    setProviderManager(manager: unknown) {
      this.providerManager = manager;
    }

    getProviderManager() {
      return this.providerManager;
    }

    getContentGeneratorConfig() {
      return { authType: this.lastRefreshedAuthType };
    }

    async refreshAuth(authType: string) {
      this.lastRefreshedAuthType = authType;
    }
  }

  class StubProvider {
    name: string;
    model = 'model-a';
    baseUrl: string | undefined;
    apiKey: string | undefined;
    params: Record<string, unknown> | undefined;
    defaultModel = 'default-model';
    isPaidMode = vi.fn(() => false);

    constructor(name: string) {
      this.name = name;
    }

    getCurrentModel() {
      return this.model;
    }

    setModel(model: string) {
      this.model = model;
    }

    getDefaultModel() {
      return this.defaultModel;
    }

    getModelParams() {
      return this.params;
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
  getProviderMetrics: vi.fn(() => ({
    tokensPerMinute: 12,
    throttleWaitTimeMs: 34,
    totalTokens: 56,
    totalRequests: 2,
  })),
  getSessionTokenUsage: vi.fn(() => ({
    input: 1,
    output: 2,
    cache: 3,
    tool: 4,
    thought: 5,
    total: 15,
  })),
  getAvailableModels: vi.fn(async () => [{ id: 'model-a' }, { id: 'model-b' }]),
  setConfig: vi.fn(),
  prepareStatelessProviderInvocation: vi.fn(),
};

vi.mock('../providers/providerManagerInstance.js', () => ({
  getProviderManager: vi.fn(() => mockProviderManager),
}));

const profileStore = new Map<string, unknown>();

vi.mock('@vybestack/llxprt-code-core', () => {
  let activeContext: {
    settingsService: StubSettingsServiceInstance;
    config?: StubConfigInstance;
    runtimeId?: string;
    metadata?: Record<string, unknown>;
  } | null = null;

  return {
    SettingsService: StubSettingsServiceClass,
    Config: StubConfigClass,
    DebugLogger: class {
      debug() {}
      warn() {}
    },
    Storage: {
      getGlobalSettingsPath: () => '/tmp/llxprt-settings.json',
    },
    AuthType: {
      USE_PROVIDER: 'USE_PROVIDER',
      USE_GEMINI: 'USE_GEMINI',
      LOGIN_WITH_GOOGLE: 'LOGIN_WITH_GOOGLE',
    },
    ProfileManager: class {
      async saveProfile(name: string, profile: unknown) {
        profileStore.set(name, profile);
      }

      async loadProfile(name: string) {
        if (!profileStore.has(name)) {
          throw new Error(`Profile '${name}' not found`);
        }
        return profileStore.get(name);
      }

      async listProfiles() {
        return Array.from(profileStore.keys());
      }

      async deleteProfile(name: string) {
        if (!profileStore.delete(name)) {
          throw new Error(`Profile '${name}' not found`);
        }
      }
    },
    createProviderRuntimeContext: (
      init: {
        settingsService?: StubSettingsServiceInstance;
        config?: StubConfigInstance;
        runtimeId?: string;
        metadata?: Record<string, unknown>;
      } = {},
    ) => ({
      settingsService: init.settingsService ?? new StubSettingsServiceClass(),
      config: init.config,
      runtimeId: init.runtimeId,
      metadata: init.metadata,
    }),
    setActiveProviderRuntimeContext: (ctx: {
      settingsService: StubSettingsServiceInstance;
      config?: StubConfigInstance;
      runtimeId?: string;
      metadata?: Record<string, unknown>;
    }) => {
      activeContext = ctx;
    },
    getActiveProviderRuntimeContext: () => {
      if (!activeContext) {
        activeContext = {
          settingsService: new StubSettingsServiceClass(),
        };
      }
      return activeContext;
    },
  };
});

import {
  applyProfileSnapshot,
  buildRuntimeProfileSnapshot,
  getActiveModelName,
  getActiveProviderStatus,
  getCliRuntimeConfig,
  getCliRuntimeServices,
  getSessionTokenUsage,
  setActiveModel,
  setCliRuntimeContext,
  switchActiveProvider,
  updateActiveProviderApiKey,
  updateActiveProviderBaseUrl,
  saveProfileSnapshot,
  loadProfileByName,
  listSavedProfiles,
  deleteProfileByName,
  registerCliProviderInfrastructure,
  resetCliProviderInfrastructure,
} from './runtimeSettings.js';

describe('runtimeSettings helpers', () => {
  beforeEach(() => {
    profileStore.clear();
    Object.values(providers).forEach((provider) => {
      provider.model = 'model-a';
      provider.baseUrl = undefined;
      provider.apiKey = undefined;
      provider.params = undefined;
    });
    activeProviderName = 'openai';
    vi.clearAllMocks();

    const settingsService = new StubSettingsService();
    const config = new StubConfig(settingsService);
    setCliRuntimeContext(
      settingsService as unknown as SettingsService,
      config as unknown as Config,
    );
    registerCliProviderInfrastructure(
      mockProviderManager as unknown as ProviderManager,
      {} as unknown as OAuthManager,
    );
  });

  it('switchActiveProvider updates config and provider manager', async () => {
    const config = getCliRuntimeConfig() as unknown as StubConfigInstance;
    config.setEphemeralSetting('auth-key', 'abc');

    const result = await switchActiveProvider('anthropic');

    expect(result.nextProvider).toBe('anthropic');
    expect(config.getProvider()).toBe('anthropic');
    expect(mockProviderManager.setActiveProvider).toHaveBeenCalledWith(
      'anthropic',
    );
    expect(config.getEphemeralSetting('auth-key')).toBeUndefined();
  });

  it('switchActiveProvider resets stored model overrides when switching providers', async () => {
    providers.gemini = new StubProvider('gemini');
    activeProviderName = 'gemini';
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };

    const explicitModel = 'hf:zai-org/GLM-4.6';
    config.setModel(explicitModel);
    settingsService.setProviderSetting('openai', 'model', explicitModel);

    const result = await switchActiveProvider('openai');

    expect(result.nextProvider).toBe('openai');
    expect(config.getModel()).toBe('default-model');
    expect(settingsService.getProviderSettings('openai').model).toBe(
      'default-model',
    );
  });

  it('switchActiveProvider clears custom base URL overrides when switching providers', async () => {
    providers.gemini = new StubProvider('gemini');
    activeProviderName = 'gemini';
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };

    const customBaseUrl = 'https://api.synthetic.new/openai/v1';
    config.setEphemeralSetting('base-url', customBaseUrl);
    settingsService.setProviderSetting('openai', 'baseUrl', customBaseUrl);
    settingsService.setProviderSetting('openai', 'baseURL', customBaseUrl);

    const result = await switchActiveProvider('openai');

    expect(result.nextProvider).toBe('openai');
    expect(config.getEphemeralSetting('base-url')).toBeUndefined();
    const updatedSettings = settingsService.getProviderSettings('openai');
    expect(updatedSettings.baseUrl).toBeUndefined();
    expect(updatedSettings.baseURL).toBeUndefined();
  });

  it('switchActiveProvider preserves auth settings and global ephemerals when staying on the same provider', async () => {
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };

    config.setEphemeralSetting('auth-key', 'syn_profile_key');
    config.setEphemeralSetting('auth-keyfile', '/Users/example/.synthetic_key');
    config.setEphemeralSetting('context-limit', 200000);
    settingsService.setProviderSetting('openai', 'apiKey', 'syn_profile_key');

    const result = await switchActiveProvider('openai');

    expect(result.nextProvider).toBe('openai');
    expect(config.getEphemeralSetting('auth-key')).toBe('syn_profile_key');
    expect(config.getEphemeralSetting('auth-keyfile')).toBe(
      '/Users/example/.synthetic_key',
    );
    expect(config.getEphemeralSetting('context-limit')).toBe(200000);
    expect(settingsService.getProviderSettings('openai').apiKey).toBe(
      'syn_profile_key',
    );
  });

  it('switchActiveProvider clears previous provider ephemerals before activating a new provider', async () => {
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };

    config.setEphemeralSetting('auth-key', 'openai-secret');
    config.setEphemeralSetting('auth-keyfile', '/tmp/openai.key');
    config.setEphemeralSetting(
      'base-url',
      'https://api.synthetic.new/openai/v1',
    );
    config.setEphemeralSetting('context-limit', 160000);
    config.setModel('openai-custom-model');

    settingsService.setProviderSetting('openai', 'apiKey', 'openai-secret');
    settingsService.setProviderSetting(
      'openai',
      'baseUrl',
      'https://api.synthetic.new/openai/v1',
    );
    settingsService.setProviderSetting(
      'openai',
      'model',
      'openai-custom-model',
    );

    // Simulate stale persisted state for the target provider that should be ignored
    settingsService.setProviderSetting('anthropic', 'apiKey', 'stale-key');
    settingsService.setProviderSetting('anthropic', 'model', 'anthropic-stale');
    settingsService.setProviderSetting(
      'anthropic',
      'baseUrl',
      'https://stale.anthropic.example/v1',
    );

    providers.anthropic.defaultModel = 'anthropic-default-model';

    const result = await switchActiveProvider('anthropic');

    expect(result.nextProvider).toBe('anthropic');
    expect(config.getProvider()).toBe('anthropic');

    expect(config.getEphemeralSetting('auth-key')).toBeUndefined();
    expect(config.getEphemeralSetting('auth-keyfile')).toBeUndefined();
    expect(config.getEphemeralSetting('base-url')).toBeUndefined();
    expect(config.getEphemeralSetting('context-limit')).toBeUndefined();

    const previousProviderSettings =
      settingsService.getProviderSettings('openai');
    expect(previousProviderSettings.apiKey).toBeUndefined();
    expect(previousProviderSettings.baseUrl).toBeUndefined();
    expect(previousProviderSettings.model).toBeUndefined();

    const activeProviderSettings =
      settingsService.getProviderSettings('anthropic');
    expect(activeProviderSettings.apiKey).toBeUndefined();
    expect(activeProviderSettings.baseUrl).toBeUndefined();
    expect(activeProviderSettings.model).toBe('anthropic-default-model');
    expect(config.getModel()).toBe('anthropic-default-model');
  });

  it('setActiveModel updates provider and config', async () => {
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };
    const outcome = await setActiveModel('new-model');

    expect(outcome.nextModel).toBe('new-model');
    expect(config.getModel()).toBe('new-model');
    expect(settingsService.getProviderSettings('openai').model).toBe(
      'new-model',
    );
  });

  it('updateActiveProviderApiKey stores key and flags paid mode', async () => {
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };
    providers.openai.isPaidMode.mockReturnValue(true);

    const result = await updateActiveProviderApiKey('apikey-123');

    expect(result.providerName).toBe('openai');
    expect(settingsService.getProviderSettings('openai').apiKey).toBe(
      'apikey-123',
    );
    expect(config.getEphemeralSetting('auth-key')).toBe('apikey-123');
  });

  it('updateActiveProviderBaseUrl persists base url', async () => {
    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };
    const result = await updateActiveProviderBaseUrl('https://api.example.com');

    expect(result.baseUrl).toBe('https://api.example.com');
    expect(settingsService.getProviderSettings('openai').baseUrl).toBe(
      'https://api.example.com',
    );
    expect(config.getEphemeralSetting('base-url')).toBe(
      'https://api.example.com',
    );
  });

  it('switchActiveProvider selects first available model when provider default is missing', async () => {
    providers.qwen = new StubProvider('qwen');
    providers.qwen.defaultModel = '';
    providers.qwen.model = '';
    providers.qwen.params = undefined;

    mockProviderManager.getAvailableModels.mockImplementation(
      async (provider?: string) => {
        if (provider === 'qwen') {
          return [{ id: 'qwen-plus' }];
        }
        return [{ id: 'model-a' }, { id: 'model-b' }];
      },
    );

    const { config, settingsService } = getCliRuntimeServices() as unknown as {
      config: StubConfigInstance;
      settingsService: StubSettingsServiceInstance;
    };

    const result = await switchActiveProvider('qwen');

    expect(result.nextProvider).toBe('qwen');
    expect(result.defaultModel).toBe('qwen-plus');
    expect(config.getModel()).toBe('qwen-plus');
    expect(settingsService.getProviderSettings('qwen').model).toBe('qwen-plus');

    // Restore default mock implementation for other tests
    mockProviderManager.getAvailableModels.mockImplementation(async () => [
      { id: 'model-a' },
      { id: 'model-b' },
    ]);
    providers.qwen.defaultModel = 'default-model';
  });

  it('buildRuntimeProfileSnapshot captures model and ephemeral settings', async () => {
    const config = getCliRuntimeConfig() as unknown as StubConfigInstance;
    await setActiveModel('snapshot-model');
    config.setEphemeralSetting('custom-headers', {
      Authorization: 'Bearer 123',
    });

    const snapshot = buildRuntimeProfileSnapshot();

    expect(snapshot.provider).toBe('openai');
    expect(snapshot.model).toBe('snapshot-model');
    expect(snapshot.ephemeralSettings['custom-headers']).toEqual({
      Authorization: 'Bearer 123',
    });
  });

  it('applyProfileSnapshot switches provider and applies settings', async () => {
    const profile = buildRuntimeProfileSnapshot();
    profile.provider = 'anthropic';
    profile.model = 'anthropic-1';
    profile.ephemeralSettings['base-url'] = 'https://anthropic.example.com';

    const result = await applyProfileSnapshot(profile, {
      profileName: 'test-profile',
    });

    expect(result.providerName).toBe('anthropic');
    expect(result.warnings).toEqual([]);
    expect(activeProviderName).toBe('anthropic');
    const { settingsService } = getCliRuntimeServices() as unknown as {
      settingsService: StubSettingsServiceInstance;
    };
    expect(settingsService.getProviderSettings('anthropic').model).toBe(
      'anthropic-1',
    );
    expect(settingsService.getProviderSettings('anthropic').baseUrl).toBe(
      'https://anthropic.example.com',
    );
  });

  it('profile save/load/delete roundtrip uses profile manager', async () => {
    await saveProfileSnapshot('demo');
    expect(await listSavedProfiles()).toContain('demo');

    await loadProfileByName('demo');

    await deleteProfileByName('demo');
    expect(await listSavedProfiles()).not.toContain('demo');
  });

  it('exposes runtime status helpers', () => {
    const status = getActiveProviderStatus();
    expect(status.providerName).toBe('openai');
    expect(status.displayLabel).toBe('openai:model-a');
    expect(getActiveModelName()).toBe('model-a');
    expect(getSessionTokenUsage().total).toBe(15);
    expect(getCliRuntimeServices().providerManager).toBe(mockProviderManager);
  });

  it('registerCliProviderInfrastructure wires runtime config into provider manager', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-005
    const config = getCliRuntimeConfig();
    expect(mockProviderManager.setConfig).toHaveBeenCalledWith(
      config as unknown as Config,
    );
  });

  afterEach(() => {
    resetCliProviderInfrastructure();
  });
});
