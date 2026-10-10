/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { streamCallOptions } from '../__tests__/streamCallOptions.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createOpenAIAliasProvider } from '../composition/aliasProviderFactory.js';
import type { ProviderAliasEntry } from '../composition/providerAliases.js';
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import { OpenAIProvider } from './OpenAIProvider.js';
import { OpenAIResponsesProvider } from '../openai-responses/OpenAIResponsesProvider.js';
import {
  resetCliRuntimeRegistryForTesting,
  runtimeRegistry,
  upsertRuntimeEntry,
} from '../runtime/runtimeRegistry.js';

function inputUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function bodyText(body: BodyInit | null | undefined): Promise<string> {
  if (body === null || body === undefined) return '';
  return new Response(body).text();
}

function isRecordedChatRequest(value: unknown): value is RecordedChatRequest {
  return typeof value === 'object' && value !== null;
}

function createKimiProvider(): OpenAIProvider {
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

function mediaHistory(includeImage: boolean): IContent[] {
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

async function send(
  provider: OpenAIProvider,
  settings: SettingsService,
  contents: IContent[],
  runtimeId: string,
): Promise<IContent[]> {
  if (!runtimeRegistry.has(runtimeId)) upsertRuntimeEntry(runtimeId, {});
  const output: IContent[] = [];
  const iterator = provider.generateChatCompletion(
    streamCallOptions({
      providerName: 'kimi',
      settings,
      contents,
      runtimeId,
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

interface FetchRoute {
  readonly match: string;
  readonly respond: () => Response;
}

function routedFetch(
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

interface RecordedChatRequest {
  readonly model?: unknown;
  readonly messages?: unknown;
  readonly prompt_cache_key?: unknown;
}

const originalFetch = globalThis.fetch;

describe('OpenAIProvider', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetCliRuntimeRegistryForTesting();
  });

  /**
   * Builds a fetch stub that dispatches on URL substring. Tests declare their
   * routes instead of writing the dispatch inline, which is what
   * jest/no-conditional-in-test is pointing at (#3129): the branching belongs to
   * the stub, not to the test body.
   */

  describe('Kimi explicit Files failures', () => {
    registerProviderBehavior1();
  });

  describe('Kimi deterministic cache transport', () => {
    registerProviderBehavior2();

    registerProviderBehavior3();

    registerProviderBehavior4();

    registerProviderBehavior5();

    registerProviderBehavior6();

    registerProviderBehavior7();

    registerProviderBehavior8();
  });
});

function registerProviderBehavior1(): void {
  describe('provider fixture 1', () => {
    it('fails before chat submission when an explicitly enabled upload rejects', async () => {
      let chatSubmissions = 0;
      globalThis.fetch = routedFetch([
        {
          match: '/files',
          respond: () => new Response('rate limited', { status: 429 }),
        },
        {
          match: '/chat/completions',
          respond: () => {
            chatSubmissions += 1;
            return new Response('unexpected request', { status: 500 });
          },
        },
      ]);
      const provider = createKimiProvider();
      const settings = new SettingsService();
      settings.set('provider-files', 'workspace');
      settings.set('kimi.experimental-video', true);

      await expect(
        send(provider, settings, mediaHistory(false), 'runtime-upload-failure'),
      ).rejects.toThrow(
        'Kimi file upload failed for clip.mp4 (video/mp4): 429 rate limited',
      );
      expect(chatSubmissions).toBe(0);
    });
  });
}

function registerProviderBehavior2(): void {
  describe('provider fixture 2', () => {
    it('keeps affinity, system prefix, and ms references stable across replay and media changes', async () => {
      const recorded: RecordedChatRequest[] = [];
      installKimiTransportFixture1(recorded);
      const provider = createKimiProvider();
      const settings = new SettingsService();
      settings.set('provider-files', 'session');
      settings.set('kimi.experimental-video', true);

      const exact = mediaHistory(true);
      const appended: IContent[] = [
        ...exact,
        { speaker: 'human', blocks: [{ type: 'text', text: 'next turn' }] },
      ];
      const outputs = [
        await send(provider, settings, exact, 'runtime-a'),
        await send(provider, settings, exact, 'runtime-a'),
        await send(provider, settings, appended, 'runtime-a'),
        await send(provider, settings, mediaHistory(false), 'runtime-a'),
        await send(provider, settings, mediaHistory(false), 'runtime-b'),
      ];

      const keys = recorded
        .slice(0, 4)
        .map((request) => request.prompt_cache_key);
      expect(new Set(keys).size).toBe(1);
      expect(keys[0]).toBe('runtime-a');
      expect(recorded[4].prompt_cache_key).toBe('runtime-b');
      const messageLists = recorded.map((request) => request.messages);
      if (!messageLists.every(Array.isArray)) {
        throw new Error('Expected Kimi requests to carry message arrays');
      }
      expect(messageLists[1]).toStrictEqual(messageLists[0]);
      expect(messageLists[2].slice(0, messageLists[0].length)).toStrictEqual(
        messageLists[0],
      );
      const serialized = messageLists.map((messages) =>
        JSON.stringify(messages),
      );
      expect(
        serialized.every((messages) =>
          messages.includes('stable system prompt'),
        ),
      ).toBe(true);
      expect(
        serialized
          .slice(0, 4)
          .every((messages) => messages.includes('ms://file-stable-video')),
      ).toBe(true);
      expect(serialized[3]).not.toContain('data:image/png;base64,QUJD');
      const cachedTokenTotal = outputs
        .flatMap((output) => output)
        .reduce(
          (total, content) =>
            total + (content.metadata?.usage?.cachedTokens ?? 0),
          0,
        );
      expect(cachedTokenTotal).toBe(35);
    });
  });
}

function registerProviderBehavior3(): void {
  describe('provider fixture 3', () => {
    it('makes no Files request before explicit workspace opt-in', async () => {
      const recorded: string[] = [];
      const requestedUrls: string[] = [];
      globalThis.fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          const url = inputUrl(input);
          requestedUrls.push(url);
          if (url.includes('/files')) {
            return Response.json({
              id: 'file-explicit-pdf',
              object: 'file',
              bytes: 3,
              created_at: 1,
              filename: 'notes.pdf',
              purpose: 'file-extract',
              status: 'processed',
            });
          }
          const body =
            init?.body ?? (input instanceof Request ? input.body : null);
          recorded.push(await bodyText(body));
          return Response.json({
            id: `chat-pdf-${recorded.length}`,
            object: 'chat.completion',
            created: 1,
            model: 'kimi-k3',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { preconnect: originalFetch.preconnect },
      );
      const provider = createKimiProvider();
      const settings = new SettingsService();
      const contents: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'read this' },
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'application/pdf',
              data: 'QUJD',
              filename: 'notes.pdf',
            },
          ],
        },
      ];

      await send(provider, settings, contents, 'runtime-files');
      const requestsBeforeOptIn = [...requestedUrls];
      settings.set('provider-files', 'workspace');
      await send(provider, settings, contents, 'runtime-files');

      const chatRequests = recorded.filter((body) =>
        body.includes('"messages"'),
      );
      expect(requestsBeforeOptIn.some((url) => url.includes('/files'))).toBe(
        false,
      );
      expect(chatRequests).toHaveLength(2);
      expect(chatRequests[0]).not.toContain('file-explicit-pdf');
      expect(chatRequests[1]).toContain('file-explicit-pdf');
      expect(chatRequests[1]).toContain('stable system prompt');
    });
  });
}

function registerProviderBehavior4(): void {
  describe('provider fixture 4', () => {
    it('uploads and binds a selected prepared Kimi projection exactly once', async () => {
      const requestedUrls: string[] = [];
      const boundFileIds: string[] = [];
      installKimiTransportFixture2(requestedUrls);
      const provider = createKimiProvider();
      const settings = new SettingsService();
      settings.set('provider-files', 'workspace');
      const contents: IContent[] = [
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'read this' },
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'application/pdf',
              data: 'QUJD',
              filename: 'notes.pdf',
              sourceContentId:
                'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            },
          ],
        },
      ];
      const runtimeId = 'runtime-projection';
      upsertRuntimeEntry(runtimeId, {});
      const options = streamCallOptions({
        providerName: 'kimi',
        settings,
        contents,
        runtime: {
          settingsService: settings,
          runtimeId,
          providerFileBindings: {
            bind: async (_contentId, reference) => {
              boundFileIds.push(reference.fileId);
            },
            unbind: async (_contentId, reference) => {
              const retained = boundFileIds.filter(
                (fileId) => fileId !== reference.fileId,
              );
              boundFileIds.splice(0, boundFileIds.length, ...retained);
            },
          },
        },
        configOverrides: { getTargetDir: () => '/workspace/projection' },
        systemInstruction: 'stable system prompt',
        resolved: {
          model: 'kimi-k3',
          baseURL: 'https://api.kimi.test/v1',
          authToken: 'test-key',
        },
      });

      const projection = await provider.projectPromptEnvelope(options);
      for await (const content of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        void content;
      }

      expect(projection.protocol).toBe('openai-chat');
      expect(
        requestedUrls.filter((url) => url.includes('/files')),
      ).toHaveLength(1);
      expect(boundFileIds).toStrictEqual(['file-prepared-projection']);
    });
  });
}

function registerProviderBehavior5(): void {
  describe('provider fixture 5', () => {
    it('propagates provider-file maintenance failures without switching transport', async () => {
      const runtimeId = 'runtime-maintenance-failure';
      const entry = upsertRuntimeEntry(runtimeId, {});
      const retained = await entry.providerFileLifecycle.retain({
        cacheKey: 'failed-cleanup-content',
        fileId: 'failed-cleanup-file',
        bytes: 3,
        identity: {
          provider: 'kimi',
          baseURL: 'https://api.kimi.test/v1',
          credentialHash: 'maintenance-credential',
        },
        policy: {
          mode: 'enabled',
          scope: 'session',
          retentionMs: 60_000,
          deletion: 'delete',
          zeroDataRetention: 'incompatible-while-retained',
        },
        scopeId: runtimeId,
        deleteRemote: async () => {
          throw new Error('maintenance delete unavailable');
        },
      });
      await retained.lease.release();
      await entry.providerFileLifecycle.cleanupScope('session', runtimeId);
      globalThis.fetch = Object.assign(
        async () => {
          throw new Error('transport must not run after maintenance failure');
        },
        { preconnect: originalFetch.preconnect },
      );
      const settings = new SettingsService();
      settings.set('provider-files', 'session');

      const request = send(
        createKimiProvider(),
        settings,
        [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                encoding: 'base64',
                mimeType: 'application/pdf',
                data: 'QUJD',
              },
            ],
          },
        ],
        runtimeId,
      );

      await expect(request).rejects.toThrow('failed-cleanup-file');
    });
  });
}

function registerProviderBehavior6(): void {
  describe('provider fixture 6', () => {
    it('streams exact bounded JSON bytes through the real Kimi Chat entry', async () => {
      let wireBody = '';
      let streamed = false;
      const contentLength: { value: string | null } = { value: null };
      globalThis.fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          const body =
            init?.body ?? (input instanceof Request ? input.body : null);
          streamed = body instanceof ReadableStream;
          contentLength.value = new Headers(init?.headers).get(
            'content-length',
          );

          wireBody = await bodyText(body);
          return Response.json({
            id: 'chat-bounded',
            object: 'chat.completion',
            created: 1,
            model: 'kimi-k3',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'ok' },
                finish_reason: 'stop',
              },
            ],
          });
        },
        { preconnect: originalFetch.preconnect },
      );
      const provider = createKimiProvider();
      const contents: IContent[] = [
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

      await send(
        provider,
        new SettingsService(),
        contents,
        'runtime-bounded-chat',
      );

      expect(streamed).toBe(true);
      expect(contentLength.value).toBe(
        String(new TextEncoder().encode(wireBody).byteLength),
      );
      expect(wireBody).toBe(JSON.stringify(JSON.parse(wireBody)));
      expect(wireBody).toContain('data:image/png;base64,QUJD');
    });
  });
}

function registerProviderBehavior7(): void {
  describe('provider fixture 7', () => {
    it('releases request media ownership when Chat upload is cancelled', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'llxprt-kimi-cancel-'));
      try {
        const store = new LocalMediaStore({
          rootDirectory: directory,
          quotaBytes: 1024,
        });
        const reference = await store.admit({
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        const resolver = new RequestMediaResolver(store);
        const controller = new AbortController();
        globalThis.fetch = Object.assign(
          async (
            _input: Parameters<typeof fetch>[0],
            init: Parameters<typeof fetch>[1],
          ) => {
            controller.abort();
            const error = new Error('cancelled transport');
            error.name = 'AbortError';
            if (init?.body instanceof ReadableStream) {
              await init.body.cancel(error);
            }
            throw error;
          },
          { preconnect: originalFetch.preconnect },
        );
        const provider = createKimiProvider();
        const options = streamCallOptions({
          providerName: 'kimi',
          contents: [{ speaker: 'human', blocks: [reference] }],
          metadata: { abortSignal: controller.signal },
          runtime: {
            settingsService: new SettingsService(),
            runtimeId: 'runtime-cancelled-chat',
            mediaResolver: resolver,
            requestMediaBudgetBytes: reference.normalizedBase64Length,
          },
          ephemerals: { streaming: 'disabled' },
          resolved: {
            model: 'kimi-k3',
            baseURL: 'https://api.kimi.test/v1',
            authToken: 'test-key',
          },
        });

        const error = await (async (): Promise<unknown> => {
          try {
            for await (const content of provider.generateChatCompletion(
              options,
            )) {
              void content;
            }
            return undefined;
          } catch (reason) {
            return reason;
          }
        })();

        expect(error).toBeInstanceOf(Error);
        expect(resolver.accounting()).toStrictEqual({
          activeRequestCount: 0,
          reservedContentCount: 0,
          materializedNormalizedBytes: 0,
          storeReadCount: 1,
        });
        expect(await store.hasReservations(reference.contentId)).toBe(false);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  });
}

function registerProviderBehavior8(): void {
  describe('provider fixture 8', () => {
    it('streams a bounded JSON body on a declared Responses HTTP transport', async () => {
      let wireBody = '';

      let streamed = false;
      let contentLength: string | null = 'missing';
      globalThis.fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init: Parameters<typeof fetch>[1],
        ) => {
          const body =
            init?.body ?? (input instanceof Request ? input.body : null);
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
      const contents: IContent[] = [
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
      const iterator = provider.generateChatCompletion(
        streamCallOptions({
          providerName: provider.name,
          contents,
          resolved: {
            model: 'gpt-5.5',
            baseURL: 'https://api.openai.com/v1',
            authToken: 'test-key',
          },
        }),
      );

      for await (const content of iterator) void content;

      expect(streamed).toBe(true);
      // The body is pulled on demand, so its length is unknown when headers
      // are sent and the request goes out chunked instead of with a length.
      expect(contentLength).toBeNull();
      expect(new TextEncoder().encode(wireBody).byteLength).toBeGreaterThan(0);
      expect(wireBody).toBe(JSON.stringify(JSON.parse(wireBody)));
      expect(wireBody).toContain('data:image/png;base64,QUJD');
    });
  });
}

function installKimiTransportFixture1(recorded: RecordedChatRequest[]): void {
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init: Parameters<typeof fetch>[1],
    ) => {
      const url = inputUrl(input);
      if (url.includes('/files')) {
        return Response.json({
          id: 'file-stable-video',
          object: 'file',
          bytes: 5,
          created_at: 1,
          filename: 'clip.mp4',
          purpose: 'video',
          status: 'processed',
        });
      }
      const body = init?.body ?? (input instanceof Request ? input.body : null);
      const parsed: unknown = JSON.parse(await bodyText(body));
      if (!isRecordedChatRequest(parsed)) {
        return new Response('invalid fixture request', { status: 400 });
      }
      recorded.push(parsed);
      return Response.json({
        id: `chat-${recorded.length}`,
        object: 'chat.completion',
        created: 1,
        model: 'kimi-k3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 1,
          total_tokens: 11,
          cached_tokens: 7,
        },
      });
    },
    { preconnect: originalFetch.preconnect },
  );
}

function installKimiTransportFixture2(requestedUrls: string[]): void {
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0]) => {
      const url = inputUrl(input);
      requestedUrls.push(url);
      if (url.includes('/files')) {
        return Response.json({
          id: 'file-prepared-projection',
          object: 'file',
          bytes: 3,
          created_at: 1,
          filename: 'notes.pdf',
          purpose: 'file-extract',
          status: 'processed',
        });
      }
      return Response.json({
        id: 'chat-prepared-projection',
        object: 'chat.completion',
        created: 1,
        model: 'kimi-k3',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'ok' },
            finish_reason: 'stop',
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
}
