/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { type IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

const retryWithBackoffMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/retry.js', () => ({
  retryWithBackoff: retryWithBackoffMock,
  getErrorStatus: vi.fn((error: unknown) => {
    if (error && typeof error === 'object' && 'status' in error) {
      return (error as { status: number }).status;
    }
    return undefined;
  }),
  isNetworkTransientError: vi.fn((error: unknown) =>
    Boolean(
      error &&
      typeof error === 'object' &&
      'message' in error &&
      String((error as { message?: unknown }).message).includes('terminated'),
    ),
  ),
}));

const mockSettingsService = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
}));

vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: () => mockSettingsService,
}));

vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

const parseResponsesStreamMock = vi.hoisted(() => vi.fn());

vi.mock('../openai/parseResponsesStream.js', () => ({
  parseResponsesStream: parseResponsesStreamMock,
  parseErrorResponse: vi.fn((_status: number, body: string) => new Error(body)),
}));

const fetchMock = vi.hoisted(() => vi.fn());

describe('OpenAIResponsesProvider stream retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries when streaming terminates after a successful fetch', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'partial' }] };
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
      });

    fetchMock.mockResolvedValue({ ok: true, body: {} });

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const provider = new OpenAIResponsesProvider('test-key');

    const generator = provider.generateChatCompletion(
      createProviderCallOptions({
        providerName: provider.name,
        contents: [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'hello' }],
          },
        ] as IContent[],
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(
      chunks.map((c) =>
        c.blocks.map((b) => ('text' in b ? b.text : '')).join(''),
      ),
    ).toContain('ok');
  });
});
