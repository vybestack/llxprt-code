import { afterEach, describe, expect, it } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { Config } from '../../config/config.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import { BaseProvider } from '../BaseProvider.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../../runtime/providerRuntimeContext.js';

class HarnessProvider extends BaseProvider {
  lastNormalizedOptions?: NormalizedGenerateChatOptions;

  constructor(config: Config, settingsService: SettingsService) {
    super({ name: 'stub-provider' }, undefined, config, settingsService);
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-default-model';
  }

  protected supportsOAuth(): boolean {
    return false;
  }

  protected generateChatCompletionWithOptions(
    options: NormalizedGenerateChatOptions,
  ): AsyncIterableIterator<never> {
    this.lastNormalizedOptions = options;
    return (async function* () {})();
  }
}

class NamedHarnessProvider extends BaseProvider {
  constructor(name: string, config: Config, settingsService: SettingsService) {
    super({ name }, undefined, config, settingsService);
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return `${this.name}-default-model`;
  }

  protected supportsOAuth(): boolean {
    return true;
  }

  protected generateChatCompletionWithOptions(): AsyncIterableIterator<never> {
    return (async function* () {})();
  }
}

const prompt = {
  speaker: 'human' as const,
  blocks: [] as unknown[],
};

async function collect(
  iterator: AsyncIterableIterator<unknown>,
): Promise<void> {
  for await (const _chunk of iterator) {
    // consume iterator
  }
}

describe('ProviderManager runtime guard plumbing', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('injects runtime settings into BaseProvider before invocation', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-004
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const runtimeContext = {
      settingsService,
      config,
      runtimeId: 'guard-runtime',
    };
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: runtimeContext,
    });
    setActiveProviderRuntimeContext(runtimeContext);
    const provider = new HarnessProvider(config, settingsService);
    manager.registerProvider(provider);
    settingsService.set('activeProvider', provider.name);
    settingsService.setProviderSetting(provider.name, 'model', 'stub-model');
    settingsService.setProviderSetting(provider.name, 'apiKey', 'stub-key');
    settingsService.setProviderSetting(
      provider.name,
      'baseURL',
      'https://stub.example.com',
    );
    manager.setActiveProvider(provider.name);

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config,
          runtime: runtimeContext,
        }),
      ),
    );

    expect(provider.lastNormalizedOptions?.settings).toBe(settingsService);
    expect(provider.lastNormalizedOptions?.invocation).toBeDefined();
    expect(provider.lastNormalizedOptions?.invocation.settings).toBe(
      settingsService,
    );
  });

  it('injects runtime config into BaseProvider before invocation', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-004
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const runtimeContext = {
      settingsService,
      config,
      runtimeId: 'guard-runtime',
    };
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: runtimeContext,
    });
    setActiveProviderRuntimeContext(runtimeContext);
    const provider = new HarnessProvider(config, settingsService);
    manager.registerProvider(provider);
    settingsService.set('activeProvider', provider.name);
    settingsService.setProviderSetting(provider.name, 'model', 'stub-model');
    settingsService.setProviderSetting(provider.name, 'apiKey', 'stub-key');
    settingsService.setProviderSetting(
      provider.name,
      'baseURL',
      'https://stub.example.com',
    );
    manager.setActiveProvider(provider.name);

    await collect(
      manager.getActiveProvider().generateChatCompletion(
        createProviderCallOptions({
          providerName: provider.name,
          contents: [prompt],
          settings: settingsService,
          config,
          runtime: runtimeContext,
        }),
      ),
    );

    expect(provider.lastNormalizedOptions?.config).toBe(config);
    expect(provider.lastNormalizedOptions?.invocation).toBeDefined();
    expect(typeof provider.lastNormalizedOptions?.invocation.runtimeId).toBe(
      'string',
    );
  });

  it('captures provider-scoped ephemerals in the invocation snapshot', () => {
    const settingsService = new SettingsService();
    settingsService.set('streaming', 'enabled');
    settingsService.setProviderSetting('openai', 'temperature', 0.5);
    settingsService.setProviderSetting('openai', 'apiKey', 'test-key');
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-with-ephemerals',
          settingsService,
          config,
        },
      },
      'openai',
    );

    expect(normalized.invocation.ephemerals.streaming).toBe('enabled');
    expect(normalized.invocation.ephemerals.openai).toMatchObject({
      temperature: 0.5,
    });
  });
});

describe('ProviderManager.normalizeRuntimeInputs', () => {
  it('throws ProviderRuntimeNormalizationError when settings is missing @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    expect(() =>
      manager.normalizeRuntimeInputs({
        contents: [prompt],
        runtime: {
          runtimeId: 'test-runtime',
          settingsService: undefined as unknown as SettingsService,
          config,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        requirement: 'REQ-SP4-002',
        name: 'ProviderRuntimeNormalizationError',
      }),
    );
  });

  it('throws ProviderRuntimeNormalizationError when config is missing @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    expect(() =>
      manager.normalizeRuntimeInputs({
        contents: [prompt],
        runtime: {
          runtimeId: 'test-runtime',
          settingsService,
          config: undefined as unknown as Config,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        requirement: 'REQ-SP4-002',
        name: 'ProviderRuntimeNormalizationError',
      }),
    );
  });

  it('throws ProviderRuntimeNormalizationError when resolved fields are incomplete @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    // Set up a provider with no model configured
    settingsService.set('activeProvider', 'openai');

    expect(() =>
      manager.normalizeRuntimeInputs(
        {
          contents: [prompt],
          settings: settingsService,
          config,
          runtime: {
            runtimeId: 'test-runtime',
            settingsService,
            config,
          },
        },
        'openai',
      ),
    ).toThrow(
      expect.objectContaining({
        requirement: 'REQ-SP4-003',
        name: 'ProviderRuntimeNormalizationError',
      }),
    );
  });

  it('successfully normalizes options with complete runtime context @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    settingsService.set('activeProvider', 'stub-provider');
    settingsService.setProviderSetting('stub-provider', 'model', 'test-model');
    settingsService.setProviderSetting('stub-provider', 'apiKey', 'test-key');
    settingsService.setProviderSetting(
      'stub-provider',
      'baseURL',
      'https://api.test.com',
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'test-runtime',
          settingsService,
          config,
          metadata: { source: 'test' },
        },
      },
      'stub-provider',
    );

    expect(normalized.settings).toBe(settingsService);
    expect(normalized.config).toBe(config);
    expect(normalized.resolved?.model).toBe('test-model');
    expect(normalized.resolved?.authToken).toBe('test-key');
    expect(normalized.resolved?.baseURL).toBe('https://api.test.com');
    expect(normalized.metadata?._normalized).toBe(true);
  });

  it('uses config base-url fallback when provider settings omit baseURL', () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService, {
      getEphemeralSetting: (key: string) =>
        key === 'base-url' ? 'https://config-fallback.example.com' : undefined,
    }) as Config;
    const manager = new ProviderManager({ settingsService, config });

    settingsService.set('activeProvider', 'stub-provider');
    settingsService.setProviderSetting('stub-provider', 'model', 'test-model');
    settingsService.setProviderSetting('stub-provider', 'apiKey', 'test-key');

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-config-baseurl',
          settingsService,
          config,
        },
      },
      'stub-provider',
    );

    expect(normalized.resolved?.baseURL).toBe(
      'https://config-fallback.example.com',
    );
  });

  it('does not leak config base-url when runtime settings service differs', () => {
    const foregroundSettings = new SettingsService();
    const subagentSettings = new SettingsService();
    subagentSettings.set('activeProvider', 'anthropic');
    subagentSettings.setProviderSetting('anthropic', 'model', 'claude-test');

    const config = createRuntimeConfigStub(foregroundSettings, {
      getSettingsService: () => foregroundSettings,
      getEphemeralSetting: (key: string) =>
        key === 'base-url'
          ? 'https://leaked-foreground.example.com/openai/v1'
          : undefined,
    }) as Config;

    const manager = new ProviderManager({
      settingsService: subagentSettings,
      config,
    });

    manager.registerProvider(
      new NamedHarnessProvider('anthropic', config, subagentSettings),
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: subagentSettings,
        config,
        runtime: {
          runtimeId: 'runtime-mismatched-settings',
          settingsService: subagentSettings,
          config,
        },
      },
      'anthropic',
    );

    expect(normalized.resolved?.baseURL).toBeUndefined();
  });

  it('does not leak config auth-key when runtime settings service differs', () => {
    const foregroundSettings = new SettingsService();
    const subagentSettings = new SettingsService();
    subagentSettings.set('activeProvider', 'anthropic');
    subagentSettings.setProviderSetting('anthropic', 'model', 'claude-test');

    const config = createRuntimeConfigStub(foregroundSettings, {
      getSettingsService: () => foregroundSettings,
      getEphemeralSetting: (key: string) =>
        key === 'auth-key' ? 'leaked-foreground-key' : undefined,
    }) as Config;

    const manager = new ProviderManager({
      settingsService: subagentSettings,
      config,
    });

    manager.registerProvider(
      new NamedHarnessProvider('anthropic', config, subagentSettings),
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: subagentSettings,
        config,
        runtime: {
          runtimeId: 'runtime-mismatched-settings',
          settingsService: subagentSettings,
          config,
        },
      },
      'anthropic',
    );

    expect(normalized.resolved?.authToken).toBeUndefined();
  });

  it('does not apply active provider base-url to other providers', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.setProviderSetting('anthropic', 'model', 'claude-test');

    const config = createRuntimeConfigStub(settingsService, {
      getEphemeralSetting: (key: string) =>
        key === 'base-url' ? 'https://openai.example.com/openai/v1' : undefined,
    }) as Config;

    const manager = new ProviderManager({ settingsService, config });
    manager.registerProvider(
      new NamedHarnessProvider('anthropic', config, settingsService),
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-cross-provider-baseurl',
          settingsService,
          config,
        },
      },
      'anthropic',
    );

    expect(normalized.resolved?.baseURL).toBeUndefined();
  });

  it('does not apply active provider auth-key to other providers', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.setProviderSetting('anthropic', 'model', 'claude-test');

    const config = createRuntimeConfigStub(settingsService, {
      getEphemeralSetting: (key: string) =>
        key === 'auth-key' ? 'leaked-foreground-key' : undefined,
    }) as Config;

    const manager = new ProviderManager({ settingsService, config });
    manager.registerProvider(
      new NamedHarnessProvider('anthropic', config, settingsService),
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-cross-provider-authkey',
          settingsService,
          config,
        },
      },
      'anthropic',
    );

    expect(normalized.resolved?.authToken).toBeUndefined();
  });

  it('prefers provider-scoped model over config.getModel when invoking another provider', () => {
    const settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openai');
    settingsService.setProviderSetting('anthropic', 'model', 'claude-test');

    const config = createRuntimeConfigStub(settingsService, {
      getModel: () => 'foreground-model',
    }) as Config;

    const manager = new ProviderManager({ settingsService, config });
    manager.registerProvider(
      new NamedHarnessProvider('anthropic', config, settingsService),
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-model-precedence',
          settingsService,
          config,
        },
      },
      'anthropic',
    );

    expect(normalized.resolved?.model).toBe('claude-test');
  });

  it('derives base-url from provider configuration when settings and config lack it', () => {
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    const provider = new HarnessProvider(config, settingsService);
    const providerConfigRef = provider as unknown as {
      baseProviderConfig?: { baseURL?: string };
    };
    if (providerConfigRef.baseProviderConfig) {
      providerConfigRef.baseProviderConfig.baseURL =
        'https://provider-config.example.com';
    }
    manager.registerProvider(provider);

    settingsService.set('activeProvider', provider.name);
    settingsService.setProviderSetting(provider.name, 'model', 'test-model');
    settingsService.setProviderSetting(provider.name, 'apiKey', 'test-key');

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'runtime-provider-baseurl',
          settingsService,
          config,
        },
      },
      provider.name,
    );

    expect(normalized.resolved?.baseURL).toBe(
      'https://provider-config.example.com',
    );
  });

  it('merges metadata from runtime context @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-005', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-005
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    settingsService.set('activeProvider', 'stub-provider');
    settingsService.setProviderSetting('stub-provider', 'model', 'test-model');
    settingsService.setProviderSetting('stub-provider', 'apiKey', 'test-key');
    settingsService.setProviderSetting(
      'stub-provider',
      'baseURL',
      'https://api.test.com',
    );

    const normalized = manager.normalizeRuntimeInputs(
      {
        contents: [prompt],
        settings: settingsService,
        config,
        runtime: {
          runtimeId: 'test-runtime',
          settingsService,
          config,
          metadata: { runtimeSource: 'test', injected: true },
        },
        metadata: { explicitField: 'value' },
      },
      'stub-provider',
    );

    expect(normalized.metadata?.runtimeSource).toBe('test');
    expect(normalized.metadata?.injected).toBe(true);
    expect(normalized.metadata?.explicitField).toBe('value');
    expect(normalized.metadata?._normalized).toBe(true);
    expect(normalized.metadata?._runtimeId).toBe('test-runtime');
  });
});
