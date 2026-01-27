/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
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

const delayMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/delay.js', () => ({
  delay: delayMock,
  createAbortError: vi.fn(() => new Error('Aborted')),
}));

const mockAnthropicClient = vi.hoisted(() => ({
  messages: {
    create: vi.fn(),
  },
}));

// Mock the @anthropic-ai/sdk module
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(() => mockAnthropicClient),
}));

describe('AnthropicProvider stream retry behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    delayMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries when streaming terminates after a successful API call', async () => {
    // First stream: yields partial content then terminates
    const firstStream = (async function* () {
      yield {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'partial' },
      };
      throw new Error('terminated');
    })();

    // Second stream: completes successfully
    const secondStream = (async function* () {
      yield {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'success' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      };
    })();

    let callCount = 0;
    mockAnthropicClient.messages.create.mockImplementation(() => {
      const stream = callCount === 0 ? firstStream : secondStream;
      callCount++;
      return {
        withResponse: () =>
          Promise.resolve({
            data: stream,
            response: { headers: new Headers() },
          }),
      };
    });

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const provider = new AnthropicProvider('test-key');

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

    expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(2);
    const texts = chunks
      .flatMap((c) => c.blocks)
      .filter((b) => b.type === 'text')
      .map((b) => ('text' in b ? b.text : ''))
      .join('');
    expect(texts).toContain('partial');
    expect(texts).toContain('success');
  });

  it('waits with exponential backoff between stream retries', async () => {
    const createErrorStream = () =>
      (async function* () {
        yield {
          type: 'message_start',
          message: { usage: { input_tokens: 10, output_tokens: 0 } },
        };
        throw new Error('terminated');
      })();

    const successStream = (async function* () {
      yield {
        type: 'message_start',
        message: { usage: { input_tokens: 10, output_tokens: 0 } },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'success' },
      };
      yield { type: 'content_block_stop', index: 0 };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      };
    })();

    let callCount = 0;
    mockAnthropicClient.messages.create.mockImplementation(() => {
      const stream = callCount < 2 ? createErrorStream() : successStream;
      callCount++;
      return {
        withResponse: () =>
          Promise.resolve({
            data: stream,
            response: { headers: new Headers() },
          }),
      };
    });

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const provider = new AnthropicProvider('test-key');

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

    expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(3);
    expect(delayMock).toHaveBeenCalledTimes(2);

    const firstDelay = delayMock.mock.calls[0]?.[0] as number;
    const secondDelay = delayMock.mock.calls[1]?.[0] as number;

    expect(firstDelay).toBeGreaterThan(0);
    expect(secondDelay).toBeGreaterThan(firstDelay);
  });

  it('fails after max attempts with error thrown', async () => {
    const createErrorStream = () =>
      (async function* () {
        yield {
          type: 'message_start',
          message: { usage: { input_tokens: 10, output_tokens: 0 } },
        };
        throw new Error('terminated');
      })();

    mockAnthropicClient.messages.create.mockImplementation(() => ({
      withResponse: () =>
        Promise.resolve({
          data: createErrorStream(),
          response: { headers: new Headers() },
        }),
    }));

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const provider = new AnthropicProvider('test-key');

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
        // Should throw before yielding all chunks
      }
    }).rejects.toThrow('terminated');

    // Should attempt 4 times (max attempts)
    expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(4);
  });

  it('throws non-retryable errors immediately', async () => {
    const createErrorStream = () =>
      (async function* () {
        yield {
          type: 'message_start',
          message: { usage: { input_tokens: 10, output_tokens: 0 } },
        };
        throw new Error('bad request');
      })();

    mockAnthropicClient.messages.create.mockImplementation(() => ({
      withResponse: () =>
        Promise.resolve({
          data: createErrorStream(),
          response: { headers: new Headers() },
        }),
    }));

    retryWithBackoffMock.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    const provider = new AnthropicProvider('test-key');

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
    }).rejects.toThrow('bad request');

    // Should not retry non-retryable errors
    expect(mockAnthropicClient.messages.create).toHaveBeenCalledTimes(1);
  });
});
