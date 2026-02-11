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
  isNetworkTransientError: vi.fn((error: unknown) => {
    if (!error || typeof error !== 'object') return false;
    if (
      'message' in error &&
      String((error as { message?: unknown }).message).includes('terminated')
    )
      return true;
    if (
      'code' in error &&
      typeof (error as { code?: unknown }).code === 'string' &&
      ['ECONNRESET', 'ETIMEDOUT'].includes(
        (error as { code: string }).code.toUpperCase(),
      )
    )
      return true;
    return false;
  }),
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
  parseErrorResponse: vi.fn((status: number, body: string) => {
    const e = new Error(body);
    (e as Error & { status: number }).status = status;
    return e;
  }),
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

  it('uses unified default maxStreamingAttempts for Codex mode', async () => {
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

    // Codex now uses same default of 6 attempts (unified with other providers)
    expect(fetchMock).toHaveBeenCalledTimes(6);
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

    // Default is now 6 attempts (unified across all modes)
    expect(fetchMock).toHaveBeenCalledTimes(6);
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

  it('retries when server responds with 429 rate limit', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded',
      })
      .mockResolvedValue({ ok: true, body: {} });

    parseResponsesStreamMock.mockImplementationOnce(async function* () {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    });

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
    expect(texts).toContain('ok');
  });

  it('retries when server responds with 5xx server error', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable',
      })
      .mockResolvedValue({ ok: true, body: {} });

    parseResponsesStreamMock.mockImplementationOnce(async function* () {
      yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
    });

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
    expect(texts).toContain('ok');
  });

  it('does not retry when server responds with 400 bad request', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Bad Request',
    });

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
        // Should throw immediately
      }
    }).rejects.toThrow('Bad Request');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses default retries of 6', async () => {
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
      }),
    );

    const chunks: IContent[] = [];
    for await (const chunk of generator) {
      chunks.push(chunk);
    }

    // 5 failures + 1 success = 6 total attempts (default)
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const texts = chunks
      .filter((c) => c?.blocks)
      .map((c) => c.blocks.map((b) => ('text' in b ? b.text : '')).join(''));
    expect(texts).toContain('success');
  });

  it('retries on network transient error with ECONNRESET code', async () => {
    parseResponsesStreamMock
      .mockImplementationOnce(async function* () {
        yield;
        const err = new Error('socket error');
        (err as Error & { code: string }).code = 'ECONNRESET';
        throw err;
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
    const texts = chunks
      .filter((c) => c?.blocks)
      .map((c) => c.blocks.map((b) => ('text' in b ? b.text : '')).join(''));
    expect(texts).toContain('ok');
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
