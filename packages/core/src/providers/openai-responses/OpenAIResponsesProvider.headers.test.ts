import { describe, it, beforeEach, afterEach, expect, vi } from 'vitest';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

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
    // No streamed messages for these assertions
  }),
);

const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

vi.mock('../openai/parseResponsesStream.js', () => ({
  parseResponsesStream: parseResponsesStreamMock,
}));

describe('OpenAIResponsesProvider custom headers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue({
      ok: true,
      body: undefined,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('should merge custom headers from config and ephemeral settings into fetch request', async () => {
    const customHeaders = {
      'X-Custom-Header': 'custom-value',
      'X-Trace-Id': 'trace-xyz',
    };

    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      customHeaders: {
        'X-Provider-Header': 'provider-value',
      },
      getEphemeralSettings: () => ({
        'custom-headers': customHeaders,
      }),
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
        settingsOverrides: {
          global: { 'custom-headers': customHeaders },
          provider: { 'custom-headers': customHeaders },
        },
      }),
    );

    await generator.next();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();

    const [, options] = call;
    expect(options).toBeDefined();
    expect(options?.headers).toMatchObject({
      Authorization: 'Bearer test-key',
      'Content-Type': 'application/json; charset=utf-8',
      ...customHeaders,
      'X-Provider-Header': 'provider-value',
    });
  });
});
