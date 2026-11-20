/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

interface ReferenceSend {
  readonly created: Awaited<ReturnType<typeof operationFileCreates>>;
  readonly requests: Awaited<ReturnType<typeof localWireHashSink>>['requests'];
  readonly expected: ReturnType<typeof recordOf>;
  readonly retainedMediaBytes: number;
}

async function sendReference(mimeType: string): Promise<ReferenceSend> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/responses-native/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'media-')),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes: new Uint8Array([1, 2]),
    mimeType,
    semanticMetadata: {},
  });
  const rows: readonly IContent[] = [{ speaker: 'human', blocks: [reference] }];
  const route = WIRE_ROUTES.find((entry) => entry.id === 'openai-responses');
  if (route === undefined) throw new Error('Missing Responses route');
  const shape = {
    id: 'native-media',
    description: 'native media',
    rows,
    ephemerals: { 'responses-stateful': false },
  };
  const resolver = new RequestMediaResolver(store);
  const expected = recordOf(
    await sendThroughRoute(route, shape, 'rows', {
      resolver,
      budgetBytes: 1024,
    }),
  );
  const fixture = await journalSendFixture(rows, [], {
    directory: parent,
    mediaStore: store,
  });
  const sink = await localWireHashSink(route);
  try {
    const provider = bindProviderMedia(route.createProvider(), resolver, 1024);
    const options = buildHistoryCallOptions(
      sink.route,
      shape,
      'rows',
      new SettingsService(),
      fixture.selection,
    );
    const created = await operationFileCreates(async () => {
      for await (const chunk of provider.generateChatCompletion(options))
        void chunk;
    }, true);
    return {
      created,
      requests: sink.requests,
      expected,
      retainedMediaBytes: resolver.accounting().materializedNormalizedBytes,
    };
  } finally {
    await sink.close();
    await fixture.close();
    await store.close();
  }
}

describe('native Responses reference media', () => {
  it.each(['image/png', 'application/pdf'])(
    'streams %s from its pinned media lease without files',
    async (mimeType) => {
      const { created, requests, expected, retainedMediaBytes } =
        await sendReference(mimeType);
      expect(created).toStrictEqual({ files: [], directories: [] });
      expect(requests).toHaveLength(1);
      expect(requests[0].sha256).toBe(expected.sha256);
      expect(requests[0].bytes).toBe(expected.length);
      expect(requests[0].contentLength).toBe(String(expected.length));
      expect(retainedMediaBytes).toBe(0);
    },
  );
});
