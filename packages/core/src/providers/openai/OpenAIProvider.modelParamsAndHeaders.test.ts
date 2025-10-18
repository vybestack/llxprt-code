import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type OpenAI from 'openai';
import { IContent } from '../../services/history/IContent.js';

const mockChatCreate = vi.hoisted(() => vi.fn());
const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  settings: { providers: { openai: {} } },
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
  })),
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
    mockChatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Hello!',
          },
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
    mockSettingsService.getSettings.mockResolvedValue({
      temperature: 0.6,
      top_p: 0.9,
    });

    const provider = new OpenAIProvider('test-key', undefined, {
      getEphemeralSettings: () => ({
        streaming: 'disabled',
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
});
