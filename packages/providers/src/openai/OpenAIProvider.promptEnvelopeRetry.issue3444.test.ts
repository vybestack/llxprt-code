/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260909-ISSUE3444
 *
 * Issue #3444 — a RetryOrchestrator retry must not replay a spent
 * promptEnvelopeTransportToken through OpenAIProvider's chat path. The token
 * maps to a prepared media request released by the attempt that consumed it;
 * replaying it fails at media consumption (`Cannot consume media request
 * contents after release`) and masks the real transport error. Only the SDK
 * transport is mocked; the provider, projection, and RetryOrchestrator are
 * real.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { OpenAIProvider } from './OpenAIProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { createOpenAIRawPostTestAdapter } from '../test-utils/rawPostTestAdapters.js';

const RELEASE_ERROR = 'Cannot consume media request contents after release';

const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};

const mockChatCompletionsCreate = vi.fn();

const mockOpenAIConstructor = vi.fn().mockImplementation(() => ({
  ...createOpenAIRawPostTestAdapter(mockChatCompletionsCreate),
  chat: {
    completions: {
      create: mockChatCompletionsCreate,
    },
  },
}));

void vi.mock('openai', () => ({
  default: mockOpenAIConstructor,
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

const mockSettingsService = {
  set: vi.fn(),
  get: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
};

void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...realLlxprtCodeSettingsModule,
  getSettingsService: vi.fn(() => mockSettingsService),
  SETTINGS_REGISTRY: [],
}));

function make429RateLimitError(): Error {
  const error = new Error('Rate limit exceeded') as Error & {
    status?: number;
  };
  error.status = 429;
  return error;
}

function createMockChatStream(text: string) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: text } }],
      };
    },
  };
}

function mediaMessages(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'What is in this image?' },
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'aValidBase64Chunk==',
          encoding: 'base64' as const,
        },
      ],
    },
  ];
}

function errorMessage(error: unknown): string {
  return String(error instanceof Error ? error.message : error);
}

describe('OpenAIProvider prompt-envelope retry (@issue:3444)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatCompletionsCreate.mockReset();
    delete process.env.OPENAI_API_KEY;
  });

  it('retries a projected media turn with a fresh envelope instead of the spent token', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    mockChatCompletionsCreate
      .mockRejectedValueOnce(make429RateLimitError())
      .mockResolvedValueOnce(createMockChatStream('recovered'));

    const provider = new OpenAIProvider('test-key');

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(),
      ephemerals: { retries: 2, retrywait: 0 },
      resolved: { model: 'gpt-4o' },
    } as Parameters<typeof createProviderCallOptions>[0]);

    const projection = await provider.projectPromptEnvelope(callOptions);
    expect(projection.transportToken).toBeDefined();

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });

    const chunks: string[] = [];
    let threw = false;
    let error: unknown;
    try {
      const gen = orchestrator.generateChatCompletion({
        ...callOptions,
        promptEnvelopeTransportToken: projection.transportToken,
      });
      for await (const chunk of gen) {
        const text = chunk.blocks.find((b) => b.type === 'text');
        if (text !== undefined) chunks.push(text.text);
      }
    } catch (e) {
      threw = true;
      error = e;
    }

    expect(threw).toBe(false);
    expect(chunks.join('')).toContain('recovered');
    // Attempt 1 (429) + attempt 2 (recovered): both reached the transport.
    expect(mockChatCompletionsCreate).toHaveBeenCalledTimes(2);
    // The retried request still carries the image payload.
    const retryArgs = mockChatCompletionsCreate.mock.calls[1][0];
    expect(JSON.stringify(retryArgs.messages)).toContain('image_url');
    expect(errorMessage(error)).not.toContain(RELEASE_ERROR);
  });

  it('preserves the last transport failure when projected media retries exhaust', async () => {
    process.env.OPENAI_API_KEY = 'test-key';
    const lastFailure = Object.assign(
      new Error('Rate limit on final chat send'),
      { status: 429 },
    );
    mockChatCompletionsCreate
      .mockRejectedValueOnce(make429RateLimitError())
      .mockRejectedValueOnce(lastFailure);
    const provider = new OpenAIProvider('test-key');
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(),
      ephemerals: { retries: 2, retrywait: 0 },
      resolved: { model: 'gpt-4o' },
    });
    const projection = await provider.projectPromptEnvelope(options);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 2,
      initialDelayMs: 0,
    });
    let caught: unknown;
    const chunks: IContent[] = [];
    try {
      for await (const chunk of orchestrator.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      }))
        chunks.push(chunk);
    } catch (error) {
      caught = error;
    }
    expect(chunks).toHaveLength(0);
    expect(mockChatCompletionsCreate.mock.calls).toHaveLength(2);
    expect(errorMessage(caught)).toContain(lastFailure.message);
    expect(errorMessage(caught)).not.toContain(RELEASE_ERROR);
  });
});
