/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test proving that two concurrent OpenAIProvider calls with
 * distinct base URLs, auth tokens, and runtime IDs route to the correct
 * endpoints without cross-contamination.
 *
 * This exercises the call-scoped isolation of the shared executor by
 * issuing two generateChatCompletion calls in parallel — one to a GPT-5.6
 * model on canonical OpenAI (Responses) and one to the same model on a
 * custom proxy (Chat Completions). The fetch interceptor records which
 * URL, Authorization header, and request body each call used.
 *
 * @issue #2483
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';

const originalFetch = global.fetch;
const mockFetch = vi.fn();

function makeSseResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function makeChatCompletionResponse(): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const chunk = JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion.chunk',
        choices: [
          {
            delta: { content: '' },
            index: 0,
            finish_reason: 'stop',
          },
        ],
      });
      controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

interface CallRecord {
  url: string;
  authHeader: string | undefined;
  body: string | undefined;
}

function extractHeaderRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  const headerRecord: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      headerRecord[key] = value;
    });
  } else if (
    headers &&
    typeof headers === 'object' &&
    !Array.isArray(headers)
  ) {
    for (const [key, value] of Object.entries(headers)) {
      headerRecord[key] = String(value);
    }
  }
  return headerRecord;
}

async function extractBody(
  init: RequestInit | undefined,
): Promise<string | undefined> {
  const body = init?.body;
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return body;
  if (body instanceof Blob) return body.text();
  return undefined;
}

describe('OpenAIProvider concurrent call-scoped routing isolation @issue:2483', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-concurrent-routing-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
    global.fetch = originalFetch;
  });

  it('routes concurrent calls independently by baseURL/auth with runtime-scoped cache keys', async () => {
    const provider = new OpenAIProvider(
      'shared-constructor-key',
      'https://api.openai.com/v1',
    );

    const records: CallRecord[] = [];

    mockFetch.mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const headerRecord = extractHeaderRecord(init?.headers);
        records.push({
          url: String(input),
          authHeader: headerRecord.Authorization || headerRecord.authorization,
          body: await extractBody(init),
        });
        const url = String(input);
        if (url.includes('/responses')) {
          return makeSseResponse();
        }
        return makeChatCompletionResponse();
      },
    );

    const canonicalSettings = new SettingsService();
    const proxySettings = new SettingsService();

    const canonicalRuntime = createProviderRuntimeContext({
      runtimeId: 'canonical-runtime-id',
      settingsService: canonicalSettings,
    });
    const proxyRuntime = createProviderRuntimeContext({
      runtimeId: 'proxy-runtime-id',
      settingsService: proxySettings,
    });

    const canonicalOptions = createProviderCallOptions({
      providerName: 'openai',
      settings: canonicalSettings,
      runtime: canonicalRuntime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://api.openai.com/v1',
        authToken: 'canonical-call-token',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    const proxyOptions = createProviderCallOptions({
      providerName: 'openai',
      settings: proxySettings,
      runtime: proxyRuntime,
      resolved: {
        model: 'gpt-5.6',
        baseURL: 'https://custom.proxy.com/v1',
        authToken: 'proxy-call-token',
      },
      contents: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi' }] }],
    });

    // Issue both calls concurrently
    await Promise.all([
      (async () => {
        for await (const _ of provider.generateChatCompletion(
          canonicalOptions,
        )) {
          // consume
        }
      })(),
      (async () => {
        for await (const _ of provider.generateChatCompletion(proxyOptions)) {
          // consume
        }
      })(),
    ]);

    expect(records).toHaveLength(2);

    const responsesCall = records.find((r) => r.url.includes('/responses'));
    const chatCall = records.find((r) => r.url.includes('/chat/completions'));

    // Canonical call routed to Responses
    expect(responsesCall).toBeDefined();
    expect(responsesCall?.url).toContain('api.openai.com');
    expect(responsesCall?.authHeader).toBe('Bearer canonical-call-token');

    // Proxy call routed to Chat Completions
    expect(chatCall).toBeDefined();
    expect(chatCall?.url).toContain('custom.proxy.com');
    expect(chatCall?.authHeader).toBe('Bearer proxy-call-token');

    // The Responses call's request body carries a runtime-derived
    // prompt_cache_key sourced from the canonical call's runtime ID,
    // proving call-scoped cache-key isolation.
    expect(responsesCall?.body).toBeDefined();
    const parsed = JSON.parse(responsesCall?.body ?? '{}') as {
      prompt_cache_key?: string;
    };
    expect(parsed.prompt_cache_key).toBeDefined();
    expect(parsed.prompt_cache_key).toContain('canonical-runtime-id');
  });
});
