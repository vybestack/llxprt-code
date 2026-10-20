/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

async function rangePositions(
  indexed: IndexedJournalRequestSnapshot,
): Promise<readonly number[]> {
  const positions: number[] = [];
  for await (const at of indexed.normalizedRange(1, 1, 'call_b', {
    from: 2,
    to: indexed.count,
  }))
    positions.push(at);
  return positions;
}

async function recordReadings(
  size: number,
  readings: Readonly<Record<string, number>>,
): Promise<void> {
  const output = process.env['TAIL_QUERY_MEASUREMENTS'];
  if (output !== undefined)
    await appendFile(
      output,
      JSON.stringify({ size, readings, pid: process.pid }) + '\n',
    );
}

describe('normalized request-tail read bounds', () => {
  const directory = useTempDir('tail-query-resources-');
  for (const size of [40, 4000, 100000])
    it(`projects a fixed tail over ${size} rows without scanning or decoding bodies`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${size}.llxj`,
        { journal: testJournalSeams({}, size, false).dependencies },
      );
      try {
        function* rows(): Generator<RowDraft> {
          yield encodeContentRow(
            { speaker: 'human', blocks: [call('a')] },
            { owner: 0 },
          );
          yield encodeContentRow(
            { speaker: 'ai', blocks: [call('b')] },
            { owner: 0 },
          );
          for (let index = 2; index < size; index++)
            yield encodeContentRow(
              {
                speaker: 'human',
                blocks: [{ type: 'text', text: `not-read-${index}` }],
              },
              { owner: 0 },
            );
        }
        await session.store.commit([{ kind: 'replace', rows: rows() }]);
        const { snapshot, stats } = await measuredRequestSnapshot(session);
        const indexed = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'ai', blocks: [call('a')] },
        ]);
        const readings: Record<string, number> = { prepare: stats.heads };
        try {
          expect(stats.heads).toBeLessThan(120);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          stats.heads = 0;
          expect(await indexed.normalizedCount(1, 0, 'call_b')).toBe(1);
          readings.count = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.firstAfter(1, 0, 'call_b', -1)).toBe(2);
          readings.successor = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await indexed.lastAtOrAfter(2, 1, 'toolu_a', 1)).toBe(true);
          readings.last = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          const positions = await rangePositions(indexed);
          readings.range = stats.heads;
          expect(positions).toStrictEqual([3]);
          expect(stats.heads).toBeLessThan(150);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          expect((await indexed.readAt(2)).blocks).toStrictEqual([call('b')]);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 1,
            bodies: 0,
          });
          await recordReadings(size, readings);
        } finally {
          await indexed.close();
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    }, 120000);
});
