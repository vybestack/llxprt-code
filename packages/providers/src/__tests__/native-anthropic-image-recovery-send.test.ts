/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  MediaBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';

function png(width: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(1000, 20);
  return bytes;
}

async function recoverySink(observe: () => Promise<void>): Promise<{
  route: WireRoute;
  requests: Array<{ body: string; length: string | undefined }>;
  close(): Promise<void>;
}> {
  const route = WIRE_ROUTES.find((item) => item.id === 'anthropic-cache-off');
  if (route === undefined) throw new Error('Missing Anthropic route');
  const requests: Array<{ body: string; length: string | undefined }> = [];
  const server = createServer((request, response) => {
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Expected HTTP bytes');
        chunks.push(chunk);
      }
      requests.push({
        body: Buffer.concat(chunks).toString('utf8'),
        length: request.headers['content-length'],
      });
      await observe();
      const reply =
        requests.length % 2 === 1
          ? Response.json(
              {
                type: 'error',
                error: {
                  type: 'invalid_request_error',
                  message:
                    'At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels',
                },
              },
              { status: 400 },
            )
          : route.respond();
      response.writeHead(reply.status, Object.fromEntries(reply.headers));
      response.end(await reply.text());
    })().catch((error: unknown) =>
      response.destroy(
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string')
    throw new Error('Missing socket');
  return {
    route: { ...route, baseURL: `http://127.0.0.1:${address.port}` },
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
        server.closeAllConnections();
      }),
  };
}

function recoveryRows(
  tool: boolean,
  big: MediaBlock,
  small: MediaBlock,
): readonly IContent[] {
  return tool
    ? [
        { speaker: 'human', blocks: [{ type: 'text', text: 'read 雪' }] },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'call_read',
              name: 'read',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'call_read',
              toolName: 'read',
              result: 'images',
            },
            small,
            big,
          ],
          metadata: { cacheAnchor: true },
        },
      ]
    : [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'look 雪' }, big],
          metadata: { cacheAnchor: true },
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'seen' }] },
        { speaker: 'human', blocks: [small, big] },
      ];
}

async function recoveryFixture(tool: boolean): Promise<{
  store: LocalMediaStore;
  resolver: RequestMediaResolver;
  history: HistoryService;
  selection: Awaited<
    ReturnType<HistoryService['prepareCuratedForProviderSnapshot']>
  >;
  rows: readonly IContent[];
  verifyReadable(): Promise<void>;
}> {
  const parent = `${import.meta.dir}/../../../../tmp/anthropic-recovery/fixtures`;
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(`${parent}/media-`),
    quotaBytes: 1024,
  });
  const big = await store.admit({
    bytes: png(3000),
    mimeType: 'image/png',
    dimensions: { width: 3000, height: 1000 },
    semanticMetadata: {},
  });
  const small = await store.admit({
    bytes: png(100),
    mimeType: 'image/png',
    dimensions: { width: 100, height: 1000 },
    semanticMetadata: {},
  });
  const rows = recoveryRows(tool, big, small);
  const history = new HistoryService({ backend: 'journal' });
  await history.registerMediaOwner(new HistoryMediaOwnership(store));
  await history.addBatch(rows);
  const selection = await history.prepareCuratedForProviderSnapshot();
  const resolver = new RequestMediaResolver(store);
  return {
    store,
    resolver,
    history,
    selection,
    rows: await normalizedRows(
      rows.map((row) => ({
        ...row,
        blocks: row.blocks.map((block) =>
          block.type === 'media' && block.encoding === 'reference'
            ? {
                type: 'media',
                encoding: 'base64',
                mimeType: block.mimeType,
                data: png(block.dimensions?.width ?? 0).toString('base64'),
              }
            : block,
        ),
      })),
    ),
    async verifyReadable() {
      expect(await store.readReserved(big)).toStrictEqual(
        new Uint8Array(png(3000)),
      );
      expect(await store.readReserved(small)).toStrictEqual(
        new Uint8Array(png(100)),
      );
      expect(resolver.accounting().reservedContentCount).toBe(0);
    },
  };
}

async function sendRecovery(
  route: WireRoute,
  selection: ProviderRequestSelection,
  resolver: RequestMediaResolver,
): Promise<string> {
  const provider = bindProviderMedia(
    new AnthropicProvider('test-api-key', undefined, TEST_PROVIDER_CONFIG),
    resolver,
    1024,
  );
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'image-recovery',
      description: 'history recovery',
      rows: [],
      systemInstruction: 'Answer 雪.',
    },
    'rows',
    new SettingsService(),
    selection,
  );
  let output = '';
  for await (const chunk of provider.generateChatCompletion(options)) {
    for (const block of chunk.blocks)
      if (block.type === 'text') output += block.text;
  }
  return output;
}

function redirectAnthropic(baseURL: string): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ): Promise<Response> => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL ? input : input.url,
      );
      return original(baseURL + url.pathname, init);
    },
    { preconnect: original.preconnect },
  );
  return () => {
    globalThis.fetch = original;
  };
}

async function verifyPendingRecovery(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  sink: Awaited<ReturnType<typeof recoverySink>>,
  route: WireRoute,
): Promise<void> {
  const tail: IContent = {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: png(3000).toString('base64'),
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: png(100).toString('base64'),
      },
    ],
  };
  const selection = await fixture.history.prepareCuratedForProviderSnapshot([
    tail,
  ]);
  try {
    await sendRecovery(
      route,
      rowsSelection(await normalizedRows([...fixture.rows, tail])),
      fixture.resolver,
    );
    const created = await operationFileCreates(async () => {
      expect(await sendRecovery(route, selection, fixture.resolver)).toBe('ok');
    }, true);
    expect(sink.requests).toHaveLength(8);
    expect(sink.requests[6]).toStrictEqual(sink.requests[4]);
    expect(sink.requests[7]).toStrictEqual(sink.requests[5]);
    expect(sink.requests[7].length).toBe(
      String(Buffer.byteLength(sink.requests[7].body)),
    );
    expect(created).toStrictEqual({ files: [], directories: [] });
  } finally {
    await selection.close();
  }
}

async function verifyAppendedRecovery(
  fixture: Awaited<ReturnType<typeof recoveryFixture>>,
  sink: Awaited<ReturnType<typeof recoverySink>>,
  route: WireRoute,
): Promise<void> {
  const tail: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'append after filled media facts' }],
  };
  fixture.history.add(tail);
  await fixture.history.waitForCommit();
  const selection = await fixture.history.prepareCuratedForProviderSnapshot();
  try {
    await sendRecovery(
      route,
      rowsSelection(await normalizedRows([...fixture.rows, tail])),
      fixture.resolver,
    );
    const created = await operationFileCreates(async () => {
      expect(await sendRecovery(route, selection, fixture.resolver)).toBe('ok');
    }, true);
    expect(sink.requests).toHaveLength(12);
    expect(sink.requests[10]).toStrictEqual(sink.requests[8]);
    expect(sink.requests[11]).toStrictEqual(sink.requests[9]);
    expect(sink.requests[11].length).toBe(
      String(Buffer.byteLength(sink.requests[11].body)),
    );
    expect(created).toStrictEqual({ files: [], directories: [] });
  } finally {
    await selection.close();
  }
}

async function verifyRecovery(
  cache: 'off' | '5m',
  tool: boolean,
): Promise<void> {
  const fixture = await recoveryFixture(tool);
  const sink = await recoverySink(() => fixture.verifyReadable());
  const route = {
    ...sink.route,
    baseURL: 'https://api.anthropic.com',
    providerSettings: { 'prompt-caching': cache },
  };
  const restore = redirectAnthropic(sink.route.baseURL);
  try {
    await sendRecovery(route, rowsSelection(fixture.rows), fixture.resolver);
    const created = await operationFileCreates(async () => {
      expect(
        await sendRecovery(route, fixture.selection, fixture.resolver),
      ).toBe('ok');
    }, true);
    expect(sink.requests).toHaveLength(4);
    expect(sink.requests[2]).toStrictEqual(sink.requests[0]);
    expect(sink.requests[3]).toStrictEqual(sink.requests[1]);
    for (const request of sink.requests)
      expect(request.length).toBe(String(Buffer.byteLength(request.body)));
    expect(sink.requests[2].body.includes('cache_control')).toBe(
      cache === '5m',
    );
    expect(sink.requests[3].body).toContain('Image dropped');
    expect(sink.requests[3].body).not.toContain(png(3000).toString('base64'));
    expect(sink.requests[3].body).toContain(png(100).toString('base64'));
    expect(created).toStrictEqual({ files: [], directories: [] });
    await fixture.verifyReadable();
    expect(fixture.resolver.accounting().materializedNormalizedBytes).toBe(0);
    await verifyPendingRecovery(fixture, sink, route);
    await verifyAppendedRecovery(fixture, sink, route);
  } finally {
    restore();
    await sink.close();
    await fixture.selection.close();
    await fixture.history.dispose();
    await fixture.store.close();
  }
}

describe('native Anthropic image recovery HTTP', () => {
  it.each([
    { cache: 'off', tool: false },
    { cache: '5m', tool: false },
    { cache: 'off', tool: true },
    { cache: '5m', tool: true },
  ])(
    'retries with builder bytes, readable media and no files or reservations for %j',
    async ({ cache, tool }) => {
      expect(await verifyRecovery(cache, tool)).toBeUndefined();
    },
  );
});
