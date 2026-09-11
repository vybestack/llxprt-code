/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260909-ISSUE3444
 *
 * Issue #3444 — a RetryOrchestrator retry must not replay a spent
 * promptEnvelopeTransportToken through the OpenAI Responses path. Releasing
 * the prepared envelope's media request clears `request.input` (the splice
 * cleanup registered at prepare time), so a retry that replays the token
 * silently sends an EMPTY input payload and corrupts the turn. The provider,
 * projection, executor, and RetryOrchestrator under test are real; only the
 * transport fetch is mocked. The SSE parser processes real wire events.
 *
 * Scenario wiring: the invocation omits the `retries` ephemeral, so the
 * executor's internal streaming-retry cap falls back to its default (6)
 * while the orchestrator cap comes from its config (7). Six 429 responses
 * exhaust the executor's internal loop with one budget slot left; the
 * orchestrator then drives an OUTER retry, which must carry a freshly
 * projected envelope. This mirrors the production path where a failover
 * stack grants more physical attempts than one backend's internal loop.
 */

import { restoreGlobals, setGlobal } from '@vybestack/llxprt-code-test-utils';
import { describe, it, beforeEach, afterEach, expect, vi } from 'bun:test';
import { OpenAIResponsesProvider } from './OpenAIResponsesProvider.js';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const realLlxprtCodeSettingsModule = {
  ...(await import('@vybestack/llxprt-code-settings')),
};

const mockSettingsService = {
  set: vi.fn(),
  get: vi.fn(),
  setProviderSetting: vi.fn(),
  getProviderSettings: vi.fn().mockReturnValue({}),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  getAllGlobalSettings: vi.fn().mockReturnValue({}),
};

const fetchMock = vi.fn();
const requestBodies: string[] = [];

void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...realLlxprtCodeSettingsModule,
  getSettingsService: () => mockSettingsService,
  SETTINGS_REGISTRY: [],
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('system prompt'),
}));

function rateLimitResponse(): Response {
  return new Response('rate limited', {
    status: 429,
    headers: { 'retry-after': '0' },
  });
}

function successResponse(): Response {
  const events = [
    {
      type: 'response.output_text.delta',
      delta: 'recovered',
      item_id: 'msg_1',
      output_index: 0,
      content_index: 0,
    },
    {
      type: 'response.completed',
      response: { id: 'resp_1', status: 'completed' },
    },
  ];
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    {
      headers: { 'content-type': 'text/event-stream' },
    },
  );
}

function mediaMessages(): IContent[] {
  return [
    {
      speaker: 'human',
      blocks: [
        { type: 'text', text: 'hello-retry-payload' },
        {
          type: 'media',
          mimeType: 'image/png',
          data: 'aValidBase64Chunk==',
          encoding: 'base64',
        },
      ],
    },
  ];
}

describe('OpenAIResponsesProvider prompt-envelope retry (@issue:3444)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsService.getSettings.mockResolvedValue({});
    requestBodies.length = 0;
    setGlobal('fetch', fetchMock);

    // Capture each attempt's serialized request body so the test can prove
    // the retried attempt still carries the full projected input (the RED
    // failure mode is a silently emptied `input`, not a thrown error).
    fetchMock.mockImplementation(async (_url: unknown, init: RequestInit) => {
      const body = init.body;
      requestBodies.push(
        body === null || body === undefined
          ? ''
          : await new Response(body).text(),
      );
      if (requestBodies.length <= 6) return rateLimitResponse();
      return successResponse();
    });
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  it('an orchestrator outer retry sends a freshly projected envelope, not the spent one', async () => {
    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });

    const callOptions = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(),
      ephemerals: {
        retrywait: 0,
      },
      resolved: { model: 'gpt-5' },
    });

    const projection = await provider.projectPromptEnvelope(callOptions);
    expect(projection.transportToken).toBeDefined();

    // Orchestrator cap (7) exceeds the executor's internal streaming-retry
    // cap (6): the outer retry gets the seventh and final budget slot.
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 7,
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
        chunks.push(JSON.stringify(chunk));
      }
    } catch (e) {
      threw = true;
      error = e;
    }

    // Six internal 429s + the orchestrator's outer retry: seven physical
    // sends, and the seventh succeeded.
    expect(threw).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(chunks.join('')).toContain('recovered');

    // The original send carried the projected input...
    expect(requestBodies[0]).toContain('hello-retry-payload');
    // ...and so did the outer retry. Replaying the spent token would have
    // spliced `input` to an empty array and silently dropped the payload.
    expect(requestBodies[6]).toContain('hello-retry-payload');
    expect(requestBodies[6]).toContain('input_image');
    expect(requestBodies[6]).toContain(
      'data:image/png;base64,aValidBase64Chunk==',
    );
    expect(String(error)).not.toContain(
      'Cannot consume media request contents after release',
    );
  });

  it('preserves the last transport failure when the outer retry exhausts', async () => {
    let sends = 0;
    fetchMock.mockImplementation(() => {
      sends += 1;
      return new Response(`rate limit on physical send ${sends}`, {
        status: 429,
        headers: { 'retry-after': '0' },
      });
    });
    const provider = new OpenAIResponsesProvider('test-key', undefined, {
      getEphemeralSettings: () => ({}),
    });
    const options = createProviderCallOptions({
      providerName: provider.name,
      contents: mediaMessages(),
      ephemerals: { retrywait: 0 },
      resolved: { model: 'gpt-5' },
    });
    const projection = await provider.projectPromptEnvelope(options);
    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 7,
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
    expect(sends).toBe(7);
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error ? caught.message : '').toContain(
      'rate limit on physical send 7',
    );
    expect(String(caught)).not.toContain(
      'Cannot consume media request contents after release',
    );
  });
});
