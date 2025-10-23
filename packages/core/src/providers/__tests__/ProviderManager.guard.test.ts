import { describe, expect, it } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { Config } from '../../config/config.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';
import { BaseProvider } from '../BaseProvider.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

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
  it('injects runtime settings into BaseProvider before invocation', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-004
    const settingsService = new SettingsService();
    const config = createRuntimeConfigStub(settingsService) as Config;
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: {
        settingsService,
        config,
        runtimeId: 'guard-runtime',
      },
    });
    const provider = new HarnessProvider(config, settingsService);
    manager.registerProvider(provider);
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
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: {
        settingsService,
        config,
        runtimeId: 'guard-runtime',
      },
    });
    const provider = new HarnessProvider(config, settingsService);
    manager.registerProvider(provider);
    manager.setActiveProvider(provider.name);

    await collect(
      manager
        .getActiveProvider()
        .generateChatCompletion({ contents: [prompt] }),
    );

    expect(provider.lastNormalizedOptions?.config).toBe(config);
  });
});
