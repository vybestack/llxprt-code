/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
/**
 * Issue #854: compression summary calls hand a provider `requestRows` with no
 * prepared projection token. Every provider family must prepare the request
 * itself, send the summary request and return the summary, and the bytes on
 * the wire must equal the reference send of the same rows. Only the HTTP
 * transport (fetch) is faked.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { SettingsService } from '../../packages/settings/src/settings/SettingsService.js';
import { createProviderRuntimeContext } from '../../packages/core/src/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '../../packages/core/src/runtime/RuntimeInvocationContext.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import { OpenAIProvider } from '../../packages/providers/src/openai/OpenAIProvider.js';
import { OpenAIVercelProvider } from '../../packages/providers/src/openai-vercel/OpenAIVercelProvider.js';
import { AnthropicProvider } from '../../packages/providers/src/anthropic/AnthropicProvider.js';
import { GeminiProvider } from '../../plugins/google-gemini/src/gemini/GeminiProvider.js';
import { ProviderManager } from '../../packages/providers/src/ProviderManager.js';
import { LoadBalancingProvider } from '../../packages/providers/src/LoadBalancingProvider.js';
import type { IProvider } from '../../packages/providers/src/IProvider.js';
import type { IContent } from '../../packages/core/src/services/history/IContent.js';
import { RowOwnership } from '../../packages/core/src/recording/rowOwnership.js';
import type { HistoryIndexedRows } from '../../packages/core/src/services/history/historyMutationSnapshot.js';
import { diskSummaryRequestSelection } from '../../packages/agents/src/compression/middleOutDiskPlan.js';
import { buildCompressionChatOptions } from '../../packages/agents/src/compression/compressionSystemPrompt.js';
import { CompressionLoadBalancingProvider } from '../../packages/agents/src/core/CompressionLoadBalancingProvider.js';

const SUMMARY = '<state_snapshot>kept details</state_snapshot>';

type Family = 'openai' | 'openaivercel' | 'anthropic' | 'gemini';

const FAMILIES: readonly Family[] = [
  'openai',
  'openaivercel',
  'anthropic',
  'gemini',
];

const MODELS: Record<Family, string> = {
  openai: 'gpt-4o',
  openaivercel: 'gpt-4o',
  anthropic: 'claude-opus-5',
  gemini: 'gemini-2.5-flash',
};

function makeProvider(family: Family): IProvider {
  switch (family) {
    case 'openai':
      return new OpenAIProvider('test-key', 'https://api.openai.com/v1');
    case 'openaivercel':
      return new OpenAIVercelProvider('test-key', 'https://api.openai.com/v1');
    case 'anthropic':
      return new AnthropicProvider('test-key');
    case 'gemini':
      return new GeminiProvider('test-key');
    default:
      throw new Error('Unknown provider family');
  }
}

function sse(events: readonly unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
      'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

function reply(family: Family, url: string, body: string): Response {
  const streaming = /"stream"\s*:\s*true/.test(body);
  switch (family) {
    case 'anthropic':
      return Response.json({
        id: 'msg_summary',
        type: 'message',
        role: 'assistant',
        model: MODELS.anthropic,
        content: [{ type: 'text', text: SUMMARY }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 7, output_tokens: 3 },
      });
    case 'gemini': {
      const candidate = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: SUMMARY }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 7,
          candidatesTokenCount: 3,
          totalTokenCount: 10,
        },
      };
      if (!url.includes('streamGenerateContent'))
        return Response.json(candidate);
      return new Response(`data: ${JSON.stringify(candidate)}\n\n`, {
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    case 'openai':
    case 'openaivercel':
      return streaming
        ? sse([
            {
              id: 'chatcmpl-summary',
              object: 'chat.completion.chunk',
              model: MODELS[family],
              choices: [{ index: 0, delta: { content: SUMMARY } }],
            },
            {
              id: 'chatcmpl-summary',
              object: 'chat.completion.chunk',
              model: MODELS[family],
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            },
          ])
        : Response.json({
            id: 'chatcmpl-summary',
            object: 'chat.completion',
            model: MODELS[family],
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: SUMMARY },
                finish_reason: 'stop',
              },
            ],
            usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
          });
    default:
      throw new Error('Unknown provider family');
  }
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Replaces the HTTP transport and records every request body exactly. */
function fakeTransport(family: Family): string[] {
  const bodies: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    let body: string | undefined;
    if (init?.body !== undefined && init.body !== null)
      body = await new Response(init.body).text();
    else if (input instanceof Request) body = await input.text();
    if (body === undefined) throw new Error('Summary request had no body');
    bodies.push(body);
    return reply(family, url, body);
  }) as typeof fetch;
  return bodies;
}

function journalRows(): HistoryIndexedRows & { rows: IContent[] } {
  const rows: IContent[] = [];
  for (let turn = 0; turn < 6; turn++) {
    rows.push({
      speaker: 'human',
      blocks: [{ type: 'text', text: `question ${turn} about the project` }],
    });
    rows.push({
      speaker: 'ai',
      blocks: [{ type: 'text', text: `answer ${turn} with some detail` }],
    });
  }
  return {
    rows,
    length: rows.length,
    readRow: (index: number) => structuredClone(rows[index]),
    [Symbol.iterator]: () => rows.values(),
  };
}

function runtimeFor(family: Family) {
  const settings = new SettingsService();
  settings.set('auth-key', 'test-key');
  settings.setProviderSetting(family, 'model', MODELS[family]);
  settings.setProviderSetting(family, 'streaming', 'disabled');
  const runtime = createProviderRuntimeContext({
    settingsService: settings,
    runtimeId: `tokenless-${family}`,
    config: createRuntimeConfigStub(settings),
  });
  const invocation = createRuntimeInvocationContext({
    runtime,
    settings,
    providerName: family,
    ephemeralsSnapshot: { streaming: 'disabled', retries: 0, retrywait: 1 },
  });
  const call = createProviderCallOptions({
    providerName: family,
    settings,
    config: runtime.config,
    runtime,
    invocation,
    contents: { async *[Symbol.asyncIterator]() {} },
  });
  return {
    runtime,
    invocation,
    resolved: { ...call.resolved, model: MODELS[family] },
  };
}

async function drainText(
  stream: AsyncIterableIterator<IContent>,
): Promise<string> {
  let text = '';
  for await (const chunk of stream)
    for (const block of chunk.blocks)
      if (block.type === 'text') text += block.text;
  return text;
}

type Wrap = 'direct' | 'compression-lb' | 'provider-lb';

/**
 * Builds the options exactly as the compression code does: a summary request
 * selection over journal rows, no projection token, passed through
 * buildCompressionChatOptions.
 */
async function summaryCall(family: Family, wrap: Wrap) {
  const { runtime, invocation, resolved } = runtimeFor(family);
  const concrete = makeProvider(family);
  const journal = journalRows();
  const request = diskSummaryRequestSelection(
    journal,
    { top: 0, bottom: journal.length, injection: [] },
    'Summarize this conversation.',
    [],
    new RowOwnership(),
  );
  let provider: IProvider = concrete;
  if (wrap === 'compression-lb') {
    provider = new CompressionLoadBalancingProvider(
      'round-robin',
      [
        {
          profileName: 'member',
          provider: concrete,
          runtime,
          config: runtime.config,
          resolved,
          invocation,
        },
      ],
      0,
      'non-interactive',
    );
  } else if (wrap === 'provider-lb') {
    const manager = new ProviderManager({
      settingsService: runtime.settingsService,
      config: runtime.config,
    });
    manager.getProviderByName = (name) =>
      name === concrete.name ? concrete : undefined;
    provider = new LoadBalancingProvider(
      {
        profileName: 'tokenless-lb',
        strategy: 'round-robin',
        lbProfileEphemeralSettings: {},
        subProfiles: [
          {
            name: 'member',
            providerName: concrete.name,
            model: MODELS[family],
            baseURL: undefined,
            authToken: 'test-key',
            ephemeralSettings: { streaming: 'disabled' },
            modelParams: {},
          },
        ],
      },
      manager,
    );
  }
  const options = await buildCompressionChatOptions({
    requestRows: request,
    providerRuntime: runtime,
    resolvedConfig: runtime.config,
    fallbackConfig: runtime.config,
    resolvedOptions: resolved,
    invocation,
    fallbackModel: MODELS[family],
    runtimeState: { model: MODELS[family] } as never,
    provider,
    source: 'tokenless-test',
  });
  expect(options.requestRows).toBeDefined();
  expect(options.promptEnvelopeTransportToken).toBeUndefined();

  const rowsAsArray: IContent[] = [];
  for await (const row of request.openReader()) rowsAsArray.push(row);
  const { requestRows: _rows, ...withoutRows } = options;
  const reference = {
    ...withoutRows,
    contents: {
      async *[Symbol.asyncIterator]() {
        yield* rowsAsArray;
      },
    },
    contentCount: rowsAsArray.length,
  };
  return { provider, options, reference, concrete };
}

describe('compression summary requestRows without a projection token', () => {
  for (const wrap of ['direct', 'compression-lb', 'provider-lb'] as const) {
    describe(`through ${wrap}`, () => {
      for (const family of FAMILIES) {
        it(`${family}: sends the summary, returns it, and matches the reference bytes`, async () => {
          const bodies = fakeTransport(family);
          const { provider, options, reference } = await summaryCall(
            family,
            wrap,
          );

          const summary = await drainText(
            provider.generateChatCompletion(options),
          );
          expect(summary).toContain(SUMMARY);
          expect(bodies).toHaveLength(1);

          const referenceSummary = await drainText(
            provider.generateChatCompletion(reference),
          );
          expect(referenceSummary).toContain(SUMMARY);
          expect(bodies).toHaveLength(2);
          expect(bodies[0]).toBe(bodies[1]);
        }, 60_000);
      }
    });
  }
});
