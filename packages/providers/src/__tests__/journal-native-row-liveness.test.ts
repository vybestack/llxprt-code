/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, mkdtempSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';

const ROW_COUNT = 40;
const ROW_TEXT_BYTES = 1024 * 1024;
const LIVE_BOUND = 9;
const retainedTrapRows: IContent[] = [];

interface Census {
  readonly rows: number;
  readonly text: number;
  readonly media: number;
}

class NativeRowCensus {
  private readonly refs = {
    rows: new Array<WeakRef<object>>(),
    text: new Array<WeakRef<object>>(),
    media: new Array<WeakRef<object>>(),
  };
  private peak: Census = { rows: 0, text: 0, media: 0 };

  track(row: IContent): void {
    this.refs.rows.push(new WeakRef(row));
    for (const block of row.blocks) {
      if (block.type === 'text') this.refs.text.push(new WeakRef(block));
      if (block.type === 'media' && block.encoding === 'reference')
        this.refs.media.push(new WeakRef(block));
    }
    if (process.env.ISSUE854_NATIVE_ROW_TRAP === 'retain')
      retainedTrapRows.push(row);
  }

  async sample(): Promise<void> {
    await sleep(0);
    gcAndSweep();
    this.peak = {
      rows: Math.max(
        this.peak.rows,
        this.refs.rows.filter((ref) => ref.deref() !== undefined).length,
      ),
      text: Math.max(
        this.peak.text,
        this.refs.text.filter((ref) => ref.deref() !== undefined).length,
      ),
      media: Math.max(
        this.peak.media,
        this.refs.media.filter((ref) => ref.deref() !== undefined).length,
      ),
    };
  }

  snapshot(): Census {
    return this.peak;
  }
}

function watchedSelection(
  selection: ProviderRequestSelection,
  census: NativeRowCensus,
): ProviderRequestSelection {
  return {
    count: selection.count,
    readAt: async (index, signal) => {
      const row = await selection.readAt(index, signal);
      census.track(row);
      return row;
    },
    openReader: (signal) =>
      (async function* (): AsyncGenerator<IContent, void> {
        for await (const row of selection.openReader(signal)) {
          census.track(row);
          await census.sample();
          yield row;
        }
      })(),
    close: () => undefined,
  };
}

async function sendWithCensus(route: WireRoute): Promise<Census> {
  const parent = join(
    import.meta.dir,
    '../../../../tmp/854-notes/p4/w23/limits-memory-run-c/fixtures',
  );
  mkdirSync(parent, { recursive: true });
  const store = new LocalMediaStore({
    rootDirectory: mkdtempSync(join(parent, 'row-media-')),
    quotaBytes: 1024,
  });
  const reference = await store.admit({
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const fixture = await journalSendFixture(
    (function* (): Generator<IContent> {
      for (let index = 0; index < ROW_COUNT; index++)
        yield {
          speaker: 'human',
          blocks: [
            { type: 'text', text: `${index}:` + 'x'.repeat(ROW_TEXT_BYTES) },
            { ...reference },
          ],
        };
    })(),
  );
  const census = new NativeRowCensus();
  const sink = await localWireHashSink(route, async () => {
    await census.sample();
  });
  try {
    const provider = bindProviderMedia(
      route.createProvider(),
      new RequestMediaResolver(store),
      1024,
    );
    const options = buildHistoryCallOptions(
      sink.route,
      {
        id: 'native-row-census',
        description: 'large rows and stored media',
        rows: [],
      },
      'rows',
      new SettingsService(),
      watchedSelection(fixture.selection, census),
    );
    for await (const chunk of provider.generateChatCompletion(options))
      void chunk;
    await census.sample();
    expect(sink.entries()).toBe(1);
    expect(sink.requests[0].bytes).toBeGreaterThan(ROW_COUNT * ROW_TEXT_BYTES);
    expect(sink.requests[0].contentLength).toBe(String(sink.requests[0].bytes));
    const result = census.snapshot();
    if (process.env.SEND_PEAK_LOG !== undefined)
      appendFileSync(
        process.env.SEND_PEAK_LOG,
        `${JSON.stringify({ route: route.id, trap: process.env.ISSUE854_NATIVE_ROW_TRAP ?? null, rowCount: ROW_COUNT, rowTextBytes: ROW_TEXT_BYTES, liveBound: LIVE_BOUND, peak: result })}\n`,
      );
    return result;
  } finally {
    await sink.close();
    await fixture.close();
  }
}

describe('native production sends release decoded rows, text blocks and stored image references', () => {
  const ids = [
    'openai-chat-plain',
    'openai-responses-via-openai',
    'openai-responses',
    'anthropic-cache-off',
  ];
  for (const route of WIRE_ROUTES.filter((candidate) =>
    ids.includes(candidate.id),
  )) {
    it(`${route.id}: holds no more than nine row, text or media objects across forty 1 MiB rows`, async () => {
      const peak = await sendWithCensus(route);
      expect(peak.rows).toBeGreaterThan(0);
      expect(peak.text).toBeGreaterThan(0);
      expect(peak.media).toBeGreaterThan(0);
      expect(peak.rows).toBeLessThanOrEqual(LIVE_BOUND);
      expect(peak.text).toBeLessThanOrEqual(LIVE_BOUND);
      expect(peak.media).toBeLessThanOrEqual(LIVE_BOUND);
    }, 170000);
  }
});
