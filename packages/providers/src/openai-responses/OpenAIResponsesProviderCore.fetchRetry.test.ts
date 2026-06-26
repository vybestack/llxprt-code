import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

const parseResponsesStreamMock = vi.hoisted(() =>
  vi.fn(async function* () {
    yield {
      role: 'assistant',
      content: [{ type: 'output_text', text: 'Hello from retry!' }],
    };
  }),
);

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('@vybestack/llxprt-code-settings', async () => ({
  ...(await vi.importActual<typeof import('@vybestack/llxprt-code-settings')>(
    '@vybestack/llxprt-code-settings',
  )),
  getSettingsService: () => mockSettingsService,
  SETTINGS_REGISTRY: [],
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../openai/parseResponsesStream.js', () => ({
  parseResponsesStream: parseResponsesStreamMock,
}));

describe('OpenAIResponsesProvider connection-phase fetch retry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should retry when fetch throws TypeError("fetch failed") on first attempt and succeed on second', async () => {
    const mockBody = new ReadableStream({
      start(controller) {
        controller.close();
      },
    });

    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        body: mockBody,
      });

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: {
          retries: 3,
          retrywait: 10,
        },
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]).toBeDefined();
  });

  it('should NOT retry when fetch throws an AbortError (user cancellation)', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ] as IContent[],
        ephemerals: {
          retries: 3,
          retrywait: 10,
        },
      }),
    );

    await expect(async () => {
      for await (const _chunk of generator) {
        // drain
      }
    }).rejects.toThrow('aborted');

    expect(fetchMock.mock.calls.length).toBe(1);
  });
});
