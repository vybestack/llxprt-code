/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setTimeout as sleep } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  RequestMediaResolver,
  type RequestMediaResolutionInput,
  type ResolvedMediaRequest,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';
import { NativeChatBody } from '../openai/native-chat-body.js';

class RowCensus {
  private readonly rows: Array<WeakRef<IContent>> = [];
  private readonly text: Array<WeakRef<object>> = [];
  peakRows = 0;
  peakText = 0;
  acquired = 0;
  peakPayloadBytes = 0;

  track(row: IContent): void {
    this.acquired++;
    this.rows.push(new WeakRef(row));
    for (const block of row.blocks)
      if (block.type === 'text') this.text.push(new WeakRef(block));
  }

  async sample(): Promise<{ rows: number; text: number; textBytes: number }> {
    await sleep(0);
    gcAndSweep();
    return this.countLive();
  }

  private countLive(): { rows: number; text: number; textBytes: number } {
    let rows = 0;
    let textBytes = 0;
    for (const ref of this.rows) {
      const row = ref.deref();
      if (row === undefined) continue;
      rows++;
      for (const block of row.blocks)
        if (block.type === 'text') textBytes += Buffer.byteLength(block.text);
    }
    const text = this.text.filter((ref) => ref.deref() !== undefined).length;
    this.peakRows = Math.max(this.peakRows, rows);
    this.peakText = Math.max(this.peakText, text);
    return { rows, text, textBytes };
  }
}

class ObservedResolver extends RequestMediaResolver {
  readonly census = new RowCensus();
  override resolve(
    input: RequestMediaResolutionInput,
  ): Promise<ResolvedMediaRequest> {
    for (const row of input.contents) this.census.track(row);
    return this.observe(super.resolve(input));
  }

  private async observe(
    pending: Promise<ResolvedMediaRequest>,
  ): Promise<ResolvedMediaRequest> {
    const resolved = await pending;
    try {
      await assertLiveResolution(this, resolved);
      return resolved;
    } catch (error) {
      await resolved.release();
      throw error;
    }
  }
}

async function assertLiveResolution(
  resolver: ObservedResolver,
  resolved: ResolvedMediaRequest,
): Promise<void> {
  const live = await resolver.census.sample();
  const payloadBytes = resolved.withContents((contents) => {
    let bytes = 0;
    for (const row of contents)
      for (const block of row.blocks) {
        if (block.type === 'text') bytes += Buffer.byteLength(block.text);
        if (block.type === 'media' && block.encoding === 'base64')
          bytes += Buffer.byteLength(block.data);
      }
    return bytes;
  });
  resolver.census.peakPayloadBytes = Math.max(
    resolver.census.peakPayloadBytes,
    payloadBytes,
  );
  expect(live.rows).toBeLessThanOrEqual(2);
  expect(live.text).toBeLessThanOrEqual(2);
  expect(live.textBytes).toBeLessThanOrEqual(2 * payloadBytes);
  expect(resolver.accounting().activeRequestCount).toBe(1);
  expect(resolver.accounting().reservedContentCount).toBe(0);
  expect(resolver.accounting().materializedNormalizedBytes).toBe(4);
}

function textAt(index: number, bytes: number): string {
  return `${index}:`.padEnd(bytes, 'x');
}

async function verifyLifetime(
  count: number,
  textBytes: number,
  distinct = false,
): Promise<number> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/p8/native-media-lifetime-run-bb/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'rows-')),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  function bytesAt(index: number): Uint8Array {
    return new Uint8Array([distinct ? index + 1 : 1, 2, 3]);
  }
  if (distinct)
    for (let index = 0; index < count; index++)
      await store.admit({
        bytes: bytesAt(index),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
  function referenceAt(index: number): typeof reference {
    if (!distinct) return { ...reference };
    return store.identityReferenceForKnown({
      contentId: `sha256:${createHash('sha256').update(bytesAt(index)).digest('hex')}`,
      knownByteLength: 3,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
  }
  const fixture = await journalSendFixture(
    (function* (): Generator<IContent> {
      for (let index = 0; index < count; index++)
        yield {
          speaker: 'human',
          blocks: [
            { type: 'text', text: textAt(index, textBytes) },
            referenceAt(index),
          ],
        };
    })(),
    [],
    { mediaStore: store, directory: parent },
  );
  const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
  if (route === undefined) throw new Error('Missing plain Chat route');
  const sink = await localWireHashSink(route);
  const resolver = new ObservedResolver(store);
  const expected = createHash('sha256');
  let expectedBytes = 0;
  function add(value: string): void {
    expected.update(value);
    expectedBytes += Buffer.byteLength(value);
  }
  add(
    '{"model":"gpt-4o","messages":[{"role":"system","content":"test system prompt"}',
  );
  for (let index = 0; index < count; index++)
    add(
      ',' +
        JSON.stringify({
          role: 'user',
          content: [
            { type: 'text', text: textAt(index, textBytes) },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${Buffer.from(bytesAt(index)).toString('base64')}`,
              },
            },
          ],
        }),
    );
  add('],"stream":false}');
  let streams = 0;
  const open = NativeChatBody.prototype.openStream;
  NativeChatBody.prototype.openStream = function () {
    streams++;
    return open.call(this);
  };
  try {
    const provider = bindProviderMedia(
      route.createProvider(),
      resolver,
      count * 4,
    );
    const options = buildHistoryCallOptions(
      sink.route,
      { id: 'media-lifetime', description: 'native rows', rows: [] },
      'rows',
      new SettingsService(),
      fixture.selection,
    );
    for await (const chunk of provider.generateChatCompletion(options))
      void chunk;
    const final = await resolver.census.sample();
    expect(streams).toBe(1);
    expect(resolver.census.acquired).toBe(count);
    expect(resolver.census.peakRows).toBeGreaterThan(0);
    expect(resolver.census.peakPayloadBytes).toBe(textBytes + 4);
    expect(final).toStrictEqual({ rows: 0, text: 0, textBytes: 0 });
    expect(resolver.accounting().activeRequestCount).toBe(0);
    expect(resolver.accounting().reservedContentCount).toBe(0);
    expect(resolver.accounting().materializedNormalizedBytes).toBe(0);
    expect(resolver.accounting().storeReadCount).toBe(count);
    expect(sink.requests).toHaveLength(1);
    expect(sink.requests[0].bytes).toBe(expectedBytes);
    expect(sink.requests[0].sha256).toBe(expected.digest('hex'));
    expect(sink.requests[0].contentLength).toBe(String(expectedBytes));
    if (process.env.SEND_PEAK_LOG !== undefined)
      appendFileSync(
        process.env.SEND_PEAK_LOG,
        JSON.stringify({
          count,
          textBytes,
          distinct,
          acquired: resolver.census.acquired,
          peakRows: resolver.census.peakRows,
          peakText: resolver.census.peakText,
          payloadBytes: resolver.census.peakPayloadBytes,
          final,
          streams,
          wire: sink.requests[0],
        }) + '\n',
      );
    return resolver.census.acquired;
  } finally {
    NativeChatBody.prototype.openStream = open;
    await sink.close();
    await fixture.close();
    await store.close();
  }
}

describe('actual native historical reference-media row lifetime', () => {
  it('releases 64 historical rows with 64 KiB text while resolving one payload at a time', async () => {
    expect(await verifyLifetime(64, 65536)).toBe(64);
  }, 170000);
  it('releases 64 distinct references with 64 KiB text rows', async () => {
    expect(await verifyLifetime(64, 65536, true)).toBe(64);
  }, 170000);
  it.each([512, 8192])(
    'releases %s historical reference rows with 128-byte text',
    async (count) => {
      expect(await verifyLifetime(count, 128)).toBe(count);
    },
    170000,
  );
});
