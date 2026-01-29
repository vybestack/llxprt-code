/**
 * @plan PLAN-20251023-STATELESS-HARDENING.P07
 * @requirement REQ-SP4-004
 */
import { describe, expect, it } from 'vitest';
import { LoggingProviderWrapper } from '../LoggingProviderWrapper.js';
import type { GenerateChatOptions, IContent, IProvider } from '../IProvider.js';
import type { Config } from '../../config/config.js';
import { SettingsService } from '../../settings/SettingsService.js';
import type { ProviderRuntimeContext } from '../../runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

class StubProvider implements IProvider {
  name = 'stub-provider';

  async getModels(): Promise<never[]> {
    return [];
  }

  getDefaultModel(): string {
    return 'stub-model';
  }

  getServerTools(): string[] {
    return [];
  }

  async invokeServerTool(
    _toolName: string,
    _params: unknown,
    _config?: unknown,
  ): Promise<unknown> {
    return {};
  }

  async *generateChatCompletion(
    options: GenerateChatOptions,
  ): AsyncIterableIterator<IContent> {
    void options;
    yield {
      speaker: 'ai',
      blocks: [],
    } as IContent;
  }
}

class StubRedactor {
  redactMessage(content: IContent): IContent {
    return content;
  }

  redactToolCall(tool: unknown): unknown {
    return tool;
  }

  redactResponseContent(content: string): string {
    return content;
  }
}

const createConfigStub = (label: string): Config =>
  ({
    getConversationLoggingEnabled: () => false,
    getConversationLogPath: () => `/tmp/${label}`,
    getRedactionConfig: () => ({
      redactApiKeys: false,
      redactCredentials: false,
      redactFilePaths: false,
      redactUrls: false,
      redactEmails: false,
      redactPersonalInfo: false,
    }),
  }) as unknown as Config;

const createRuntimeWithoutConfig = (
  settings: SettingsService,
): ProviderRuntimeContext =>
  ({
    runtimeId: 'stateless-runtime',
    settingsService: settings,
    config: undefined,
    metadata: { source: 'LoggingProviderWrapper.stateless.test' },
  }) as ProviderRuntimeContext;

describe('LoggingProviderWrapper stateless hardening integration', () => {
  it('rejects generateChatCompletion when runtime config is absent @plan:PLAN-20251023-STATELESS-HARDENING.P07 @requirement:REQ-SP4-004 @pseudocode logging-wrapper-adjustments.md line 10', async () => {
    const provider = new StubProvider();
    const wrapper = new LoggingProviderWrapper(
      provider,
      createConfigStub('constructor'),
      new StubRedactor(),
    );

    const settings = new SettingsService();
    const runtime = createRuntimeWithoutConfig(settings);

    const iterator = wrapper.generateChatCompletion({
      contents: [],
      settings,
      runtime,
    });

    await expect(iterator.next()).rejects.toMatchObject({
      requirement: 'REQ-SP4-004',
      name: 'MissingProviderRuntimeError',
    });
  });

  it('rejects generateChatCompletion when runtime settings is absent @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
    const provider = new StubProvider();
    const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

    const config = createConfigStub('test');
    const runtime: ProviderRuntimeContext = {
      runtimeId: 'missing-settings-runtime',
      settingsService: undefined as unknown as SettingsService,
      config,
      metadata: { source: 'test' },
    };

    const iterator = wrapper.generateChatCompletion({
      contents: [],
      config,
      runtime,
    });

    await expect(iterator.next()).rejects.toMatchObject({
      requirement: 'REQ-SP4-004',
      name: 'MissingProviderRuntimeError',
    });
  });

  it('accepts generateChatCompletion with complete runtime context @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-004', async () => {
    const provider = new StubProvider();
    const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

    const settings = new SettingsService();
    const config = createConfigStub('complete-runtime');
    const runtime: ProviderRuntimeContext = {
      runtimeId: 'complete-runtime',
      settingsService: settings,
      config,
      metadata: { source: 'test' },
    };

    const iterator = wrapper.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [],
        settings,
        config,
        runtime,
      }),
    );

    // Should not throw - successfully iterate
    const result = await iterator.next();
    expect(result.done).toBe(false);
  });

  it('merges runtime metadata correctly @plan:PLAN-20251023-STATELESS-HARDENING.P08 @requirement:REQ-SP4-005', async () => {
    const provider = new StubProvider();
    const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

    const settings = new SettingsService();
    const config = createConfigStub('metadata-test');

    // Set up runtime context resolver
    wrapper.setRuntimeContextResolver(() => ({
      runtimeId: 'injected-runtime',
      settingsService: settings,
      config,
      metadata: { injected: true, source: 'resolver' },
    }));

    const runtime: ProviderRuntimeContext = {
      runtimeId: 'provided-runtime',
      settingsService: settings,
      config,
      metadata: { provided: true, source: 'caller' },
    };

    const iterator = wrapper.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [],
        settings,
        config,
        runtime,
        metadata: { explicit: true },
      }),
    );

    // Should not throw and merge metadata
    const result = await iterator.next();
    expect(result.done).toBe(false);
  });

  describe('extractTokenCountsFromTokenUsage', () => {
    it('extracts cachedTokens from new provider-agnostic field', () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const result = (
        wrapper as unknown as {
          extractTokenCountsFromTokenUsage: (usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cachedTokens?: number;
            cacheCreationTokens?: number;
          }) => {
            input_token_count: number;
            output_token_count: number;
            cached_content_token_count: number;
            thoughts_token_count: number;
            tool_token_count: number;
            cache_read_input_tokens: number;
            cache_creation_input_tokens: number;
          };
        }
      ).extractTokenCountsFromTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 25,
        cacheCreationTokens: 10,
      });

      expect(result.cache_read_input_tokens).toBe(25);
      expect(result.cache_creation_input_tokens).toBe(10);
    });

    it('falls back to Anthropic field names', () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const result = (
        wrapper as unknown as {
          extractTokenCountsFromTokenUsage: (usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          }) => {
            input_token_count: number;
            output_token_count: number;
            cached_content_token_count: number;
            thoughts_token_count: number;
            tool_token_count: number;
            cache_read_input_tokens: number;
            cache_creation_input_tokens: number;
          };
        }
      ).extractTokenCountsFromTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 15,
      });

      expect(result.cache_read_input_tokens).toBe(30);
      expect(result.cache_creation_input_tokens).toBe(15);
    });

    it('prefers new field names over legacy when both present', () => {
      const provider = new StubProvider();
      const wrapper = new LoggingProviderWrapper(provider, new StubRedactor());

      const result = (
        wrapper as unknown as {
          extractTokenCountsFromTokenUsage: (usage: {
            promptTokens: number;
            completionTokens: number;
            totalTokens: number;
            cachedTokens?: number;
            cacheCreationTokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          }) => {
            input_token_count: number;
            output_token_count: number;
            cached_content_token_count: number;
            thoughts_token_count: number;
            tool_token_count: number;
            cache_read_input_tokens: number;
            cache_creation_input_tokens: number;
          };
        }
      ).extractTokenCountsFromTokenUsage({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        cachedTokens: 40,
        cacheCreationTokens: 20,
        cache_read_input_tokens: 30,
        cache_creation_input_tokens: 15,
      });

      expect(result.cache_read_input_tokens).toBe(40);
      expect(result.cache_creation_input_tokens).toBe(20);
    });
  });
});
