import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type OpenAI from 'openai';
import { IContent } from '../../services/history/IContent.js';

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
const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  settings: { providers: { openai: {} } },
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}));

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
  getSettingsService: () => mockSettingsService,
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
    mockSettingsService.getSettings.mockResolvedValue({});
    mockChatCreate.mockReturnValue({
      async *[Symbol.asyncIterator]() {
        yield {
          choices: [
            {
              delta: {
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
        };
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should include model parameters from settings in the OpenAI request body', async () => {
    mockSettingsService.get.mockImplementation((key: string) => {
      if (key === 'temperature') return 0.6;
      if (key === 'top_p') return 0.9;
      return undefined;
    });
    mockSettingsService.getSettings.mockResolvedValue({
      temperature: 0.6,
      top_p: 0.9,
    });
    mockSettingsService.getProviderSettings.mockReturnValue({
      temperature: 0.6,
      top_p: 0.9,
    });

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({
        streaming: 'disabled',
        temperature: 0.6,
        top_p: 0.9,
      }),
    });

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

    const generator = provider.generateChatCompletion(createBasicMessages());
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

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({
        streaming: 'disabled',
        'custom-headers': customHeaders,
      }),
      customHeaders: {
        'X-Provider-Header': 'provider-value',
      },
    });

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

    const generator = provider.generateChatCompletion(createBasicMessages());
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
    mockOpenAIConstructor.mockImplementation(() => ({
      chat: {
        completions: {
          create: mockChatCreate,
        },
      },
    }));

    const provider = new OpenAIProvider(
      'test-key',
      'http://localhost:1234/v1/',
      {
        getEphemeralSettings: () => ({
          streaming: 'disabled',
          'socket-timeout': 120000,
          'socket-keepalive': true,
          'socket-nodelay': true,
        }),
      },
    );

    const generator = provider.generateChatCompletion(createBasicMessages());
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
