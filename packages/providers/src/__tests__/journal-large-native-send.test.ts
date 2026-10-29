/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
  type WireRoute,
  type MediaBinding,
  type WireBodyRecord,
} from './support/wireBodyCapture.js';
import type { HistoryCase } from './support/wireBodyHistories.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';

const TEXT_BYTES = 40 * 1024 * 1024;
const routeIds = [
  'openai-chat-plain',
  'openai-responses-via-openai',
  'openai-responses',
  'anthropic-cache-off',
];
const routes = WIRE_ROUTES.filter((route) => routeIds.includes(route.id));
const shape: HistoryCase = {
  id: 'native-40MiB',
  description: 'one committed 40 MiB row',
  rows: [],
};

function row(reference?: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: ' information    '.repeat(TEXT_BYTES / 16) },
      ...(reference === undefined ? [] : [reference]),
    ],
  };
}

async function oracle(
  route: WireRoute,
  reference?: MediaReferenceBlock,
  media?: MediaBinding,
): Promise<WireBodyRecord> {
  return recordOf(
    await sendThroughRoute(
      route,
      { ...shape, rows: [row(reference)] },
      'rows',
      media,
    ),
  );
}

async function mediaFixture(): Promise<{
  reference: MediaReferenceBlock;
  binding: MediaBinding;
}> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/854-notes/p4/w23/limits-memory-run-c/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'media-')),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  return {
    reference,
    binding: { resolver: new RequestMediaResolver(store), budgetBytes: 1024 },
  };
}

async function verifyLargeSend(
  route: WireRoute,
  withImage: boolean,
): Promise<ProviderRequestSelection> {
  const media = withImage ? await mediaFixture() : undefined;
  const expected = await oracle(route, media?.reference, media?.binding);
  const fixture = await nativeJournalSendFixture(
    (function* (): Generator<IContent> {
      yield row(media?.reference);
    })(),
  );
  const sink = await localWireHashSink(route);
  try {
    const created = route.createProvider();
    const provider =
      media === undefined
        ? created
        : bindProviderMedia(
            created,
            media.binding.resolver,
            media.binding.budgetBytes,
          );
    for await (const chunk of provider.generateChatCompletion(
      buildHistoryCallOptions(
        sink.route,
        shape,
        'rows',
        new SettingsService(),
        fixture.selection,
      ),
    ))
      void chunk;
    expect(fixture.selection.count).toBe(1);
    expect(sink.entries()).toBe(1);
    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0].bytes).toBeGreaterThan(TEXT_BYTES);
    expect(sink.requests[0].bytes).toBe(expected.length);
    expect(sink.requests[0].sha256).toBe(expected.sha256);
    expect(sink.requests[0].contentLength).toBe(String(expected.length));
    if (process.env.SEND_PEAK_LOG !== undefined) {
      appendFileSync(
        process.env.SEND_PEAK_LOG,
        `${JSON.stringify({ route: route.id, withImage, textBytes: TEXT_BYTES, expected, actual: sink.requests[0] })}
`,
      );
    }
    expect(media?.binding.resolver.accounting().activeRequestCount ?? 0).toBe(
      0,
    );
  } finally {
    await sink.close();
    await fixture.close();
  }
  return fixture.selection;
}

describe('native journal 40 MiB production sends', () => {
  for (const route of routes) {
    for (const withImage of [false, true]) {
      it(`${route.id}: sends 40 MiB text${withImage ? ' and a stored image reference' : ''} with exact oracle bytes and Content-Length over HTTP`, async () => {
        const selection = await verifyLargeSend(route, withImage);
        expect(() => selection.openReader()).toThrow('closed');
      }, 170000);
    }
  }
});
