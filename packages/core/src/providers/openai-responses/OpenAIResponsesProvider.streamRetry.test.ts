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

const delayMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/delay.js', () => ({
  delay: delayMock,
  createAbortError: vi.fn(() => new Error('Aborted')),
}));

const fetchMock = vi.hoisted(() => vi.fn());

describe('OpenAIResponsesProvider stream retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    delayMock.mockResolvedValue(undefined);
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
    const texts = chunks.map((c) =>
      c.blocks.map((b) => ('text' in b ? b.text : '')).join(''),
    );
    expect(texts).toContain('partial');
    expect(texts).toContain('ok');
  });

  it('waits with exponential backoff between stream retries', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success' }] };
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
        ephemerals: {
          retrywait: 2000, // Override default delay
        },
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(delayMock).toHaveBeenCalledTimes(2);

    const firstDelay = delayMock.mock.calls[0]?.[0] as number;
    const secondDelay = delayMock.mock.calls[1]?.[0] as number;

    expect(firstDelay).toBeGreaterThan(0);
    expect(secondDelay).toBeGreaterThan(firstDelay);
    // Verify initial delay respects ephemeral setting (~2000ms with jitter)
    expect(firstDelay).toBeGreaterThan(1400);
    expect(firstDelay).toBeLessThan(2600);
  });

  it('uses higher maxStreamingAttempts for Codex mode when ephemerals not set', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success' }] };
      });

    fetchMock.mockResolvedValue({ ok: true, body: {} });

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const mockOAuthManager = {
      getOAuthToken: vi.fn().mockResolvedValue({
        access_token: 'test-token',
        account_id: 'test-account-id',
        expiry: Date.now() + 3600000,
        token_type: 'Bearer',
      }),
    };

    const provider = new OpenAIResponsesProvider(
      'test-key',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      mockOAuthManager as never,
    );

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

    // Codex defaults to 5 attempts when no ephemeral retries setting
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('fails after maxStreamingAttempts for regular mode', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
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

    await expect(async () => {
      for await (const _chunk of generator) {
        // Should throw before yielding
      }
    }).rejects.toThrow('terminated');

    // Regular mode defaults to 4 attempts
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('respects retries ephemeral setting', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
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
        ephemerals: {
          retries: 2, // Override default
        },
      }),
    );

    await expect(async () => {
      for await (const _chunk of generator) {
        // Should throw after 2 attempts
      }
    }).rejects.toThrow('terminated');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects retrywait ephemeral setting', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        throw new Error('terminated');
      })
      .mockImplementationOnce(async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'success' }] };
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
        ephemerals: {
          retrywait: 1000, // Override default 5000ms
        },
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(delayMock).toHaveBeenCalledTimes(1);

    const delay = delayMock.mock.calls[0]?.[0] as number;
    // Should be ~1000ms with jitter (between 700-1300)
    expect(delay).toBeGreaterThan(700);
    expect(delay).toBeLessThan(1300);
  });
});
