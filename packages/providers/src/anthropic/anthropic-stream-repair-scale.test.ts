/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { recordedMessages as emittedCandidate } from './message-table/__tests__/support/recorded-wire-oracle.js';
import { describe, expect, it } from 'bun:test';
import { anthropicRepairFactIndex } from './anthropic-repair-fact-writer.js';
import { createHash } from 'node:crypto';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RowFormatSettings } from '@vybestack/llxprt-code-core/journal/rowFormat.js';

import {
  withAnthropicStreamRepair,
  type AnthropicStreamRepair,
} from './anthropic-stream-repair.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';

const settings: RowFormatSettings = {
  formatId: 'anthropic',
  formatRev: 1,
  model: 'claude-sonnet-4',
  endpoint: 'https://api.anthropic.com',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: true,
  reasoningEnabled: true,
  reasoningFieldName: 'reasoning_content',
  mediaPdfEnabled: true,
  unsupportedMedia: 'notice',
  outputLimits: null,
  anthropic: { cache: 'off', imageBudget: null },
};
const hash = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

interface Work {
  readonly reads: number;
  readonly unitReads: number;
}
function chainRows(count: number): readonly IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ...Array.from(
      { length: count },
      (_, index): IContent => ({
        speaker: 'ai',
        blocks: [
          {
            type: 'thinking',
            sourceField: 'thinking',
            thought: `thought ${index}`,
            signature: `signature ${index}`,
          },
        ],
      }),
    ),
    { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
  ];
}
async function checkStream(
  query: IndexedJournalRequestSnapshot,
  expected: string,
): Promise<number> {
  return withAnthropicStreamRepair(
    query,
    settings,
    { strip: 'allButLast' },
    async (engine) => {
      const actual = createHash('sha256');
      let bytes = 0;
      for await (const chunk of engine.serialize()) {
        actual.update(chunk);
        bytes += Buffer.byteLength(chunk);
      }
      expect(actual.digest('hex')).toBe(hash(expected));
      expect(await engine.measure()).toStrictEqual({ bytes, messages: 3 });
      return engine.source.work.unitReads;
    },
  );
}
async function checkChain(path: string, count: number): Promise<Work> {
  const rows = chainRows(count);
  const expected = await emittedCandidate(
    rows,
    {
      reasoningEnabled: true,
      strip: 'allButLast',
      currentModel: settings.model,
    },
    {},
  );
  const counter = { reads: 0 };
  const session = await JournalSession.create(path, {
    journal: testJournalSeams({ readCounter: counter }, 1, false).dependencies,
  });
  try {
    await session.append(rows);
    const fillStart = counter.reads;
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const fillReads = counter.reads - fillStart;
    const filledPin = await session.store.snapshot();
    const filledVersion = filledPin.version;
    await filledPin.close();
    const warmStart = counter.reads;
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const warmReads = counter.reads - warmStart;
    expect(session.store.published).toBe(filledVersion);
    expect(warmReads).toBeLessThan(30);
    const pin = await session.store.snapshot();
    const query = await IndexedJournalRequestSnapshot.create(pin);
    const base = counter.reads;
    try {
      const unitReads = await checkStream(query, expected);
      const reads = counter.reads - base;
      process.stdout.write(
        `Anthropic chain work ${JSON.stringify({ count, units: query.count, fillReads, warmReads, reads, unitReads, bytes: Buffer.byteLength(expected), pid: process.pid })}\n`,
      );
      return { reads, unitReads };
    } finally {
      await query.close();
      await pin.close();
    }
  } finally {
    await session.close();
  }
}

describe('native Anthropic long-chain stream work', () => {
  const directory = useTempDir('anthropic-repair-scale-');
  let small: Work = { reads: 0, unitReads: 0 };
  it('matches old bytes while streaming 40 chain units with bounded pieces', async () => {
    small = await checkChain(`${directory()}/small.llxj`, 40);
    expect(small.unitReads).toBeLessThan(40 * 32 + 200);
  });
  it('matches old bytes while streaming 4000 chain units with bounded pieces', async () => {
    const large = await checkChain(`${directory()}/large.llxj`, 4000);
    expect(large.unitReads).toBeLessThan(4000 * 32 + 200);
    expect(large.reads).toBeLessThan(small.reads * 250);
    expect(large.unitReads).toBeLessThan(small.unitReads * 105);
  });
});

function repeatedRows(
  count: number,
  ids: number,
  chains: boolean,
): readonly IContent[] {
  return [
    { speaker: 'human', blocks: [{ type: 'text', text: 'q' }] },
    ...Array.from({ length: count }, (_, index): readonly IContent[] => [
      ...Array.from(
        { length: chains ? index % 3 : 0 },
        (_, thought): IContent => ({
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              sourceField: 'thinking',
              thought: `chain ${index} ${thought}`,
              signature: `sig ${index} ${thought}`,
            },
          ],
        }),
      ),
      {
        speaker: 'ai',
        blocks: [
          {
            type: 'tool_call',
            id: `repeat-${index % ids}`,
            name: 'read',
            parameters: {},
          },
        ],
      },
      { speaker: 'human', blocks: [{ type: 'text', text: `next ${index}` }] },
    ]).flat(),
  ];
}

async function collectRepeated(
  engine: AnthropicStreamRepair,
  budget: number,
): Promise<{
  readonly digest: string;
  readonly bytes: number;
  readonly chunks: number;
}> {
  const actual = createHash('sha256');
  let bytes = 0;
  let chunks = 0;
  for await (const chunk of engine.serialize()) {
    actual.update(chunk);
    bytes += Buffer.byteLength(chunk);
    chunks++;
    expect(engine.source.work.unitReads).toBeLessThan(budget);
  }
  return { digest: actual.digest('hex'), bytes, chunks };
}

async function checkRepeated(
  path: string,
  count: number,
  ids: number,
  chains = false,
): Promise<{ readonly actual: string; readonly expected: string }> {
  const rows = repeatedRows(count, ids, chains);
  process.stdout.write(
    `Repeated-ID stage ${JSON.stringify({ count, ids, stage: 'oracle', pid: process.pid })}\n`,
  );
  const expected = await emittedCandidate(
    await normalizedRows(rows),
    {
      reasoningEnabled: true,
      currentModel: settings.model,
    },
    {},
  );
  const counter = { reads: 0 };
  process.stdout.write(
    `Repeated-ID stage ${JSON.stringify({ count, ids, stage: 'append', pid: process.pid })}\n`,
  );
  const session = await JournalSession.create(path, {
    journal: testJournalSeams({ readCounter: counter }, 1, false).dependencies,
  });
  try {
    await session.append(rows);
    process.stdout.write(
      `Repeated-ID stage ${JSON.stringify({ count, ids, stage: 'fill', pid: process.pid })}\n`,
    );
    const fillStart = counter.reads;
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const fillReads = counter.reads - fillStart;
    const filledPin = await session.store.snapshot();
    const filledVersion = filledPin.version;
    await filledPin.close();
    const warmStart = counter.reads;
    await session.store.commit([
      { kind: 'factIndex', registration: anthropicRepairFactIndex(settings) },
    ]);
    const warmReads = counter.reads - warmStart;
    expect(session.store.published).toBe(filledVersion);
    expect(warmReads).toBeLessThan(30);
    const pin = await session.store.snapshot();
    const query = await IndexedJournalRequestSnapshot.create(pin);
    const baseReads = counter.reads;
    const baseLookups = pin.facts.lookups;
    try {
      return await withAnthropicStreamRepair(
        query,
        settings,
        {},
        async (engine) => {
          const unitBudget = 64 * query.count + 200;
          const actual = await collectRepeated(engine, unitBudget);
          try {
            expect((await engine.measure()).bytes).toBe(actual.bytes);
            expect(engine.source.work.unitReads).toBeLessThan(unitBudget);
            const depth = Math.ceil(Math.log2(query.count + 1));
            expect(counter.reads - baseReads).toBeLessThan(
              48 * query.count * (depth + 4),
            );
            expect(pin.facts.lookups - baseLookups).toBeLessThan(
              6 * query.count * (depth + 4),
            );
            return { actual: actual.digest, expected: hash(expected) };
          } finally {
            process.stdout.write(
              `Anthropic repeated-ID work ${JSON.stringify({ count, ids, chains, units: query.count, fillReads, warmReads, reads: counter.reads - baseReads, lookups: pin.facts.lookups - baseLookups, ...engine.source.work, repair: engine.tools.work, bytes: actual.bytes, chunks: actual.chunks, pid: process.pid })}\n`,
            );
          }
        },
      );
    } finally {
      await query.close();
      await pin.close();
    }
  } finally {
    await session.close();
  }
}

describe('native Anthropic repeated-ID repair work', () => {
  const directory = useTempDir('anthropic-repair-repeated-');
  for (const ids of [1, 3]) {
    for (const count of [40, 4000]) {
      it(`bounds replay while preserving bytes for ${count} calls interleaved across ${ids} IDs`, async () => {
        const result = await checkRepeated(
          `${directory()}/repeated.llxj`,
          count,
          ids,
        );
        expect(result.actual).toBe(result.expected);
      });
    }
  }
  for (const count of [40, 4000]) {
    it(`bounds interleaved repair across ${count} chains of different lengths`, async () => {
      const result = await checkRepeated(
        `${directory()}/mixed.llxj`,
        count,
        3,
        true,
      );
      expect(result.actual).toBe(result.expected);
    });
  }
});
