/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { AnthropicProvider } from '../anthropic/AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from './providerTestConfig.js';
import { anthropicJournalSink } from './support/anthropic-journal-case.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  type WireRoute,
} from './support/wireBodyCapture.js';

async function sendMedia(
  route: WireRoute,
  selection: ProviderRequestSelection,
  resolver: RequestMediaResolver,
): Promise<void> {
  const provider = bindProviderMedia(
    new AnthropicProvider('test-api-key', undefined, TEST_PROVIDER_CONFIG),
    resolver,
    1024,
  );
  const options = buildHistoryCallOptions(
    route,
    {
      id: 'anthropic-media',
      description: 'history media lease',
      rows: [],
      systemInstruction: 'Answer precisely 雪.',
    },
    'rows',
    new SettingsService(),
    selection,
  );
  for await (const chunk of provider.generateChatCompletion(options))
    void chunk;
}

async function mediaFixture(
  mimeType: string,
  tool: boolean,
): Promise<{
  readonly rows: readonly IContent[];
  readonly history: HistoryService;
  readonly selection: Awaited<
    ReturnType<HistoryService['prepareCuratedForProviderSnapshot']>
  >;
  readonly resolver: RequestMediaResolver;
  readonly store: LocalMediaStore;
  readonly sink: Awaited<ReturnType<typeof anthropicJournalSink>>;
}> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/anthropic-media/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'media-')),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType,
    semanticMetadata: {},
  });
  const media = {
    ...reference,
    filename: 'reference 雪.pdf',
    caption: 'look \u{1F408}',
  };
  const rows: readonly IContent[] = tool
    ? [
        { speaker: 'human', blocks: [{ type: 'text', text: 'read 雪 ' }] },
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
              result: 'reference',
            },
            media,
          ],
        },
        { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
      ]
    : [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'look 雪 \u{1F408}' }, media],
        },
        { speaker: 'ai', blocks: [{ type: 'text', text: 'seen' }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
      ];
  const history = new HistoryService({});
  await history.registerMediaOwner(new HistoryMediaOwnership(store));
  await history.addBatch(rows);
  const selection = await history.prepareCuratedForProviderSnapshot();
  const resolver = new RequestMediaResolver(store);
  const sink = await anthropicJournalSink();
  return { rows, history, selection, resolver, store, sink };
}

async function verifyMediaSend(mimeType: string, tool: boolean): Promise<void> {
  const fixture = await mediaFixture(mimeType, tool);
  const { rows, history, selection, resolver, store, sink } = fixture;
  const entered = batchGate();
  const resume = batchGate();
  const read = store.readReserved.bind(store);
  try {
    await sendMedia(
      sink.route,
      rowsSelection(await normalizedRows(rows)),
      resolver,
    );
    const created = await operationFileCreates(
      () => sendMedia(sink.route, selection, resolver),
      true,
    );
    expect(created).toStrictEqual({ files: [], directories: [] });
    const paused = spyOn(store, 'readReserved').mockImplementation(
      async (reference) => {
        entered.resolve();
        await resume.promise;
        return read(reference);
      },
    );
    try {
      {
        const sending = sendMedia(sink.route, selection, resolver);
        const outcome = sending.then(
          () => ({ succeeded: true }),
          (error: unknown) => ({ error }),
        );
        const reached = await Promise.race([
          entered.promise.then(() => true),
          outcome.then(() => false),
        ]);
        if (!reached) {
          await sending;
          throw new Error('Send finished before reading history media');
        }
        try {
          await history.clear();
          await history.waitForOwnershipSettlement();
          expect(
            (await store.reclaimUnreferenced(new Set(), Date.now()))
              .objectsRemoved,
          ).toBe(0);
          expect(resolver.accounting().reservedContentCount).toBe(0);
        } finally {
          resume.resolve();
          expect(await outcome).toStrictEqual({ succeeded: true });
        }
      }
      expect(sink.requests).toHaveLength(3);
      expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
      expect(sink.requests[2]).toStrictEqual(sink.requests[0]);
      expect(sink.requests[1].length).toBe(
        String(Buffer.byteLength(sink.requests[1].body)),
      );
      if (mimeType === 'audio/wav') {
        expect(sink.requests[1].body).toContain('Anthropic');
        expect(sink.requests[1].body).not.toContain('AQID');
      } else {
        expect(sink.requests[1].body).toContain('AQID');
      }
      await selection.close();
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
      expect(resolver.accounting().reservedContentCount).toBe(0);
      expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
    } finally {
      resume.resolve();
      paused.mockRestore();
    }
  } finally {
    await selection.close();
    await sink.close();
    await history.dispose();
    await store.close();
  }
}

describe('native Anthropic history media HTTP', () => {
  it.each([
    { mimeType: 'image/png', tool: false },
    { mimeType: 'application/pdf', tool: false },
    { mimeType: 'audio/wav', tool: false },
    { mimeType: 'image/png', tool: true },
    { mimeType: 'application/pdf', tool: true },
    { mimeType: 'audio/wav', tool: true },
  ])(
    'matches builder bytes without files or reservations and survives clear for %j',
    async ({ mimeType, tool }) => {
      await expect(verifyMediaSend(mimeType, tool)).resolves.toBeUndefined();
    },
  );
});
