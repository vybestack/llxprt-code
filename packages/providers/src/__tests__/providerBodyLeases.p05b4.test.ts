/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * P05b4 Slice D: request-scoped body leases for the openai and openai-vercel
 * transports (issue #854). Each transport acquires a lease over its wire body
 * and releases it when the transport call settles — success, error, or abort —
 * so the in-flight body count returns to zero, nothing outlives the request,
 * and consuming a released body fails fast. The captured transport bytes must
 * equal the expected JSON body for each provider.
 *
 * @plan:PLAN-20260917-ISSUE854.P05b4
 * @requirement:G6
 */

import { afterEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { activeRequestBodyCount } from '../utils/requestScopedBody.js';
import { acquireRequestScopedBody } from '../utils/requestScopedBody.js';
import { readRawPostTestBody } from '../test-utils/rawPostTestAdapters.js';
import { OpenAIProvider } from '../openai/OpenAIProvider.js';
import { OpenAIVercelProvider } from '../openai-vercel/OpenAIVercelProvider.js';

const originalFetch = globalThis.fetch;

const SYSTEM_PROMPT = 'lease system prompt';

function singleUserTurn(): IContent[] {
  return [{ speaker: 'human', blocks: [{ type: 'text', text: 'ping' }] }];
}

interface Harness {
  readonly settings: SettingsService;
  readonly runtime: ReturnType<typeof createProviderRuntimeContext>;
}

function makeHarness(
  providerName: 'openai' | 'openai-vercel',
  runtimeId: string,
): Harness {
  const settings = new SettingsService();
  settings.setProviderSetting(providerName, 'model', 'gpt-4o');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId,
    config: createRuntimeConfigStub(settings),
  });
  setActiveProviderRuntimeContext(runtime);
  return { settings, runtime };
}

function makeOptions(
  providerName: 'openai' | 'openai-vercel',
  harness: Harness,
  contents: IContent[],
  ephemerals: Record<string, unknown>,
): ReturnType<typeof createProviderCallOptions> {
  const invocation = createRuntimeInvocationContext({
    runtime: harness.runtime,
    settings: harness.settings,
    providerName,
    ephemeralsSnapshot: ephemerals,
  });
  return createProviderCallOptions({
    providerName,
    settings: harness.settings,
    config: harness.runtime.config,
    runtime: harness.runtime,
    invocation,
    contents,
    systemInstruction: SYSTEM_PROMPT,
  });
}

async function drain(
  provider: OpenAIProvider | OpenAIVercelProvider,
  options: ReturnType<typeof createProviderCallOptions>,
): Promise<void> {
  for await (const _chunk of provider.generateChatCompletion(options)) {
    // drain
  }
}

/* ------------------------------------------------------------------ *
 * openai transport (raw-post client seam)
 * ------------------------------------------------------------------ */

interface CapturedPost {
  readonly path: string;
  readonly bodyText: string;
}

function openAICompletion(): unknown {
  return {
    id: 'chatcmpl-lease',
    object: 'chat.completion',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

async function runOpenAIRequest(
  harness: Harness,
  contents: IContent[],
  post: (path: string, options: { body?: unknown }) => Promise<unknown>,
): Promise<void> {
  const getClientSpy = vi
    .spyOn(
      OpenAIProvider.prototype as unknown as {
        getClient: () => Promise<unknown>;
      },
      'getClient',
    )
    .mockResolvedValue({ post, apiKey: 'test-key' });
  const provider = new OpenAIProvider('test-key', undefined, undefined);
  const options = makeOptions('openai', harness, contents, {
    'prompt-caching': 'off',
    streaming: 'disabled',
  });
  try {
    await drain(provider, options);
  } finally {
    getClientSpy.mockRestore();
  }
}

async function captureOpenAISuccess(
  harness: Harness,
  contents: IContent[],
): Promise<CapturedPost> {
  const captured: CapturedPost[] = [];
  await runOpenAIRequest(harness, contents, async (path, options) => {
    captured.push({
      path,
      bodyText: await readRawPostTestBody(options.body),
    });
    return openAICompletion();
  });
  expect(captured.length).toBe(1);
  return captured[0];
}

/* ------------------------------------------------------------------ *
 * openai-vercel transport (globalThis.fetch seam)
 * ------------------------------------------------------------------ */

function vercelSseResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"id":"chatcmpl-lease","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"}}]}\n\n',
        ),
      );
      controller.enqueue(
        encoder.encode(
          'data: {"id":"chatcmpl-lease","object":"chat.completion.chunk","created":1,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}\n\n',
        ),
      );
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function readInitBody(init: RequestInit | undefined): Promise<string> {
  const body = init?.body;
  if (body === null || body === undefined) return '';
  if (typeof body === 'string') return body;
  return new Response(body).text();
}

async function captureVercelBodies(
  harness: Harness,
  contents: IContent[],
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): Promise<string[]> {
  const provider = new OpenAIVercelProvider(
    'test-key',
    'https://api.openai.com/v1',
  );
  const options = makeOptions('openai-vercel', harness, contents, {
    'prompt-caching': 'off',
  });
  const bodies: string[] = [];
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(input, init).then(async (response) => {
      bodies.push(await readInitBody(init));
      return response;
    });
  try {
    await drain(provider, options);
  } finally {
    globalThis.fetch = originalFetch;
  }
  return bodies;
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe('P05b4 transport body leases @plan:PLAN-20260917-ISSUE854.P05b4', () => {
  afterEach(() => {
    clearActiveProviderRuntimeContext();
    globalThis.fetch = originalFetch;
  });

  it('openai: active body count returns to 0 after a successful call, and sent bytes equal the expected JSON', async () => {
    const harness = makeHarness('openai', 'p05b4-lease-openai');
    const captured = await captureOpenAISuccess(harness, singleUserTurn());
    expect(captured.path).toBe('/chat/completions');
    expect(captured.bodyText).toStrictEqual(
      JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'ping' },
        ],
        stream: false,
      }),
    );
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('openai: releases the body when the transport errors', async () => {
    const harness = makeHarness('openai', 'p05b4-lease-openai-error');
    await expect(
      runOpenAIRequest(harness, singleUserTurn(), async () => {
        throw new Error('openai lease transport failure');
      }),
    ).rejects.toThrow('openai lease transport failure');
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('openai-vercel: active body count returns to 0 after a successful call, and sent bytes equal the expected JSON', async () => {
    const harness = makeHarness('openai-vercel', 'p05b4-lease-vercel');
    const bodies = await captureVercelBodies(
      harness,
      singleUserTurn(),
      async () => vercelSseResponse(),
    );
    expect(bodies.length).toBeGreaterThanOrEqual(1);
    expect(bodies[0]).toStrictEqual(
      JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: 'ping' },
        ],
        stream: true,
        stream_options: { include_usage: true },
      }),
    );
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('openai-vercel: releases the body when the transport errors', async () => {
    const harness = makeHarness('openai-vercel', 'p05b4-lease-vercel-error');
    await expect(
      captureVercelBodies(harness, singleUserTurn(), async () => {
        throw new Error('vercel lease transport failure');
      }),
    ).rejects.toThrow('vercel lease transport failure');
    expect(activeRequestBodyCount()).toBe(0);
  });

  it('consuming a released transport body fails fast, and double release stays idempotent', async () => {
    interface LeaseProbe {
      readonly rows: string[];
    }
    const lease = acquireRequestScopedBody<LeaseProbe>('openai', {
      rows: ['wire-row'],
    });
    await lease.release();
    expect(() => lease.value).toThrow(
      'Request-scoped body consumed after release (issue #854 P05b4)',
    );
    await expect(lease.release()).resolves.toBeUndefined();
    expect(activeRequestBodyCount()).toBe(0);
  });
});
