import { describe, expect, it, vi } from 'vitest';
import { ProviderManager } from '../ProviderManager.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { Config } from '../../config/config.js';
import type {
  GenerateChatOptions,
  IProvider,
  ProviderToolset,
} from '../IProvider.js';
import type { IContent } from '../../services/history/IContent.js';

interface RecordedOptions extends GenerateChatOptions {
  contents: IContent[];
}

vi.mock('../LoggingProviderWrapper.js', () => {
  class MockLoggingProviderWrapper implements IProvider {
    name: string;
    isDefault: boolean | undefined;
    private readonly wrapped: IProvider;

    constructor(wrapped: IProvider, _config: Config) {
      this.wrapped = wrapped;
      this.name = wrapped.name;
      this.isDefault = wrapped.isDefault;
    }

    get wrappedProvider(): IProvider {
      return this.wrapped;
    }

    async *generateChatCompletion(
      optionsOrContents: IContent[] | GenerateChatOptions,
      maybeTools?: ProviderToolset,
    ): AsyncIterableIterator<IContent> {
      const options: GenerateChatOptions = Array.isArray(optionsOrContents)
        ? { contents: optionsOrContents, tools: maybeTools }
        : optionsOrContents;
      const stream = this.wrapped.generateChatCompletion(options);
      for await (const chunk of stream) {
        yield chunk;
      }
    }

    getModels(): Promise<never[]> {
      return this.wrapped.getModels() as Promise<never[]>;
    }

    getDefaultModel(): string {
      return this.wrapped.getDefaultModel();
    }

    getCurrentModel?(): string {
      return this.wrapped.getCurrentModel?.() ?? '';
    }

    getToolFormat?(): string {
      return this.wrapped.getToolFormat?.() ?? '';
    }

    getServerTools(): string[] {
      return this.wrapped.getServerTools();
    }

    invokeServerTool(
      toolName: string,
      params: unknown,
      config?: unknown,
    ): Promise<unknown> {
      return this.wrapped.invokeServerTool(toolName, params, config);
    }

    setRuntimeSettingsService(settingsService: SettingsService): void {
      if ('setRuntimeSettingsService' in this.wrapped) {
        (
          this.wrapped as IProvider & {
            setRuntimeSettingsService?: (settings: SettingsService) => void;
          }
        ).setRuntimeSettingsService?.(settingsService);
      }
    }
  }

  return {
    LoggingProviderWrapper: MockLoggingProviderWrapper,
  };
});

class StubConfig {
  constructor(private readonly settingsService: SettingsService) {}

  getConversationLoggingEnabled(): boolean {
    return false;
  }

  getSettingsService(): SettingsService {
    return this.settingsService;
  }
}

class StubProvider implements IProvider {
  name: string;
  isDefault = true;
  lastOptions: RecordedOptions | undefined;
  receivedSettingsService: SettingsService | undefined;

  constructor(name: string) {
    this.name = name;
  }

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-default-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(): Promise<unknown> {
    return undefined;
  }

  setRuntimeSettingsService(settingsService: SettingsService): void {
    this.receivedSettingsService = settingsService;
  }

  generateChatCompletion(
    optionsOrContents: GenerateChatOptions | IContent[],
    maybeTools?: ProviderToolset,
  ): AsyncIterableIterator<IContent> {
    const options = Array.isArray(optionsOrContents)
      ? ({ contents: optionsOrContents, tools: maybeTools } as RecordedOptions)
      : (optionsOrContents as RecordedOptions);
    this.lastOptions = options;
    return (async function* () {})();
  }
}

const prompt: IContent = {
  speaker: 'human',
  blocks: [],
};

describe('ProviderManager runtime guard plumbing', () => {
  it('passes runtime settings to wrapped providers before invocation', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-004
    const settingsService = new SettingsService();
    const config = new StubConfig(settingsService) as unknown as Config;
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: {
        settingsService,
        config,
        runtimeId: 'guard-runtime',
      },
    });
    const provider = new StubProvider('stub-provider');
    manager.registerProvider(provider);

    const iterator = manager
      .getActiveProvider()
      .generateChatCompletion({ contents: [prompt] });

    await iterator.next();
    expect(provider.lastOptions?.settings).toBe(settingsService);
  });

  it('passes runtime config to wrapped providers before invocation', async () => {
    // @plan:PLAN-20251023-STATELESS-HARDENING.P04 @requirement:REQ-SP4-004
    const settingsService = new SettingsService();
    const config = new StubConfig(settingsService) as unknown as Config;
    const manager = new ProviderManager({
      settingsService,
      config,
      runtime: {
        settingsService,
        config,
        runtimeId: 'guard-runtime',
      },
    });
    const provider = new StubProvider('config-provider');
    manager.registerProvider(provider);

    const iterator = manager
      .getActiveProvider()
      .generateChatCompletion({ contents: [prompt] });

    await iterator.next();
    expect(provider.lastOptions?.config).toBe(config);
  });
});
