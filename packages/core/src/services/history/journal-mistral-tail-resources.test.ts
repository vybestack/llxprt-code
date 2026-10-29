/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFile, readFile, readdir } from 'node:fs/promises';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { RowDraft } from '../../journal/rowDraft.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';

async function recordReadings(
  size: number,
  calls: number,
  readings: Readonly<Record<string, number>>,
): Promise<void> {
  const output = process.env['MISTRAL_TAIL_MEASUREMENTS'];
  if (output !== undefined)
    await appendFile(
      output,
      JSON.stringify({ size, calls, readings, pid: process.pid }) + '\n',
    );
}

describe('request Mistral read budgets', () => {
  const directory = useTempDir('mistral-tail-resources-');
  for (const { size, calls } of [
    { size: 40, calls: 40 },
    { size: 4000, calls: 4000 },
    { size: 100000, calls: 4000 },
  ])
    it(`continues a fixed pending input over ${size} rows and ${calls} calls without a history scan`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${size}.llxj`,
        { journal: testJournalSeams({}, size, false).dependencies },
      );
      try {
        function* rows(): Generator<RowDraft> {
          for (let index = 0; index < size; index++)
            yield encodeContentRow(
              index < calls - 1 || index === size - 1
                ? {
                    speaker: 'ai',
                    blocks: [call(`raw-${Math.min(index, calls - 1)}`)],
                  }
                : {
                    speaker: 'human',
                    blocks: [{ type: 'text', text: `row-${index}` }],
                  },
              { owner: 0 },
            );
        }
        await session.store.commit([{ kind: 'mistral', slot: 0 }]);
        await session.store.commit([{ kind: 'replace', rows: rows() }]);
        const { snapshot, stats } = await measuredRequestSnapshot(session);
        const request = await IndexedJournalRequestSnapshot.create(snapshot, [
          { speaker: 'tool', blocks: [response('raw-0')] },
          {
            speaker: 'ai',
            blocks: [
              call('4SftZvDMX'),
              call('toolu_alpha-1'),
              call('raw-0', ''),
            ],
          },
        ]);
        const readings: Record<string, number> = { prepare: stats.heads };
        try {
          expect(stats.heads).toBeLessThan(120);
          stats.heads = 0;
          expect((await request.mistralMapping('toolu_alpha-1', 0))?.id).toBe(
            '4Uq1sY29c',
          );
          readings.tailMapping = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(await request.mistralMapping('raw-0', 0)).toStrictEqual(
            await snapshot.mistralMapping('raw-0', 0),
          );
          readings.duplicateMapping = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          stats.heads = 0;
          expect(
            (await request.mistralMapping(`raw-${calls - 1}`, 0))?.id,
          ).toHaveLength(9);
          readings.nativeMapping = stats.heads;
          expect(stats.heads).toBeLessThan(150);
          expect({ blocks: stats.blocks, bodies: stats.bodies }).toStrictEqual({
            blocks: 0,
            bodies: 0,
          });
          await recordReadings(size, calls, readings);
        } finally {
          await request.close();
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    }, 120000);

  it('creates no operation files and leaves persistent bytes unchanged during pending queries', async () => {
    const file = `${directory()}/unchanged.llxj`;
    const session = await JournalSession.create(file, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append([{ speaker: 'ai', blocks: [call('4SftZvDMX')] }]);
      const pin = await session.store.snapshot();
      const before = await readFile(file);
      const files = await readdir(directory());
      const request = await IndexedJournalRequestSnapshot.create(pin, [
        { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
      ]);
      try {
        expect((await request.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(
          1,
        );
      } finally {
        await request.close();
        await pin.close();
      }
      expect(Buffer.compare(before, await readFile(file))).toBe(0);
      expect(
        Buffer.compare(
          Buffer.from(JSON.stringify(files)),
          Buffer.from(JSON.stringify(await readdir(directory()))),
        ),
      ).toBe(0);
    } finally {
      await session.close();
    }
  });
});
