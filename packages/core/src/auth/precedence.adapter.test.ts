import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { BaseProvider, BaseProviderConfig } from '../providers/BaseProvider.js';
import type { IProviderConfig } from '../providers/types/IProviderConfig.js';
import type { SettingsService } from '../settings/SettingsService.js';
import { SettingsService as SettingsServiceImpl } from '../settings/SettingsService.js';
import {
  createProviderRuntimeContext,
  getActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '../runtime/providerRuntimeContext.js';
import type {
  GenerateChatOptions,
  ProviderToolset,
} from '../providers/IProvider.js';
import type { Config } from '../config/config.js';

class TestProvider extends BaseProvider {
  constructor(
    config: BaseProviderConfig,
    providerConfig?: IProviderConfig,
    globalConfig?: Config,
    settingsService?: SettingsService,
  ) {
    super(config, providerConfig, globalConfig, settingsService);
  }

  supportsOAuth(): boolean {
    return false;
  }

  async getModels() {
    return [];
  }

  async *generateChatCompletion(_: GenerateChatOptions) {
    yield { speaker: 'ai' as const, blocks: [] };
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(): Promise<unknown> {
    return {};
  }

  getDefaultModel(): string {
    return 'test-model';
  }

  setProviderTools(_: ProviderToolset): void {}
}

describe('BaseProvider auth precedence adapter', () => {
  let originalContext: ReturnType<
    typeof getActiveProviderRuntimeContext
  > | null;

  beforeEach(() => {
    try {
      originalContext = getActiveProviderRuntimeContext();
    } catch {
      originalContext = null;
    }
  });

  afterEach(() => {
    if (originalContext) {
      setActiveProviderRuntimeContext(originalContext);
    }
  });

  it('updates AuthPrecedenceResolver when runtime SettingsService overrides apply', async () => {
    const baseService = new SettingsServiceImpl();
    baseService.set('auth-key', 'base-key');
    const runtimeContext = createProviderRuntimeContext({
      settingsService: baseService,
    });
    setActiveProviderRuntimeContext(runtimeContext);

    const provider = new TestProvider(
      { name: 'test-provider' },
      undefined,
      undefined,
      baseService,
    );
    const initialAuth = await provider['authResolver'].resolveAuthentication();
    expect(initialAuth).toBe('base-key');

    const overrideService = new SettingsServiceImpl();
    overrideService.set('auth-key', 'override-key');
    provider.setRuntimeSettingsService(overrideService);

    const nextAuth = await provider['authResolver'].resolveAuthentication();
    expect(nextAuth).toBe('override-key');
  });
});
