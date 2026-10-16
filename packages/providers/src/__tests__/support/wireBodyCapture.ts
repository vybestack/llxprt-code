/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A1: drives the real provider send paths against a fake HTTP
 * transport (a stubbed global `fetch`) and records the exact request bytes and
 * whether the request carried a Content-Length header.
 *
 * Nothing under the providers is mocked. The stub sits where the network
 * would, so the SDK clients and the hand-written Responses transport both run
 * their production code up to the socket.
 */

import { readAtOf } from '../requestRowsTestSupport.js';
import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { createOpenAIAliasProvider } from '../../composition/aliasProviderFactory.js';
import type { ProviderAliasEntry } from '../../composition/providerAliases.js';
import { declaredMediaTransportCapabilities } from '../../providerMediaTransportCapabilities.js';
import { AnthropicProvider } from '../../anthropic/AnthropicProvider.js';
import { OpenAIProvider } from '../../openai/OpenAIProvider.js';
import { OpenAIResponsesProvider } from '../../openai-responses/OpenAIResponsesProvider.js';
import type { GenerateChatOptions, IProvider } from '../../IProvider.js';
import { TEST_PROVIDER_CONFIG } from '../providerTestConfig.js';
import { streamCallOptions } from '../streamCallOptions.js';
import type { HistoryCase } from './wireBodyHistories.js';

/**
 * `stream`: the provider reads `options.contents` (a one-shot row stream).
 * `rows`: the provider reads `options.requestRows` (a replayable selection).
 */
export type RowSource = 'stream' | 'rows';

export interface CapturedWireRequest {
  readonly url: string;
  readonly bytes: Uint8Array;
  readonly contentLength: string | null;
}

export interface WireBodyRecord {
  readonly sha256: string;
  readonly length: number;
  /** Exact decoded UTF-8 body text, kept only for small bodies. */
  readonly body?: string;
  readonly contentLength: 'present' | 'absent';
}

export interface MediaBinding {
  readonly resolver: RequestMediaResolver;
  readonly budgetBytes: number;
}

export interface WireRoute {
  readonly id: string;
  readonly providerName: string;
  readonly model: string;
  readonly baseURL: string;
  /** Path suffix of the one model request the route sends. */
  readonly endpoint: string;
  readonly ephemerals: Readonly<Record<string, unknown>>;
  /** Provider-scoped settings, where the Anthropic prompt-caching mode lives. */
  readonly providerSettings?: Readonly<Record<string, unknown>>;
  readonly respond: () => Response;
  readonly createProvider: () => IProvider;
}

const API_KEY = 'test-api-key';

function chatCompletionResponse(): Response {
  return Response.json({
    id: 'chatcmpl-golden',
    object: 'chat.completion',
    created: 1,
    model: 'golden',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'ok' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

function responsesStreamResponse(): Response {
  return new Response(
    'data: {"type":"response.output_text.delta","delta":"ok"}\n\n' +
      'data: {"type":"response.completed","response":{"id":"resp_golden","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function anthropicMessageResponse(): Response {
  return Response.json({
    id: 'msg_golden',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

function kimiAliasProvider(): IProvider {
  const entry = {
    alias: 'kimi',
    filePath: '/registered/kimi.config',
    source: 'builtin',
    config: {
      baseProvider: 'openai',
      'base-url': 'https://api.kimi.test/v1',
      mediaSupport: {
        inlineImages: true,
        fileUpload: false,
        videoSupport: false,
      },
      mediaTransportCapabilities: declaredMediaTransportCapabilities('kimi'),
    },
  } satisfies ProviderAliasEntry;
  return createOpenAIAliasProvider(entry, API_KEY, undefined, {}, false);
}

const CHAT_NO_STREAM = { streaming: 'disabled' } as const;

export const WIRE_ROUTES: readonly WireRoute[] = [
  {
    id: 'openai-chat-plain',
    providerName: 'openai',
    model: 'gpt-4o',
    baseURL: 'https://api.openai.test/v1',
    endpoint: '/chat/completions',
    ephemerals: CHAT_NO_STREAM,
    respond: chatCompletionResponse,
    createProvider: () =>
      new OpenAIProvider(API_KEY, 'https://api.openai.test/v1'),
  },
  {
    id: 'openai-chat-kimi',
    providerName: 'kimi',
    model: 'kimi-k3',
    baseURL: 'https://api.kimi.test/v1',
    endpoint: '/chat/completions',
    ephemerals: CHAT_NO_STREAM,
    respond: chatCompletionResponse,
    createProvider: kimiAliasProvider,
  },
  {
    id: 'openai-chat-mistral',
    providerName: 'openai',
    model: 'mistral-large-latest',
    baseURL: 'https://api.mistral.ai/v1',
    endpoint: '/chat/completions',
    ephemerals: CHAT_NO_STREAM,
    respond: chatCompletionResponse,
    createProvider: () =>
      new OpenAIProvider(API_KEY, 'https://api.mistral.ai/v1'),
  },
  {
    id: 'openai-responses-via-openai',
    providerName: 'openai',
    model: 'gpt-5.6',
    baseURL: 'https://api.openai.com/v1',
    endpoint: '/responses',
    ephemerals: { 'prompt-caching': 'off' },
    respond: responsesStreamResponse,
    createProvider: () =>
      new OpenAIProvider(API_KEY, 'https://api.openai.com/v1'),
  },
  {
    id: 'openai-responses',
    providerName: 'openai-responses',
    model: 'gpt-5.2',
    baseURL: 'https://api.openai.com/v1',
    endpoint: '/responses',
    ephemerals: { 'prompt-caching': 'off' },
    respond: responsesStreamResponse,
    createProvider: () =>
      new OpenAIResponsesProvider(API_KEY, 'https://api.openai.com/v1'),
  },
  {
    id: 'anthropic-cache-1h',
    providerName: 'anthropic',
    model: 'claude-opus-5',
    baseURL: 'https://api.anthropic.com',
    endpoint: '/v1/messages',
    ephemerals: { streaming: 'disabled' },
    providerSettings: { 'prompt-caching': '1h' },
    respond: anthropicMessageResponse,
    createProvider: () =>
      new AnthropicProvider(API_KEY, undefined, TEST_PROVIDER_CONFIG),
  },
  {
    id: 'anthropic-cache-off',
    providerName: 'anthropic',
    model: 'claude-opus-5',
    baseURL: 'https://api.anthropic.com',
    endpoint: '/v1/messages',
    ephemerals: { streaming: 'disabled' },
    providerSettings: { 'prompt-caching': 'off' },
    respond: anthropicMessageResponse,
    createProvider: () =>
      new AnthropicProvider(API_KEY, undefined, TEST_PROVIDER_CONFIG),
  },
];

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function readBodyBytes(
  body: BodyInit | null | undefined,
): Promise<Uint8Array> {
  if (body === null || body === undefined) return new Uint8Array();
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** Installs the fake HTTP transport; call the returned restore in `finally`. */
export function installFakeTransport(
  route: WireRoute,
  captured: CapturedWireRequest[],
): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = requestUrl(input);
      const body = init?.body ?? (input instanceof Request ? input.body : null);
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      captured.push({
        url,
        bytes: await readBodyBytes(body),
        contentLength: headers.get('content-length'),
      });
      return route.respond();
    },
    { preconnect: original.preconnect },
  );
  return () => {
    globalThis.fetch = original;
  };
}

export function rowsSelection(
  rows: readonly IContent[],
): ProviderRequestSelection {
  return Object.freeze({
    count: rows.length,
    readAt: readAtOf(rows),
    openReader: (signal?: AbortSignal) =>
      (async function* (): AsyncGenerator<IContent, void> {
        for (const row of rows) {
          signal?.throwIfAborted();
          yield structuredClone(row);
        }
      })(),
    close: () => undefined,
  });
}

/** Everything about a history case except its rows. */
export type HistoryRequestShape = Omit<
  HistoryCase,
  'id' | 'description' | 'rows'
>;

/**
 * The call options one route sends for a history. The caller supplies the row
 * stream, so a probe can feed rows from disk instead of from an array.
 */
export function buildRouteCallOptions(
  route: WireRoute,
  shape: HistoryRequestShape,
  contents: readonly IContent[] | AsyncIterable<IContent>,
  settings: SettingsService,
): GenerateChatOptions {
  return streamCallOptions({
    providerName: route.providerName,
    settings,
    contents,
    ...(shape.tools === undefined ? {} : { tools: shape.tools }),
    ...(shape.systemInstruction === undefined
      ? {}
      : { systemInstruction: shape.systemInstruction }),
    runtimeId: `wire-body-golden.${route.id}`,
    ephemerals: { ...route.ephemerals, ...shape.ephemerals },
    settingsOverrides: {
      ...(route.providerSettings === undefined
        ? {}
        : { provider: { ...route.providerSettings } }),
      ...(shape.globalSettings === undefined
        ? {}
        : { global: { ...shape.globalSettings } }),
    },
    resolved: {
      model: route.model,
      baseURL: route.baseURL,
      authToken: API_KEY,
    },
  });
}

function buildOptions(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  settings: SettingsService,
): GenerateChatOptions {
  const options = buildRouteCallOptions(
    route,
    history,
    history.rows.map((row) => structuredClone(row)),
    settings,
  );
  if (source === 'stream') return options;
  return {
    ...options,
    requestRows: rowsSelection(history.rows),
    contentCount: history.rows.length,
  };
}

export function singleModelRequest(
  route: WireRoute,
  captured: readonly CapturedWireRequest[],
): CapturedWireRequest {
  const modelRequests = captured.filter((request) =>
    new URL(request.url).pathname.endsWith(route.endpoint),
  );
  if (modelRequests.length !== 1) {
    throw new Error(
      `route ${route.id}: expected one ${route.endpoint} request, saw ${modelRequests.length} of ${captured.length} requests`,
    );
  }
  return modelRequests[0];
}

/** Largest body stored verbatim next to its hash. */
export const MAX_STORED_BODY_BYTES = 16 * 1024;

export function recordOf(request: CapturedWireRequest): WireBodyRecord {
  const length = request.bytes.byteLength;
  const sha256 = createHash('sha256').update(request.bytes).digest('hex');
  const contentLength = request.contentLength === null ? 'absent' : 'present';
  if (request.contentLength !== null && request.contentLength !== `${length}`) {
    throw new Error(
      `content-length ${request.contentLength} differs from the ${length} body bytes sent`,
    );
  }
  if (length > MAX_STORED_BODY_BYTES) {
    return { sha256, length, contentLength };
  }
  const body = new TextDecoder('utf-8', { fatal: true }).decode(request.bytes);
  return { sha256, length, body, contentLength };
}

export async function sendThroughRoute(
  route: WireRoute,
  history: HistoryCase,
  source: RowSource,
  media?: MediaBinding,
): Promise<CapturedWireRequest> {
  const captured: CapturedWireRequest[] = [];
  const restore = installFakeTransport(route, captured);
  try {
    const settings = new SettingsService();
    const created = route.createProvider();
    const provider =
      media === undefined
        ? created
        : bindProviderMedia(created, media.resolver, media.budgetBytes);
    const options = buildOptions(route, history, source, settings);
    for await (const chunk of provider.generateChatCompletion(options)) {
      void chunk;
    }
  } finally {
    restore();
  }
  return singleModelRequest(route, captured);
}
