/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bindProviderFiles } from '@vybestack/llxprt-code-core/runtime/bindProviderFiles.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import { streamCallOptions } from '../../../__tests__/streamCallOptions.js';
import { createOpenAIAliasProvider } from '../../../composition/aliasProviderFactory.js';
import type { ProviderAliasEntry } from '../../../composition/providerAliases.js';
import { declaredMediaTransportCapabilities } from '../../../providerMediaTransportCapabilities.js';
import { ProviderFileLifecycle } from '../../../providerFilePolicy.js';
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
        settingsService: settings,
        runtimeId,
        providerFileLifecycle: lifecycle,
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
