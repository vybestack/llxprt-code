/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { buildHistoryCases } from './support/wireBodyHistories.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

describe('native plain Chat history media lease', () => {
  it('sends the 323-byte reference image twice without creating files, survives clear, and reclaims on close', async () => {
    const parent = join(
      import.meta.dir,
      '../../../../tmp/p8/native-media-run-ba/fixtures',
    );
    mkdirSync(parent, { recursive: true });
    const directory = mkdtempSync(join(parent, 'owned-'));
    const store = new LocalMediaStore({
      rootDirectory: directory,
      quotaBytes: 1024 * 1024,
    });
    const resolver = new RequestMediaResolver(store);
    const imageReference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const input = buildHistoryCases({ imageReference }).find(
      (item) => item.id === 'media-reference-image',
    );
    const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
    if (input === undefined || route === undefined)
      throw new Error('Missing frozen reference-image input');
    const media = { resolver, budgetBytes: 1024 * 1024 };
    const expected = recordOf(
      await sendThroughRoute(route, input, 'rows', media),
    );
    const history = new HistoryService({ backend: 'journal' });
    await history.registerMediaOwner(new HistoryMediaOwnership(store));
    await history.addBatch(input.rows);
    const selection = await history.prepareCuratedForProviderSnapshot();
    const sink = await localWireHashSink(route);
    try {
      const provider = bindProviderMedia(
        route.createProvider(),
        resolver,
        media.budgetBytes,
      );
      const options = buildHistoryCallOptions(
        sink.route,
        input,
        'rows',
        new SettingsService(),
        selection,
      );
      for (const attempt of [0, 1]) {
        if (attempt === 1) {
          await history.clear();
          await history.waitForOwnershipSettlement();
          expect(
            (await store.reclaimUnreferenced(new Set(), Date.now()))
              .objectsRemoved,
          ).toBe(0);
        }
        const created = await operationFileCreates(async () => {
          for await (const chunk of provider.generateChatCompletion(options))
            void chunk;
        }, true);
        expect(created).toStrictEqual({ files: [], directories: [] });
        expect(sink.requests).toHaveLength(attempt + 1);
        const actual = sink.requests[attempt];
        expect(actual.bytes).toBe(323);
        expect(actual.bytes).toBe(expected.length);
        expect(actual.sha256).toBe(expected.sha256);
        expect(actual.contentLength).toBe(String(actual.bytes));
        expect(resolver.accounting().reservedContentCount).toBe(0);
        expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
      }
      await selection.close();
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      await selection.close();
      await sink.close();
      await history.dispose();
      await store.close();
    }
  });
});
