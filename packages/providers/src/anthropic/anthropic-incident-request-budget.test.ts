/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984 incident regression: a conversation of 26 images whose
 * normalized size is 15,915,624 bytes (the newest image is 237,140 bytes)
 * crossed the 15 MiB request-media default and was rejected before sending.
 * This runs the real LocalMediaStore, RequestMediaResolver, AnthropicProvider
 * preparation, projection, and send path; only the HTTP boundary is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { createRuntimeConfigStub } from '@vybestack/llxprt-code-test-utils/core/runtime.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-test-utils/core/providerCallOptions.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import {
  RequestBodyByteOverflowError,
  RequestMediaByteOverflowError,
  RequestMediaResolver,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';
import { AnthropicProvider } from './AnthropicProvider.js';

const MODEL = 'claude-sonnet-4-20250514';
const BASE_URL = 'https://api.anthropic.com';
const INCIDENT_TOTAL_BYTES = 15_915_624;
const NEWEST_IMAGE_BYTES = 237_140;
const OLDER_IMAGE_COUNT = 25;
const FIFTEEN_MIB = 15 * 1024 * 1024;
const EXPLICIT_LARGER_BUDGET = 32_000_000;

const requestFetch: NetworkFetch = (input, init) =>
  globalThis.fetch(input, init);

/** Raw byte lengths (multiples of 3, so no padding) whose base64 sums to the incident. */
function incidentRawLengths(): number[] {
  const olderBase64Groups = (INCIDENT_TOTAL_BYTES - NEWEST_IMAGE_BYTES) / 4;
  const base = Math.floor(olderBase64Groups / OLDER_IMAGE_COUNT);
  const remainder = olderBase64Groups - base * OLDER_IMAGE_COUNT;
  const older = Array.from(
    { length: OLDER_IMAGE_COUNT },
    (_, index) => (base + (index < remainder ? 1 : 0)) * 3,
  );
  return [...older, (NEWEST_IMAGE_BYTES / 4) * 3];
}

function successfulResponse(): Response {
  return Response.json({
    id: 'msg_incident',
    type: 'message',
    role: 'assistant',
    model: MODEL,
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectImageData(value: unknown, found: string[]): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectImageData(item, found);
  } else if (isRecord(value)) {
    const source = value['source'];
    if (
      value['type'] === 'image' &&
      isRecord(source) &&
      typeof source['data'] === 'string'
    ) {
      found.push(source['data']);
    } else {
      for (const nested of Object.values(value)) {
        collectImageData(nested, found);
      }
    }
  }
  return found;
}

async function bodyText(body: BodyInit | null | undefined): Promise<string> {
  return body === null || body === undefined ? '' : new Response(body).text();
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to reject');
}

describe('Anthropic incident-sized request budget (issue #3984)', () => {
  const originalFetch = globalThis.fetch;
  let directory = '';

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-issue3984-'));
  });
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  });

  async function incidentHistory(
    store: LocalMediaStore,
    rawLengths: readonly number[],
  ): Promise<{
    readonly contents: IContent[];
    readonly expectedBase64: string[];
    readonly total: number;
  }> {
    const references: MediaReferenceBlock[] = [];
    const expectedBase64: string[] = [];
    for (const [index, length] of rawLengths.entries()) {
      const bytes = new Uint8Array(length).fill(index + 1);
      expectedBase64.push(Buffer.from(bytes).toString('base64'));
      references.push(
        await store.admit({
          bytes,
          mimeType: 'image/png',
          semanticMetadata: {},
        }),
      );
    }
    return {
      contents: references.map((reference, index) => ({
        speaker: 'human',
        metadata: { turnId: `turn-image-${index}` },
        blocks: [{ type: 'text', text: `image ${index}` }, reference],
      })),
      expectedBase64,
      total: references.reduce(
        (sum, reference) => sum + reference.normalizedBase64Length,
        0,
      ),
    };
  }

  function prepared(
    contents: IContent[],
    resolver: RequestMediaResolver,
    budget: number | undefined,
  ): {
    readonly provider: AnthropicProvider;
    readonly options: ReturnType<typeof createProviderCallOptions>;
  } {
    const unbound = new AnthropicProvider('test-key', BASE_URL);
    const settings = new SettingsService();
    settings.setProviderSetting(unbound.name, 'model', MODEL);
    settings.setProviderSetting(unbound.name, 'streaming', 'disabled');
    settings.setProviderSetting(unbound.name, 'prompt-caching', 'off');
    const runtime = createProviderRuntimeContext({
      runtimeId: 'issue3984-runtime',
    });
    const invocation = createRuntimeInvocationContext({
      fetch: requestFetch,
      runtimeId: runtime.runtimeId,
      runtimeMetadata: runtime.metadata,
      providerName: unbound.name,
      ephemeralsSnapshot: {
        streaming: 'disabled',
        'prompt-caching': 'off',
        retries: 1,
        retrywait: 1,
      },
    });
    return {
      provider: bindProviderMedia(unbound, resolver, budget),
      options: createProviderCallOptions({
        providerName: unbound.name,
        contents,
        settings,
        config: createRuntimeConfigStub(settings),
        runtime,
        invocation,
        resolved: { model: MODEL, baseURL: BASE_URL, authToken: 'test-key' },
      }),
    };
  }

  async function send(
    provider: AnthropicProvider,
    options: ReturnType<typeof createProviderCallOptions>,
  ): Promise<void> {
    for await (const _content of provider.generateChatCompletion(options)) {
      // Drain the real provider parser.
    }
  }

  it('builds a fixture matching the reported 26-image, 15,915,624-byte request', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 64 * 1024 * 1024,
    });

    const { total, contents } = await incidentHistory(
      store,
      incidentRawLengths(),
    );

    expect([contents.length, total]).toStrictEqual([26, INCIDENT_TOTAL_BYTES]);
  });

  it('sends every history image and the newest image under an explicit larger budget with an exact content length', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 64 * 1024 * 1024,
    });
    const resolver = new RequestMediaResolver(store);
    const { contents, expectedBase64 } = await incidentHistory(
      store,
      incidentRawLengths(),
    );
    const sent: { body: string; contentLength: string | null } = {
      body: '',
      contentLength: null,
    };
    globalThis.fetch = async (_input, init): Promise<Response> => {
      sent.body = await bodyText(init?.body);
      sent.contentLength = new Headers(init?.headers).get('content-length');
      return successfulResponse();
    };
    const { provider, options } = prepared(
      contents,
      resolver,
      EXPLICIT_LARGER_BUDGET,
    );

    await send(provider, options);

    expect({
      images: collectImageData(JSON.parse(sent.body), []),
      contentLength: sent.contentLength,
    }).toStrictEqual({
      images: expectedBase64,
      contentLength: String(Buffer.byteLength(sent.body)),
    });
    expect(resolver.accounting().activeRequestCount).toBe(0);
  });

  it('keeps the direct provider boundary strict at its default 15 MiB media budget (producer retirement is covered separately)', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 64 * 1024 * 1024,
    });
    const resolver = new RequestMediaResolver(store);
    const { contents } = await incidentHistory(store, incidentRawLengths());
    let networkSubmissions = 0;
    globalThis.fetch = async (): Promise<Response> => {
      networkSubmissions += 1;
      return successfulResponse();
    };
    const { provider, options } = prepared(contents, resolver, undefined);

    const projectionError = await rejection(
      provider.projectPromptEnvelope(options),
    );
    const sendError = await rejection(send(provider, options));

    expect(projectionError).toMatchObject({
      totalBytes: INCIDENT_TOTAL_BYTES,
      budgetBytes: FIFTEEN_MIB,
    });
    expect(sendError).toBeInstanceOf(RequestMediaByteOverflowError);
    expect(networkSubmissions).toBe(0);
    expect(resolver.accounting().activeRequestCount).toBe(0);
  });

  it('rejects the incident request at projection and send with an explicit 15 MiB budget', async () => {
    const store = new LocalMediaStore({
      rootDirectory: join(directory, 'media'),
      quotaBytes: 64 * 1024 * 1024,
    });
    const resolver = new RequestMediaResolver(store);
    const { contents } = await incidentHistory(store, incidentRawLengths());
    let networkSubmissions = 0;
    globalThis.fetch = async (): Promise<Response> => {
      networkSubmissions += 1;
      return successfulResponse();
    };
    const { provider, options } = prepared(contents, resolver, FIFTEEN_MIB);

    const projectionError = await rejection(
      provider.projectPromptEnvelope(options),
    );
    const sendError = await rejection(send(provider, options));

    expect(projectionError).toBeInstanceOf(RequestMediaByteOverflowError);
    expect(sendError).toBeInstanceOf(RequestMediaByteOverflowError);
    expect(sendError).toMatchObject({
      totalBytes: INCIDENT_TOTAL_BYTES,
      budgetBytes: FIFTEEN_MIB,
    });
    expect(networkSubmissions).toBe(0);
    expect(resolver.accounting().activeRequestCount).toBe(0);
  });

  describe('native full-envelope transport cap', () => {
    const OVERSIZED_IMAGE_BYTES = 8_400_000;
    const EXPLICIT_LARGE_BUDGET = 128 * 1024 * 1024;

    async function oversizedHistory(): Promise<{
      readonly contents: IContent[];
      readonly resolver: RequestMediaResolver;
    }> {
      const store = new LocalMediaStore({
        rootDirectory: join(directory, 'media'),
        quotaBytes: 128 * 1024 * 1024,
      });
      const { contents } = await incidentHistory(
        store,
        Array.from({ length: 4 }, () => OVERSIZED_IMAGE_BYTES),
      );
      return { contents, resolver: new RequestMediaResolver(store) };
    }

    it('rejects a body over 32,000,000 bytes at projection even when an explicit media budget would admit the images', async () => {
      const { contents, resolver } = await oversizedHistory();
      const { provider, options } = prepared(
        contents,
        resolver,
        EXPLICIT_LARGE_BUDGET,
      );

      const error = await rejection(provider.projectPromptEnvelope(options));

      expect(error).toBeInstanceOf(RequestBodyByteOverflowError);
      expect(error).toMatchObject({ limitBytes: 32_000_000 });
      expect(resolver.accounting().activeRequestCount).toBe(0);
    });

    it('rejects the same body at send before any HTTP request', async () => {
      const { contents, resolver } = await oversizedHistory();
      let networkSubmissions = 0;
      globalThis.fetch = async (): Promise<Response> => {
        networkSubmissions += 1;
        return successfulResponse();
      };
      const { provider, options } = prepared(
        contents,
        resolver,
        EXPLICIT_LARGE_BUDGET,
      );

      const error = await rejection(send(provider, options));

      expect(error).toBeInstanceOf(RequestBodyByteOverflowError);
      expect(networkSubmissions).toBe(0);
      expect(resolver.accounting().activeRequestCount).toBe(0);
    });
  });
});
