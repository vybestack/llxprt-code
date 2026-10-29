/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { NativeAnthropicEstimateProjection } from './native-anthropic-estimate.js';
import { getO200kBaseEncoder } from '../tokenizers/o200kBaseCounter.js';
import { describe, expect, it, spyOn } from 'bun:test';
import * as measuredMedia from './anthropic-measured-media.js';
import { prepareAnthropicStoredFill } from './anthropic-stored-fill.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { AnthropicRepairSource } from './anthropic-repair-source.js';
import { AnthropicStreamRepair } from './anthropic-stream-repair.js';
import { streamSendPeakRows } from '../__tests__/support/sendPeakShapes.js';
import { encodedRows } from '@vybestack/llxprt-code-core/services/history/journalPublication.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import {
  AnthropicRepairIndex,
  anthropicRepairScope,
} from './anthropic-repair-index.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4-5',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: false,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};

async function verifySingleMeasurement(
  snapshot: import('@vybestack/llxprt-code-core/journal/versionSnapshot.js').VersionSnapshot,
): Promise<void> {
  const lengths = spyOn(measuredMedia, 'anthropicBlockByteLength');
  const reads = spyOn(IndexedJournalRequestSnapshot.prototype, 'readAt');
  const fill = await prepareAnthropicStoredFill(snapshot, settings);
  try {
    for await (const entry of snapshot.entries())
      await fill.measure(snapshot, entry, settings);
    await fill.finish();
    expect(reads.mock.calls.length).toBe(0);
    expect(lengths.mock.calls.length).toBe(0);
  } finally {
    reads.mockRestore();
    lengths.mockRestore();
    await fill.close();
  }
}

describe('Anthropic repeated atom conversion', () => {
  const directory = useTempDir('anthropic-repeated-work-');
  for (const count of [2048, 8192]) {
    it(`serializes ${count} tool-heavy rows once and measures redaction-independent blocks once`, async () => {
      const physical = { reads: 0, bytes: 0 };
      const session = await JournalSession.create(
        `${directory()}/work-${count}.llxj`,
        {
          journal: testJournalSeams({ readCounter: physical }).dependencies,
        },
      );
      function* rows(): Generator<
        import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent
      > {
        let at = 0;
        for (const row of streamSendPeakRows('tool-heavy', 'large')) {
          if (++at > count) break;
          yield at % 4 === 0 ? { ...row, speaker: 'human' } : row;
        }
        yield { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] };
      }
      await session.store.commit([
        { kind: 'replace', rows: encodedRows(rows(), 0) },
      ]);
      const coldReads = spyOn(
        IndexedJournalRequestSnapshot.prototype,
        'readAt',
      );
      const lengths = spyOn(measuredMedia, 'anthropicBlockByteLength');
      const encoder = await getO200kBaseEncoder();
      const tokenization = spyOn(encoder, 'encode');
      let decoded = 0;
      let toolMeasurements = 0;
      let tokenizerCalls = 0;
      let fillReads = 0;
      let fillBytes = 0;
      physical.reads = 0;
      physical.bytes = 0;
      try {
        await session.store.commit([
          {
            kind: 'factIndex',
            registration: anthropicRepairFactIndex(settings),
          },
        ]);
        decoded = coldReads.mock.calls.length;
        toolMeasurements = lengths.mock.calls.filter(
          ([block]) => block.type === 'tool_use',
        ).length;
        tokenizerCalls = tokenization.mock.calls.length;
        fillReads = physical.reads;
        fillBytes = physical.bytes;
      } finally {
        coldReads.mockRestore();
        lengths.mockRestore();
        tokenization.mockRestore();
      }
      const snapshot = await session.store.snapshot();
      const query = await IndexedJournalRequestSnapshot.create(snapshot);
      try {
        expect(decoded).toBe(count + 1);
        expect(toolMeasurements).toBe(count / 4);
        expect(tokenizerCalls).toBeLessThanOrEqual(count * 2 + 256);
        expect(fillReads).toBeLessThanOrEqual(count * 10 + 512);
        // Fixed per-row work plus two radix-16 paths, allowing O(log N)
        // depth growth without allowing a history scan for each row.
        const depth = Math.ceil(Math.log(count) / Math.log(16));
        expect(fillReads).toBeLessThanOrEqual(count * (2 + 2 * depth) + 512);
        expect(fillBytes).toBeLessThanOrEqual(count * 12 * 1024);
        const engine = await AnthropicStreamRepair.create(query, settings);
        let bytes = 0;
        for await (const piece of engine.serialize())
          bytes += Buffer.byteLength(piece);
        expect(bytes).toBeGreaterThan(count * 1000);
        expect(engine.source.work.unitReads).toBeLessThanOrEqual(count + 1);
        expect((await engine.measure()).bytes).toBe(bytes);
        const projection = new NativeAnthropicEstimateProjection(engine, {
          messages: [],
        });
        const encoder = await getO200kBaseEncoder();
        const request = {
          activeProvider: 'anthropic',
          canonicalModel: settings.model,
          protocol: 'anthropic-messages',
          wireMethod: 'messages/v1',
          finalizedProjection: projection,
          projectionRevision: 4,
          legacyEstimate: async () => 0,
        } satisfies import('@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js').RuntimePromptEstimateRequest;
        const oracle = new NativeAnthropicEstimateProjection(
          { serialize: engine.serialize.bind(engine) },
          { messages: [] },
        );
        const expected = await oracle.measure(request, encoder);
        await oracle.dispose();
        const reads = spyOn(IndexedJournalRequestSnapshot.prototype, 'readAt');
        try {
          const estimate = await projection.measure(request, encoder);
          expect(estimate).toStrictEqual(expected);
          expect(estimate.baseTokens).toBeGreaterThan(count);
          expect(reads.mock.calls.length).toBe(0);
        } finally {
          reads.mockRestore();
          await projection.dispose();
        }
        await verifySingleMeasurement(snapshot);
      } finally {
        await query.close();
        await snapshot.close();
        await session.close();
      }
    }, 180000);
  }
  it('reuses a topology seek while replaying the same merged run', async () => {
    const session = await JournalSession.create(`${directory()}/seek.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    await session.append(
      Array.from(
        { length: 40 },
        (_, at) =>
          ({
            speaker: at % 2 === 0 ? 'human' : 'ai',
            blocks: [{ type: 'text', text: `row ${at}` }],
          }) satisfies import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent,
      ),
    );
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const snapshot = await session.store.snapshot();
    try {
      const facts = await snapshot.nativeFacts(anthropicRepairScope(settings));
      const version = await facts.get(['version']);
      if (version === undefined) throw new Error('Missing fact version');
      let reads = 0;
      const index = await AnthropicRepairIndex.prepared(
        {
          get: (key) => {
            reads++;
            return facts.get(key);
          },
          getBytes: (key) => {
            reads++;
            return facts.getBytes(key);
          },
        },
        version,
      );
      const scan = async (): Promise<number[]> => {
        const starts: number[] = [];
        for await (const message of index.messages(10)) {
          starts.push(message.start);
          if (starts.length === 2) break;
        }
        return starts;
      };
      expect(await scan()).toStrictEqual([10, 11]);
      const before = reads;
      expect(await scan()).toStrictEqual([10, 11]);
      expect(reads - before).toBe(0);
    } finally {
      await snapshot.close();
      await session.close();
    }
  });
  it('decodes a source row once for repeated descriptions and redaction passes', async () => {
    const session = await JournalSession.create(`${directory()}/rows.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    await session.append([
      { speaker: 'ai', blocks: [{ type: 'text', text: 'payload 雪' }] },
    ]);
    const snapshot = await session.store.snapshot();
    const query = await IndexedJournalRequestSnapshot.create(snapshot);
    try {
      const source = new AnthropicRepairSource(query, settings);
      await source.describe(0);
      await source.describe(0);
      const message = {
        start: 0,
        end: 0,
        slot: 'content',
        role: 'assistant',
      } satisfies Parameters<typeof source.pieces>[0];
      const outputs: string[] = [];
      for (const redact of [false, true])
        for await (const piece of source.pieces(message, redact))
          outputs.push(JSON.stringify(piece));
      expect(outputs).toStrictEqual(['"payload 雪"', '"payload 雪"']);
      expect(source.work.unitReads).toBe(1);
    } finally {
      await query.close();
      await snapshot.close();
      await session.close();
    }
  });
});
