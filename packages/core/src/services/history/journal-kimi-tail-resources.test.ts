/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

describe('request Kimi metadata read bounds', () => {
  async function recordReadings(
    size: number,
    readings: Readonly<Record<string, number>>,
  ): Promise<void> {
    const output = process.env['KIMI_TAIL_MEASUREMENTS'];
    if (output !== undefined)
      await appendFile(
        output,
        JSON.stringify({ size, readings, pid: process.pid }) + '\n',
      );
  }

  const directory = useTempDir('kimi-tail-resources-');
  for (const { size, calls } of [
    { size: 40, calls: 40 },
    { size: 4000, calls: 4000 },
    { size: 100000, calls: 4000 },
  ])
    it(`maps a fixed tail over ${size} rows with ${calls} calls without scanning or decoding history`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${size}.llxj`,
        {
          journal: testJournalSeams({}, size, false).dependencies,
        },
      );
      try {
        function* rows(): Generator<RowDraft> {
          for (let index = 0; index < size; index++)
            yield encodeContentRow(
              index < calls - 1 || index === size - 1
                ? {
                    speaker: 'ai',
                    blocks: [call(`id-${Math.min(index, calls - 1)}`)],
                  }
                : {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: `row-${index}` }],
                  },
              { owner: 0 },
            );
        }
        await session.store.commit([{ kind: 'kimi' }]);
        await session.store.commit([{ kind: 'replace', rows: rows() }]);
        const { snapshot, stats } = await measuredRequestSnapshot(session);
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'tool', blocks: [response('id-0')] },
          { speaker: 'human', blocks: [call('id-0', 'tail')] },
          { speaker: 'ai', blocks: [call('', 'empty')] },
        ]);
        const readings: Record<string, number> = { prepare: stats.heads };
        try {
          expect(stats.heads).toBeLessThan(120);
          stats.heads = 0;
          expect(await indexed.kimiEligibleCount()).toBe(calls + 1);
          readings.count = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.kimiCounterBefore(indexed.count - 1)).toBe(
            calls + 1,
          );
          readings.counter = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.kimiCounterBefore(indexed.count)).toBe(
            calls + 2,
          );
          readings.endCounter = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.kimiOrdinal('id-0')).toBe(calls);
          readings.ordinal = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.kimiMappedId('id-0')).toBe(
            `functions.tail:${calls}`,
          );
          readings.tailMapping = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          stats.heads = 0;
          expect(await indexed.kimiMappedId(`id-${calls - 1}`)).toBe(
            `functions.inspect:${calls - 1}`,
          );
          readings.journalMapping = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 1,
            bodies: 0,
          });
          await recordReadings(size, { ...readings, calls });
        } finally {
          await indexed.close();
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    }, 120000);
});
