/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { readLoggingChatStream } from '../../../agents/src/core/__tests__/support/chat-session-logging-fixture.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import type { GenerateChatOptions } from '../IProvider.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { anthropicJournalSink } from './support/anthropic-journal-case.js';
import { publicChat } from './support/public-anthropic-tail.js';
import { rowsSelection } from './support/wireBodyCapture.js';

class ObservedMediaProvider extends AnthropicProvider {
  override requestMediaResolver: RequestMediaResolver | undefined = undefined;
  reference: GenerateChatOptions | undefined;
  estimate: PromptEnvelopeEstimate | undefined;
  route: string | undefined;
  readonly estimatePayloadReads: number[] = [];

  override async projectPromptEnvelope(
    options: GenerateChatOptions,
  ): ReturnType<AnthropicProvider['projectPromptEnvelope']> {
    if (this.requestMediaResolver === undefined)
      throw new Error('Missing bound public media resolver');
    if (options.requestRows === undefined)
      throw new Error('Missing public rows');
    const rows: IContent[] = [];
    for await (const row of options.requestRows.openReader()) rows.push(row);
    const selection = rowsSelection(rows);
    this.reference = {
      ...options,
      requestRows: selection,
      contents: selection.openReader(),
      contentCount: selection.count,
    };
    const before = this.requestMediaResolver.accounting().storeReadCount;
    const projection = await super.projectPromptEnvelope(options);
    this.route = projection.finalizedProjection?.constructor.name;
    this.estimate = await estimatePromptEnvelope(
      this.name,
      projection,
      createRuntimeTokenizerFactory(),
    );
    this.estimatePayloadReads.push(
      this.requestMediaResolver.accounting().storeReadCount - before,
    );
    return projection;
  }
}

async function publicMediaCase(
  unsupported: boolean,
  mode: 'history' | 'pending' | 'changed' | 'merged' = 'history',
  cache: 'off' | '5m' | '1h' = 'off',
  budget?: {
    readonly maxDimension?: number;
    readonly maxPixels?: number;
    readonly dropped: boolean;
  },
): Promise<void> {
  const sink = await anthropicJournalSink();
  const parent = `${import.meta.dir}/../../../../tmp/anthropic-media2/fixtures`;
  mkdirSync(parent, { recursive: true });
  const directory = mkdtempSync(`${parent}/public-`);
  const store = new LocalMediaStore({
    rootDirectory: `${directory}/media`,
    quotaBytes: 4096,
  });
  const png = Buffer.alloc(24);
  png.set([137, 80, 78, 71, 13, 10, 26, 10]);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(1024, 16);
  png.writeUInt32BE(512, 20);
  const image = await store.admit({
    bytes: png,
    dimensions: { width: 1024, height: 512 },
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const smallPng = Buffer.from(png);
  smallPng.writeUInt32BE(64, 16);
  smallPng.writeUInt32BE(64, 20);
  const smallImage =
    budget === undefined
      ? undefined
      : await store.admit({
          bytes: smallPng,
          dimensions: { width: 64, height: 64 },
          mimeType: 'image/png',
          semanticMetadata: {},
        });
  const audio = unsupported
    ? await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'audio/wav',
        semanticMetadata: {},
      })
    : undefined;
  const history = new HistoryService({});
  await history.registerMediaOwner(new HistoryMediaOwnership(store));
  const resolver = new RequestMediaResolver(store);
  const settings = new SettingsService();
  settings.setProviderSetting('anthropic', 'model', sink.route.model);
  settings.setProviderSetting('anthropic', 'base-url', sink.route.baseURL);
  settings.setProviderSetting('anthropic', 'auth-key', 'test-api-key');
  settings.setProviderSetting('anthropic', 'prompt-caching', cache);
  if (budget?.maxDimension !== undefined)
    settings.set('max-image-dimension', budget.maxDimension);
  if (budget?.maxPixels !== undefined)
    settings.set('max-image-pixels', budget.maxPixels);
  settings.set('model', sink.route.model);
  settings.set('streaming', 'disabled');
  settings.set('token-usage-log', false);
  const provider = bindProviderMedia(
    new ObservedMediaProvider(
      'test-api-key',
      sink.route.baseURL,
      TEST_PROVIDER_CONFIG,
    ),
    resolver,
    4096,
  );
  provider.setRuntimeSettingsService(settings);
  const { chat, owner } = publicChat(
    provider,
    settings,
    history,
    sink.route.model,
    sink.route.baseURL,
    resolver,
    store,
    4096,
  );
  const read = store.readReserved.bind(store);
  const mediaReads: number[] = [];
  const mediaReadIds: string[] = [];
  const reading = spyOn(store, 'readReserved').mockImplementation(
    async (reference) => {
      mediaReads.push(resolver.accounting().reservedContentCount);
      mediaReadIds.push(reference.contentId);
      const bytes = await read(reference);
      expect(bytes.length).toBeGreaterThan(0);
      return bytes;
    },
  );
  try {
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [
          { type: 'text', text: 'look 雪' },
          image,
          ...(smallImage === undefined ? [] : [smallImage]),
          ...(audio === undefined ? [] : [audio]),
        ],
      },
      ...(mode === 'merged'
        ? []
        : [
            {
              speaker: 'ai',
              blocks:
                mode === 'changed'
                  ? [
                      {
                        type: 'tool_call',
                        id: 'hist_tool_read',
                        name: 'read',
                        parameters: {},
                      },
                    ]
                  : [{ type: 'text', text: 'seen' }],
            } satisfies IContent,
          ]),
    ]);
    await history.waitForCommit();
    const pin = await history.prepareCuratedForProviderSnapshot();
    expect(pin.native?.mediaLease).toBeDefined();
    await pin.close();
    let output = '';
    const created = await operationFileCreates(async () => {
      output = await readLoggingChatStream(
        chat,
        {
          message: {
            speaker: mode === 'changed' ? 'tool' : 'human',
            blocks: [
              ...(mode === 'changed'
                ? [
                    {
                      type: 'tool_response',
                      callId: 'hist_tool_read',
                      toolName: 'read',
                      result: 'found',
                    } satisfies IContent['blocks'][number],
                  ]
                : [
                    {
                      type: 'text',
                      text: 'continue ',
                    } satisfies IContent['blocks'][number],
                  ]),
              ...(mode === 'history'
                ? []
                : [
                    {
                      type: 'media',
                      encoding: 'base64',
                      mimeType: 'image/png',
                      data: png.toString('base64'),
                    } satisfies IContent['blocks'][number],
                    ...(unsupported
                      ? [
                          {
                            type: 'media',
                            encoding: 'base64',
                            mimeType: 'audio/wav',
                            data: 'AQID',
                          } satisfies IContent['blocks'][number],
                        ]
                      : []),
                  ]),
            ],
          },
        },
        'media-public',
      );
    });
    const publicReads = [...mediaReads];
    const publicReadIds = [...mediaReadIds];
    const reference = provider.reference;
    if (reference === undefined)
      throw new Error('Public projection was not used');
    const builder = bindProviderMedia(
      new AnthropicProvider(
        'test-api-key',
        sink.route.baseURL,
        TEST_PROVIDER_CONFIG,
      ),
      resolver,
      4096,
    );
    builder.setRuntimeSettingsService(settings);
    const oracle = await builder.projectPromptEnvelope(reference);
    try {
      const estimate = await estimatePromptEnvelope(
        builder.name,
        oracle,
        createRuntimeTokenizerFactory(),
      );
      for await (const chunk of builder.generateChatCompletion({
        ...reference,
        promptEnvelopeTransportToken: oracle.transportToken,
      }))
        void chunk;
      expect(provider.estimate).toStrictEqual(estimate);
      const mediaCount = mode === 'history' ? 1 : 2;
      expect(estimate.unsupportedMedia).toHaveLength(
        unsupported ? mediaCount : 0,
      );
    } finally {
      await oracle.releaseIfUnsent?.();
    }
    expect(provider.route).toBe('NativeAnthropicEstimateProjection');
    expect(output).toBe('ok');
    expect(sink.requests).toHaveLength(2);
    expect(sink.requests[0]).toStrictEqual(sink.requests[1]);
    expect(sink.requests[0].length).toBe(
      String(Buffer.byteLength(sink.requests[0].body)),
    );
    if (budget?.dropped === true) {
      expect(sink.requests[0].body).not.toContain(png.toString('base64'));
      expect(sink.requests[0].body).toContain('Image dropped');
      expect(publicReadIds).not.toContain(image.contentId);
    } else expect(sink.requests[0].body).toContain(png.toString('base64'));
    if (smallImage !== undefined)
      expect(sink.requests[0].body).toContain(smallPng.toString('base64'));
    expect(provider.estimatePayloadReads).toStrictEqual([0]);
    expect(publicReads.length).toBeGreaterThan(0);
    expect(publicReads.every((count) => count === 0)).toBe(true);
    expect(created).toStrictEqual({ files: [], directories: [] });
    expect(provider.route).toBe('NativeAnthropicEstimateProjection');
  } finally {
    reading.mockRestore();
    await sink.close();
    await history.dispose();
    await owner.dispose();
    await store.close();
  }
}

describe('native Anthropic public history media estimation and send', () => {
  it.each([false, true])(
    'keeps builder bytes and estimates without files or history reservations, unsupported=%s',
    async (unsupported) => {
      await expect(publicMediaCase(unsupported)).resolves.toBeUndefined();
    },
  );
  it.each(
    (
      ['pending', 'changed', 'merged'] satisfies Array<
        'pending' | 'changed' | 'merged'
      >
    ).flatMap((mode) =>
      (['off', '5m', '1h'] satisfies Array<'off' | '5m' | '1h'>).map(
        (cache) => ({ mode, cache }),
      ),
    ),
  )(
    'keeps native bytes, estimates and history leases with $mode media and $cache caching',
    async ({ mode, cache }) => {
      expect(await publicMediaCase(true, mode, cache)).toBeUndefined();
    },
  );
  it.each([
    { maxDimension: 512, dropped: true },
    { maxDimension: 2048, dropped: false },
    { maxPixels: 100000, dropped: true },
    { maxPixels: 1000000, dropped: false },
  ])(
    'uses stored media dimensions for configured budget %j',
    async (budget) => {
      expect(
        await publicMediaCase(true, 'history', '1h', budget),
      ).toBeUndefined();
      expect(
        await publicMediaCase(true, 'changed', '5m', budget),
      ).toBeUndefined();
    },
  );
});
