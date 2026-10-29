/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryMediaOwnership } from '@vybestack/llxprt-code-core/storage/history-media-ownership.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { buildHistoryCases } from './support/wireBodyHistories.js';

describe('native plain Chat history media lease', () => {
  it('keeps a blob through concurrent clear while an actual HTTP body is paused before its read', async () => {
    const parent = join(
      import.meta.dir,
      '../../../../tmp/p8/native-media-final-bb/fixtures',
    );
    mkdirSync(parent, { recursive: true });
    const store = new LocalMediaStore({
      rootDirectory: mkdtempSync(join(parent, 'paused-')),
      quotaBytes: 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const input = buildHistoryCases({ imageReference: reference }).find(
      (item) => item.id === 'media-reference-image',
    );
    const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
    if (input === undefined || route === undefined)
      throw new Error('Missing reference-image case');
    const resolver = new RequestMediaResolver(store);
    const expected = recordOf(
      await sendThroughRoute(route, input, 'rows', {
        resolver,
        budgetBytes: 1024,
      }),
    );
    const history = new HistoryService({});
    await history.registerMediaOwner(new HistoryMediaOwnership(store));
    await history.addBatch(input.rows);
    const selection = await history.prepareCuratedForProviderSnapshot();
    const sink = await localWireHashSink(route);
    const entered = batchGate();
    const resume = batchGate();
    const read = store.readReserved.bind(store);
    const paused = spyOn(store, 'readReserved').mockImplementation(
      async (ref) => {
        entered.resolve();
        await resume.promise;
        return read(ref);
      },
    );
    const provider = bindProviderMedia(route.createProvider(), resolver, 1024);
    const options = buildHistoryCallOptions(
      sink.route,
      input,
      'rows',
      new SettingsService(),
      selection,
    );
    const sending = (async (): Promise<void> => {
      for await (const chunk of provider.generateChatCompletion(options))
        void chunk;
    })();
    const outcome = sending.then(
      () => ({ succeeded: true }),
      (error: unknown) => ({ error }),
    );
    try {
      await entered.promise;
      await history.clear();
      await history.waitForOwnershipSettlement();
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(0);
      resume.resolve();
      expect(await outcome).toStrictEqual({ succeeded: true });
      expect(sink.requests).toHaveLength(1);
      expect(sink.requests[0].bytes).toBe(323);
      expect(sink.requests[0].sha256).toBe(expected.sha256);
      expect(sink.requests[0].contentLength).toBe('323');
      await selection.close();
      expect(
        (await store.reclaimUnreferenced(new Set(), Date.now())).objectsRemoved,
      ).toBe(1);
    } finally {
      resume.resolve();
      await outcome;
      paused.mockRestore();
      await selection.close();
      await sink.close();
      await history.dispose();
      await store.close();
    }
  });
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
    const history = new HistoryService({});
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
        }
        expect(
          (await store.reclaimUnreferenced(new Set(), Date.now()))
            .objectsRemoved,
        ).toBe(0);
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
