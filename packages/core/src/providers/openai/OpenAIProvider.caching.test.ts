import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type OpenAI from 'openai';
import { IContent } from '../../services/history/IContent.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const { mockChatCreate, mockOpenAIConstructor } = vi.hoisted(() => {
  const chatCreate = vi.fn();
  const openAIConstructorMock = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: chatCreate,
      },
    },
  }));
  return {
    mockChatCreate: chatCreate,
    mockOpenAIConstructor: openAIConstructorMock,
  };
});

let settingsServiceRef: { current: SettingsService } = {
  current: new SettingsService(),
};

vi.mock('openai', () => ({
  default: mockOpenAIConstructor,
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: vi.fn(async (fn) => fn()),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => settingsServiceRef.current,
}));

describe('OpenAIProvider cache metrics extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsServiceRef = { current: new SettingsService() };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts cached_tokens from OpenAI streaming response', async () => {
    const mockStream = {
      async *[Symbol.asyncIterator](): AsyncIterableIterator<OpenAI.Chat.Completions.ChatCompletionChunk> {
        yield {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: { content: 'Hello' },
              finish_reason: null,
            },
          ],
        };
        yield {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: 1234567890,
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            prompt_tokens_details: {
              cached_tokens: 75,
            },
          },
        };
      },
    };

    mockChatCreate.mockResolvedValueOnce(mockStream);

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'enabled');
    settingsService.setProviderSetting('openai', 'streaming', 'enabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'enabled' }),
    });
    provider.setRuntimeSettingsService(settingsService);

    const results: IContent[] = [];
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: 'openai',
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'Hello' }],
          },
        ],
        settings: settingsService,
        runtimeId: 'openai-cache-streaming',
      }),
    );

    for await (const content of generator) {
      results.push(content);
    }

    const contentWithUsage = results.find((r) => r.metadata?.usage);
    expect(contentWithUsage).toBeDefined();
    expect(contentWithUsage?.metadata?.usage?.cachedTokens).toBe(75);
    expect(contentWithUsage?.metadata?.usage?.promptTokens).toBe(100);
    expect(contentWithUsage?.metadata?.usage?.completionTokens).toBe(50);
  });

  it('extracts cached_tokens from OpenAI non-streaming response', async () => {
    const mockCompletion: OpenAI.Chat.Completions.ChatCompletion = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Hello world',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        prompt_tokens_details: {
          cached_tokens: 75,
        },
      },
    };

    mockChatCreate.mockResolvedValueOnce(mockCompletion);

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'disabled');
    settingsService.setProviderSetting('openai', 'streaming', 'disabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    });
    provider.setRuntimeSettingsService(settingsService);

    const getClientSpy = vi
      .spyOn(
        OpenAIProvider.prototype as unknown as {
          getClient: () => Promise<OpenAI>;
        },
        'getClient',
      )
      .mockResolvedValue({
        chat: { completions: { create: mockChatCreate } },
      } as unknown as OpenAI);

    const results: IContent[] = [];
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: 'openai',
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'Hello' }],
          },
        ],
        settings: settingsService,
        runtimeId: 'openai-cache-nonstreaming',
      }),
    );

    for await (const content of generator) {
      results.push(content);
    }

    const contentWithUsage = results.find((r) => r.metadata?.usage);
    expect(contentWithUsage).toBeDefined();
    expect(contentWithUsage?.metadata?.usage?.cachedTokens).toBe(75);
    expect(contentWithUsage?.metadata?.usage?.promptTokens).toBe(100);
    expect(contentWithUsage?.metadata?.usage?.completionTokens).toBe(50);

    getClientSpy.mockRestore();
  });

  it('extracts prompt_cache_hit_tokens from Deepseek response', async () => {
    const mockCompletion: OpenAI.Chat.Completions.ChatCompletion = {
      id: 'chatcmpl-deepseek-123',
      object: 'chat.completion',
      created: 1234567890,
      model: 'deepseek-chat',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Deepseek response',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        prompt_cache_hit_tokens: 150,
        prompt_cache_miss_tokens: 50,
      },
    };

    mockChatCreate.mockResolvedValueOnce(mockCompletion);

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'disabled');
    settingsService.setProviderSetting('openai', 'streaming', 'disabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    });
    provider.setRuntimeSettingsService(settingsService);

    const getClientSpy = vi
      .spyOn(
        OpenAIProvider.prototype as unknown as {
          getClient: () => Promise<OpenAI>;
        },
        'getClient',
      )
      .mockResolvedValue({
        chat: { completions: { create: mockChatCreate } },
      } as unknown as OpenAI);

    const results: IContent[] = [];
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: 'openai',
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'Hello Deepseek' }],
          },
        ],
        settings: settingsService,
        runtimeId: 'openai-cache-deepseek',
      }),
    );

    for await (const content of generator) {
      results.push(content);
    }

    const contentWithUsage = results.find((r) => r.metadata?.usage);
    expect(contentWithUsage).toBeDefined();
    expect(contentWithUsage?.metadata?.usage?.cachedTokens).toBe(150);
    expect(contentWithUsage?.metadata?.usage?.cacheMissTokens).toBe(50);
    expect(contentWithUsage?.metadata?.usage?.promptTokens).toBe(200);

    getClientSpy.mockRestore();
  });

  it('includes cache metrics in IContent metadata', async () => {
    const mockCompletion: OpenAI.Chat.Completions.ChatCompletion = {
      id: 'chatcmpl-456',
      object: 'chat.completion',
      created: 1234567890,
      model: 'gpt-4o',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: 'Response with cache data',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 500,
        completion_tokens: 200,
        total_tokens: 700,
        prompt_tokens_details: {
          cached_tokens: 400,
        },
      },
    };

    mockChatCreate.mockResolvedValueOnce(mockCompletion);

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'disabled');
    settingsService.setProviderSetting('openai', 'streaming', 'disabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({ streaming: 'disabled' }),
    });
    provider.setRuntimeSettingsService(settingsService);

    const getClientSpy = vi
      .spyOn(
        OpenAIProvider.prototype as unknown as {
          getClient: () => Promise<OpenAI>;
        },
        'getClient',
      )
      .mockResolvedValue({
        chat: { completions: { create: mockChatCreate } },
      } as unknown as OpenAI);

    const results: IContent[] = [];
    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: 'openai',
        contents: [
          {
            speaker: 'human' as const,
            blocks: [{ type: 'text' as const, text: 'Test cache metrics' }],
          },
        ],
        settings: settingsService,
        runtimeId: 'openai-cache-metadata',
      }),
    );

    for await (const content of generator) {
      results.push(content);
    }

    const contentWithUsage = results.find((r) => r.metadata?.usage);
    expect(contentWithUsage).toBeDefined();
    expect(contentWithUsage?.metadata?.usage).toMatchObject({
      promptTokens: 500,
      completionTokens: 200,
      totalTokens: 700,
      cachedTokens: 400,
      cacheCreationTokens: 0,
      cacheMissTokens: 0,
    });

    getClientSpy.mockRestore();
  });
});
