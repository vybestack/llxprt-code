/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 WP16: providers without `projectPromptEnvelope` (the Gemini
 * plugin, OpenAIVercelProvider, ...) must work on the source route. The
 * contents-only estimate read row by row from the disk selection has to equal
 * the array route's fallback estimate, and the unflagged send must reach the
 * real transports with request rows.
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { OpenAIVercelProvider } from '@vybestack/llxprt-code-providers/openai-vercel/OpenAIVercelProvider.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import {
  GeminiProvider,
  type CreateGeminiApiClient,
} from '../../../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import {
  estimatePendingTokens,
  estimateSourcePendingTokens,
} from '../compression/compressionBudgeting.js';
import {
  enforceAndStreamSourcePromptEnvelopeRetries,
  type PromptEnvelopeSource,
  type SourceProviderChatOptions,
} from './promptEnvelopeSendSeam.js';
import {
  diskSource,
  sourceRootSetup,
} from './__tests__/support/prompt-envelope-source-test-helpers.js';

const root = sourceRootSetup();
const originalFetch = globalThis.fetch;

async function readRows(source: PromptEnvelopeSource): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const row of source.openReader()) rows.push(row);
  return rows;
}

function replay(rows: IContent[]): AsyncIterable<IContent> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<IContent> {
      yield* rows;
    },
  };
}

function reopenable(source: PromptEnvelopeSource): AsyncIterable<IContent> {
  return { [Symbol.asyncIterator]: () => source.openReader() };
}

async function drain(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const out: IContent[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

const failingEstimator = {
  estimateTokensForContents: async (): Promise<number> => {
    throw new Error('tokenizer unavailable');
  },
} as unknown as HistoryService;

describe('providers without prompt-envelope projection on the source route', () => {
  it('estimates from the request rows exactly as the contents estimator does', async () => {
    const fixture = await diskSource(root(), 12);
    const rows = await readRows(fixture.source);
    const history = new HistoryService();
    const model = 'model-a';
    const fallbackSources: Array<
      [string, HistoryService, () => Promise<number>]
    > = [
      [
        'tokenizer',
        history,
        () => estimateSourcePendingTokens(fixture.source, history, model),
      ],
      [
        'text fallback',
        failingEstimator,
        () =>
          estimateSourcePendingTokens(fixture.source, failingEstimator, model),
      ],
    ];
    for (const [, service, sourceEstimate] of fallbackSources) {
      const expected = await estimatePendingTokens(rows, service, model);
      const actual = await sourceEstimate();
      expect(actual).toBeGreaterThan(0);
      expect(actual).toBe(expected);
    }
    await fixture.source.close();
  });

  it('prepares a non-projecting provider with a null envelope estimate and the fallback count', async () => {
    const fixture = await diskSource(root(), 4);
    const history = new HistoryService();
    const provider = { name: 'gemini' } as unknown as RuntimeProvider;
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider,
      source: fixture.source,
      buildOptions: (source) =>
        ({
          contents: reopenable(source),
          requestRows: source,
          contentCount: source.count,
        }) as SourceProviderChatOptions,
      enforce: async (source, estimate) => {
        expect(await estimate(source)).toBeGreaterThan(0);
        return source;
      },
      fallbackEstimate: (source) =>
        estimateSourcePendingTokens(source, history, 'model-a'),
      shouldRetryOnError: () => false,
      send: (prepared) => {
        expect(prepared.estimate).toBeNull();
        expect(prepared.estimatedPromptTokens).toBeGreaterThan(0);
        expect(prepared.options.requestRows).toBe(fixture.source);
        return (async function* (): AsyncGenerator<IContent> {
          yield { speaker: 'ai', blocks: [{ type: 'text', text: 'ok' }] };
        })();
      },
    });
    expect(await drain(stream)).toHaveLength(1);
    expect(fixture.state.closed).toBe(1);
  });
});

function sseResponse(): Response {
  const frame = (delta: unknown, finish: string | null): string =>
    `data: ${JSON.stringify({
      id: 'chatcmpl-wp16',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-wp16',
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  const encoder = new TextEncoder();
  const frames = [
    frame({ role: 'assistant', content: 'ok' }, null),
    frame({}, 'stop'),
    'data: [DONE]\n\n',
  ];
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const item of frames) controller.enqueue(encoder.encode(item));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

describe('unflagged end-to-end send through real non-projecting providers', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends the Vercel provider request from request rows', async () => {
    const fixture = await diskSource(root(), 6);
    const expectedRows = await readRows(fixture.source);
    const bodies: string[] = [];
    globalThis.fetch = Object.assign(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(typeof init?.body === 'string' ? init.body : '');
        return sseResponse();
      },
      { preconnect: originalFetch.preconnect },
    ) as typeof fetch;
    const settings = new SettingsService();
    settings.set('activeProvider', 'openaivercel');
    const config = createRuntimeConfigStub(settings);
    const provider = new OpenAIVercelProvider('test-api-key');
    const base = createProviderCallOptions({
      providerName: 'openaivercel',
      config,
      settings,
      contents: { async *[Symbol.asyncIterator]() {} },
      resolved: { streaming: true },
    });
    const history = new HistoryService();
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider,
      source: fixture.source,
      buildOptions: (source) =>
        ({
          ...base,
          contents: {
            [Symbol.asyncIterator]: () => {
              throw new Error('The transport must read requestRows');
            },
          },
          requestRows: source,
          contentCount: source.count,
        }) as SourceProviderChatOptions,
      enforce: async (source) => source,
      fallbackEstimate: (source, signal) =>
        estimateSourcePendingTokens(source, history, 'gpt-wp16', signal),
      shouldRetryOnError: () => false,
    });
    expect((await drain(stream)).length).toBeGreaterThan(0);
    expect(bodies).toHaveLength(1);
    await drain(
      provider.generateChatCompletion({
        ...base,
        contents: replay(expectedRows),
      }),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(fixture.state.closed).toBe(1);
  });

  it('sends the Gemini plugin request from request rows', async () => {
    const fixture = await diskSource(root(), 6);
    const expectedRows = await readRows(fixture.source);
    const requests: string[] = [];
    const client = (async () => ({
      models: {
        generateContentStream: async (request: { contents: unknown[] }) => {
          requests.push(JSON.stringify(request));
          return (async function* () {
            yield { candidates: [{ content: { parts: [{ text: 'ok' }] } }] };
          })();
        },
      },
    })) as unknown as CreateGeminiApiClient;
    const provider = new GeminiProvider(
      'test-key',
      undefined,
      undefined,
      client,
    );
    const base = createProviderCallOptions({
      providerName: 'gemini',
      contents: { async *[Symbol.asyncIterator]() {} },
      ephemerals: { streaming: 'enabled' },
    });
    const history = new HistoryService();
    const stream = await enforceAndStreamSourcePromptEnvelopeRetries({
      provider: provider as unknown as RuntimeProvider,
      source: fixture.source,
      buildOptions: (source) =>
        ({
          ...base,
          contents: {
            [Symbol.asyncIterator]: () => {
              throw new Error('The transport must read requestRows');
            },
          },
          requestRows: source,
          contentCount: source.count,
        }) as SourceProviderChatOptions,
      enforce: async (source) => source,
      fallbackEstimate: (source, signal) =>
        estimateSourcePendingTokens(source, history, 'gemini-wp16', signal),
      shouldRetryOnError: () => false,
    });
    expect((await drain(stream)).length).toBeGreaterThan(0);
    expect(requests).toHaveLength(1);
    await drain(
      provider.generateChatCompletion({
        ...base,
        contents: replay(expectedRows),
      }),
    );
    expect(requests).toHaveLength(2);
    expect(requests[0]).toBe(requests[1]);
    expect(fixture.state.closed).toBe(1);
  });
});
