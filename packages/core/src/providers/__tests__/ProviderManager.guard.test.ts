import { afterEach, describe, expect, it } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { Config } from '../../config/config.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
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
      manager
        .getActiveProvider()
        .generateChatCompletion({ contents: [prompt] }),
    );

    expect(provider.lastNormalizedOptions?.settings).toBe(settingsService);
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
      manager
        .getActiveProvider()
        .generateChatCompletion({ contents: [prompt] }),
    );

    expect(provider.lastNormalizedOptions?.config).toBe(config);
  });
});

describe('ProviderManager.normalizeRuntimeInputs', () => {
  it('throws ProviderRuntimeNormalizationError when settings is missing @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    try {
      manager.normalizeRuntimeInputs({
        contents: [prompt],
        runtime: {
          runtimeId: 'test-runtime',
          settingsService: undefined as unknown as SettingsService,
          config,
        },
      });
      throw new Error('Expected error to be thrown');
    } catch (error) {
      expect(error).toHaveProperty('requirement', 'REQ-SP4-002');
      expect(error).toHaveProperty('name', 'ProviderRuntimeNormalizationError');
    }
  });

  it('throws ProviderRuntimeNormalizationError when config is missing @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-002
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    try {
      manager.normalizeRuntimeInputs({
        contents: [prompt],
        runtime: {
          runtimeId: 'test-runtime',
          settingsService,
          config: undefined as unknown as Config,
        },
      });
      throw new Error('Expected error to be thrown');
    } catch (error) {
      expect(error).toHaveProperty('requirement', 'REQ-SP4-002');
      expect(error).toHaveProperty('name', 'ProviderRuntimeNormalizationError');
    }
  });

  it('throws ProviderRuntimeNormalizationError when resolved fields are incomplete @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003', () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-003
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({ settingsService, config });

    // Set up a provider with no model configured
    settingsService.set('activeProvider', 'openai');

    try {
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
      );
      throw new Error('Expected error to be thrown');
    } catch (error) {
      expect(error).toHaveProperty('requirement', 'REQ-SP4-003');
      expect(error).toHaveProperty('name', 'ProviderRuntimeNormalizationError');
    }
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
