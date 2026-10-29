/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { readAtOf } from '../../../__tests__/requestRowsTestSupport.js';
import { bindProviderFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderFiles.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { streamCallOptions } from '../../../__tests__/streamCallOptions.js';
import { createOpenAIAliasProvider } from '../../../composition/aliasProviderFactory.js';
import type { ProviderAliasEntry } from '../../../composition/providerAliases.js';
import { declaredMediaTransportCapabilities } from '../../../providerMediaTransportCapabilities.js';
import { ProviderFileLifecycle } from '../../../providerFilePolicy.js';
import { OpenAIResponsesProvider } from '../../../openai-responses/OpenAIResponsesProvider.js';
import type { OpenAIProvider } from '../../OpenAIProvider.js';

export function inputUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export async function bodyText(
  body: BodyInit | null | undefined,
): Promise<string> {
  if (body === null || body === undefined) return '';
  return new Response(body).text();
}

export function isRecordedChatRequest(
  value: unknown,
): value is RecordedChatRequest {
  return typeof value === 'object' && value !== null;
}

export function createKimiProvider(): OpenAIProvider {
  const entry = {
    alias: 'kimi',
    filePath: '/registered/kimi.config',
    source: 'builtin',
    config: {
      baseProvider: 'openai',
      'base-url': 'https://api.kimi.test/v1',
      mediaSupport: {
        inlineImages: true,
        fileUpload: true,
        videoSupport: true,
      },
      mediaTransportCapabilities: declaredMediaTransportCapabilities('kimi'),
    },
  } satisfies ProviderAliasEntry;
  const provider = createOpenAIAliasProvider(
    entry,
    'test-key',
    undefined,
    {},
    false,
  );
  return provider;
}

export function mediaHistory(includeImage: boolean): IContent[] {
  const blocks: IContent['blocks'] = [{ type: 'text', text: 'inspect media' }];
  if (includeImage) {
    blocks.push({
      type: 'media',
      encoding: 'base64',
      mimeType: 'image/png',
      data: 'QUJD',
    });
  }
  blocks.push({
    type: 'media',
    encoding: 'base64',
    mimeType: 'video/mp4',
    data: 'VklERU8=',
    filename: 'clip.mp4',
  });
  return [{ speaker: 'human', blocks }];
}

export async function send(
  provider: OpenAIProvider,
  settings: SettingsService,
  contents: IContent[],
  runtimeId: string,
  lifecycle = new ProviderFileLifecycle({
    maxFiles: 100,
    maxBytes: 512 * 1024 * 1024,
  }),
): Promise<IContent[]> {
  const output: IContent[] = [];
  const iterator = bindProviderFiles(
    provider,
    undefined,
    lifecycle,
    '/workspace/test',
  ).generateChatCompletion(
    streamCallOptions({
      providerName: 'kimi',
      settings,
      contents,
      runtime: {
        runtimeId,
      },
      configOverrides: { getTargetDir: () => '/workspace/test' },
      systemInstruction: 'stable system prompt',
      ephemerals: { streaming: 'disabled' },
      resolved: {
        model: 'kimi-k3',
        baseURL: 'https://api.kimi.test/v1',
        authToken: 'test-key',
      },
    }),
  );
  for await (const content of iterator) output.push(content);
  return output;
}

export interface FetchRoute {
  readonly match: string;
  readonly respond: () => Response;
}

export function routedFetch(
  routes: readonly FetchRoute[],
  fallback: () => Response = () =>
    new Response('unexpected request', { status: 500 }),
): typeof globalThis.fetch {
  return Object.assign(
    async (input: string | URL | Request) => {
      const url = inputUrl(input);
      const route = routes.find((candidate) => url.includes(candidate.match));
      return route === undefined ? fallback() : route.respond();
    },
    { preconnect: originalFetch.preconnect },
  );
}

export interface RecordedChatRequest {
  readonly model?: unknown;
  readonly messages?: unknown;
  readonly prompt_cache_key?: unknown;
}

export const originalFetch = globalThis.fetch;

export interface ResponsesWireCapture {
  readonly streamed: boolean;
  readonly contentLength: string | null;
  readonly wireBody: string;
}

const RESPONSES_MEDIA_HISTORY: readonly IContent[] = [
  {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'describe' },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'QUJD',
      },
    ],
  },
];

/**
 * Sends the media history through the real `openai-responses` provider and
 * records what the transport was handed. `rows` supplies the replayable
 * request rows the disk text route reads; without it the provider reads the
 * one-shot `contents` stream.
 */
export async function captureResponsesWire(
  source: 'contents' | 'rows',
): Promise<ResponsesWireCapture> {
  let wireBody = '';
  let streamed = false;
  let contentLength: string | null = 'missing';
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      const body = init?.body ?? (input instanceof Request ? input.body : null);
      streamed = body instanceof ReadableStream;
      contentLength = new Headers(init?.headers).get('content-length');
      wireBody = await bodyText(body);
      return new Response(
        'data: {"type":"response.completed","response":{"id":"resp-streamed","status":"completed","usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\n',
        { status: 200 },
      );
    },
    { preconnect: originalFetch.preconnect },
  );
  const provider = new OpenAIResponsesProvider(
    'test-key',
    'https://api.openai.com/v1',
  );
  const options = streamCallOptions({
    providerName: provider.name,
    contents: [...RESPONSES_MEDIA_HISTORY],
    resolved: {
      model: 'gpt-5.5',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test-key',
    },
  });
  const rows: ProviderRequestSelection = {
    callerOwned: true,
    count: RESPONSES_MEDIA_HISTORY.length,
    readAt: readAtOf(RESPONSES_MEDIA_HISTORY),
    openReader: (): AsyncGenerator<IContent, void> =>
      (async function* (): AsyncGenerator<IContent, void> {
        for (const row of RESPONSES_MEDIA_HISTORY) yield structuredClone(row);
      })(),
    close: (): void => undefined,
  };
  const iterator = provider.generateChatCompletion(
    source === 'rows'
      ? { ...options, requestRows: rows, contentCount: rows.count }
      : options,
  );
  for await (const content of iterator) void content;
  return { streamed, contentLength, wireBody };
}
