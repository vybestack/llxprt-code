import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type OpenAI from 'openai';
import { IContent } from '../../services/history/IContent.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const { mockChatCreate, mockOpenAIConstructor } = vi.hoisted(() => {
  const chatCreate = vi.fn();
  const constructor = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: chatCreate,
      },
    },
  }));
  return { mockChatCreate: chatCreate, mockOpenAIConstructor: constructor };
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

// REQ-RETRY-001: retryWithBackoff removed from providers
vi.mock('../../utils/retry.js', () => ({
  isNetworkTransientError: vi.fn(() => false),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => settingsServiceRef.current,
}));

const createBasicMessages = (): IContent[] => [
  {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Hello' }],
  },
];

describe('OpenAIProvider model params and custom headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsServiceRef = { current: new SettingsService() };
    mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 1,
        completion_tokens: 1,
        total_tokens: 2,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include model parameters from settings in the OpenAI request body', async () => {
    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'disabled');
    settingsService.set('temperature', 0.6);
    settingsService.set('top_p', 0.9);
    settingsService.setProviderSetting('openai', 'temperature', 0.6);
    settingsService.setProviderSetting('openai', 'top_p', 0.9);
    settingsService.setProviderSetting('openai', 'streaming', 'disabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({
        streaming: 'disabled',
        temperature: 0.6,
        top_p: 0.9,
      }),
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

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: createBasicMessages(),
        settings: settingsService,
        runtimeId: 'openai-model-params',
      }),
    );
    await generator.next();

    const requestBody = mockChatCreate.mock.calls[0]?.[0];
    expect(requestBody).toMatchObject({
      temperature: 0.6,
      top_p: 0.9,
    });

    getClientSpy.mockRestore();
  });

  it('should pass custom headers when generating chat completions', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      'X-Trace-Id': '12345',
    };

    mockChatCreate.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'stream-chunk',
                role: 'assistant',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        };
      },
    });

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'enabled');
    settingsService.set('custom-headers', customHeaders);
    settingsService.setProviderSetting(
      'openai',
      'custom-headers',
      customHeaders,
    );
    settingsService.setProviderSetting('openai', 'streaming', 'enabled');

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({
        streaming: 'enabled',
        'custom-headers': customHeaders,
      }),
      customHeaders: {
        'X-Provider-Header': 'provider-value',
      },
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

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: createBasicMessages(),
        settings: settingsService,
        runtimeId: 'openai-custom-headers',
      }),
    );
    await generator.next();

    const call = mockChatCreate.mock.calls[0];
    expect(call).toBeDefined();

    const options = call?.[1];
    expect(options).toBeDefined();
    expect(options?.headers).toMatchObject({
      ...customHeaders,
      'X-Provider-Header': 'provider-value',
    });

    getClientSpy.mockRestore();
  });

  it('should configure socket-aware transport when socket settings are present', async () => {
    vi.clearAllMocks();
    settingsServiceRef.current = new SettingsService();
    mockOpenAIConstructor.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockChatCreate,
        },
      },
    }));

    mockChatCreate.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
                content: 'socket-chunk',
                role: 'assistant',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        };
      },
    });

    const settingsService = settingsServiceRef.current;
    settingsService.set('activeProvider', 'openai');
    settingsService.set('streaming', 'enabled');
    settingsService.set('socket-timeout', 120000);
    settingsService.set('socket-keepalive', true);
    settingsService.set('socket-nodelay', true);
    settingsService.setProviderSetting('openai', 'socket-timeout', 120000);
    settingsService.setProviderSetting('openai', 'socket-keepalive', true);
    settingsService.setProviderSetting('openai', 'socket-nodelay', true);
    settingsService.setProviderSetting('openai', 'streaming', 'enabled');

    const provider = new OpenAIProvider(
      'test-key',
      'http://localhost:1234/v1/',
      {
        getEphemeralSettings: () => ({
          streaming: 'enabled',
          'socket-timeout': 120000,
          'socket-keepalive': true,
          'socket-nodelay': true,
        }),
      },
    );

    provider.setRuntimeSettingsService(settingsService);

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: createBasicMessages(),
        settings: settingsService,
        runtimeId: 'openai-socket-settings',
      }),
    );
    await generator.next();

    const constructorCalls = mockOpenAIConstructor.mock.calls;
    expect(constructorCalls.length).toBeGreaterThan(0);

    const constructorArgs = constructorCalls.at(-1)?.[0] as Record<
      string,
      unknown
    >;

    expect(constructorArgs).toBeDefined();
    expect(constructorArgs.httpAgent).toBeDefined();
    expect(constructorArgs.httpsAgent).toBeDefined();
  });
});
