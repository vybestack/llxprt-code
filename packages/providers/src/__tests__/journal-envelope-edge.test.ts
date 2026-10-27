/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { providerStreamError } from './support/provider-stream-error.js';
import {
  localWireHashSink,
  type LocalWireHashSink,
} from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  sendThroughRoute,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';

const marker = 'W23_EDGE_MARKER';
const suffix = '雪😀"\\\n\u0000\u2028';
const routes = WIRE_ROUTES.filter((route) =>
  [
    'openai-chat-plain',
    'openai-responses-via-openai',
    'openai-responses',
    'anthropic-cache-off',
  ].includes(route.id),
);

function row(text: string, reference: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: text + suffix }, reference],
  };
}

function paddedText(bytes: number): string {
  const unit = ' information    ';
  return (
    unit.repeat(Math.floor(bytes / unit.length)) +
    unit.slice(0, bytes % unit.length)
  );
}

function expectedHash(
  prefix: Uint8Array,
  padding: number,
  end: Uint8Array,
): string {
  const hash = createHash('sha256').update(prefix);
  const chunk = Buffer.from(paddedText(64 * 1024));
  for (let left = padding; left > 0; left -= chunk.length)
    hash.update(chunk.subarray(0, Math.min(left, chunk.length)));
  return hash.update(end).digest('hex');
}

interface EdgeObservation {
  readonly error: unknown;
  readonly sink: LocalWireHashSink;
  readonly received: number;
}
async function verifyEdge(
  route: WireRoute,
  extra: number,
  verify: (observation: EdgeObservation, expected: string) => void,
): Promise<void> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/854-notes/p4/w23/planning-run-d/fixtures',
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
  const resolver = new RequestMediaResolver(store);
  const shape = {
    id: 'native-edge',
    description: 'escaped text and admitted image',
    rows: [],
  };
  const small = await sendThroughRoute(
    route,
    { ...shape, rows: [row(marker, reference)] },
    'rows',
    { resolver, budgetBytes: 1024 },
  );
  const wire = Buffer.from(small.bytes);
  const offset = wire.indexOf(marker);
  expect(offset).toBeGreaterThan(0);
  expect(wire.indexOf(marker, offset + marker.length)).toBe(-1);
  expect(wire.toString()).toContain('base64');
  const padding =
    DEFAULT_HTTP_JSON_ENVELOPE_BYTES - wire.length + marker.length + extra;
  const expected = expectedHash(
    wire.subarray(0, offset),
    padding,
    wire.subarray(offset + marker.length),
  );
  const fixture = await nativeJournalSendFixture(
    (function* (): Generator<IContent> {
      yield row(paddedText(padding), reference);
    })(),
    { mediaStore: store },
  );
  let rowsRead = 0;
  let blocksRead = 0;
  const originalPlan = IndexedJournalRequestSnapshot.prototype.planAt;
  IndexedJournalRequestSnapshot.prototype.planAt = async function (...args) {
    const plan = await originalPlan.apply(this, args);
    return {
      ...plan,
      async *openBlocks() {
        for await (const block of plan.openBlocks()) {
          blocksRead++;
          yield block;
        }
      },
    };
  };
  const indexed = fixture.selection.native?.indexed;
  if (indexed === undefined) throw new Error('Expected native edge rows');
  const indexedOpen = indexed.openReader.bind(indexed);
  const indexedRead = indexed.readAt.bind(indexed);
  indexed.openReader = (signal) =>
    (async function* (): AsyncGenerator<IContent, void> {
      for await (const content of indexedOpen(signal)) {
        rowsRead += 1;
        blocksRead += content.blocks.length;
        yield content;
      }
    })();
  indexed.readAt = (index, signal) => {
    rowsRead += 1;
    return indexedRead(index, signal);
  };
  const selection = {
    native: fixture.selection.native,
    count: fixture.selection.count,
    close: () => fixture.selection.close(),
    readAt: (index: number, signal?: AbortSignal) =>
      fixture.selection.readAt(index, signal),
    openReader: (signal?: AbortSignal) => fixture.selection.openReader(signal),
  };
  let received = 0;
  const sink = await localWireHashSink(route, async (bytes) => {
    received = bytes;
  });
  try {
    const provider = bindProviderMedia(route.createProvider(), resolver, 1024);
    const options = buildHistoryCallOptions(
      sink.route,
      shape,
      'rows',
      new SettingsService(),
      selection,
    );
    const error = await providerStreamError(
      provider.generateChatCompletion(options),
    );
    verify({ error, sink, received }, expected);
    const expectedRows =
      extra === 1 || route.id === 'anthropic-cache-off' ? 0 : 1;
    expect(rowsRead).toBe(expectedRows);
    if (extra === 0) expect(blocksRead).toBeGreaterThan(0);
    expect(resolver.accounting().activeRequestCount).toBe(0);
  } finally {
    IndexedJournalRequestSnapshot.prototype.planAt = originalPlan;
    await sink.close();
    await fixture.close();
  }
  expect(() => fixture.selection.openReader()).toThrow('closed');
}

describe('native provider-effective envelope edge', () => {
  for (const route of routes) {
    it(`${route.id}: sends exactly 128 MiB with Unicode escaping and a stored image data URI`, async () => {
      await verifyEdge(route, 0, ({ error, sink }, expected) => {
        expect(error).toBeUndefined();
        expect(sink.entries()).toBe(1);
        expect(sink.requests).toHaveLength(1);
        expect(sink.requests[0]).toStrictEqual({
          bytes: DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
          contentLength: String(DEFAULT_HTTP_JSON_ENVELOPE_BYTES),
          sha256: expected,
        });
      });
    }, 170000);
    it(`${route.id}: refuses one byte above 128 MiB with Unicode escaping and a stored image data URI`, async () => {
      await verifyEdge(route, 1, ({ error, sink, received }) => {
        expect(error).toBeInstanceOf(RangeError);
        expect(sink.entries()).toBe(0);
        expect(sink.requests).toHaveLength(0);
        expect(received).toBe(0);
        if (!(error instanceof RangeError)) throw error;
        expect(error.message).toContain(
          String(DEFAULT_HTTP_JSON_ENVELOPE_BYTES),
        );
      });
    }, 170000);
  }
});
