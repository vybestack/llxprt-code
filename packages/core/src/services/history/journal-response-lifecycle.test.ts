/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { createRowCounters } from '../../recording/journalCounters.js';
import { JournalSession } from './journalSession.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { streamJournalResponseUnits } from './journal-response-units.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import { MEDIA_REFERENCE } from './__tests__/support/journalRowShapes.js';
import {
  digest,
  collectUnits,
  oldUnits,
} from './__tests__/support/normalization-oracle.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';

function charge(row: IContent): number {
  return Buffer.byteLength(JSON.stringify(row), 'utf8');
}

async function checkNative(
  session: JournalSession,
  rows: readonly IContent[],
): Promise<void> {
  const expected = await oldUnits({ id: 'mutation', rows, tail: [] });
  const snapshot = await session.store.snapshot();
  try {
    const units = await collectUnits(streamJournalResponseUnits(snapshot));
    expect({ hash: digest(units), count: units.length }).toStrictEqual({
      hash: expected.outputHash,
      count: expected.count,
    });
  } finally {
    await snapshot.close();
  }
}

describe('indexed response lifetime and native mutation boundaries', () => {
  const directory = useTempDir('response-lifecycle-');

  it('charges response JSON and media for the full asynchronous yield, then releases on cancellation', async () => {
    const session = await JournalSession.create(`${directory()}/charged.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const ownership = new RowOwnership();
    const meter = createRowCounters();
    const counters = { ...meter.counters, ownership };
    try {
      await session.append([
        { speaker: 'ai', blocks: [call('a')] },
        {
          speaker: 'tool',
          blocks: [
            { ...response('a'), result: { payload: 'x'.repeat(256 * 1024) } },
            {
              type: 'media',
              mimeType: 'image/png',
              data: 'YWJj'.repeat(65536),
              encoding: 'base64',
            },
            MEDIA_REFERENCE,
          ],
        },
      ]);
      const snapshot = await session.store.snapshot();
      const reader = streamJournalResponseUnits(snapshot, [], counters);
      try {
        const first = await reader.next();
        if (first.done === true) throw new Error('Missing call unit');
        await Promise.resolve();
        expect(ownership.snapshot().liveSerializedBytes).toBe(
          charge(first.value),
        );
        const next = await reader.next();
        if (next.done === true) throw new Error('Missing response unit');
        await Promise.resolve();
        expect(ownership.snapshot().liveSerializedBytes).toBe(
          charge(next.value),
        );
        expect(ownership.snapshot().liveSerializedBytes).toBeGreaterThan(
          512 * 1024,
        );
        expect(
          next.value.blocks.filter(
            (block) => block.type === 'media' && block.encoding === 'reference',
          ),
        ).toStrictEqual([MEDIA_REFERENCE]);
        expect(ownership.snapshot().liveRows).toBe(1);
      } finally {
        await reader.return(undefined);
        await snapshot.close();
      }
      expect({
        rows: ownership.snapshot().liveRows,
        bytes: ownership.snapshot().liveSerializedBytes,
        peak: meter.snapshot().peakDecodedRows,
      }).toStrictEqual({ rows: 0, bytes: 0, peak: 1 });
    } finally {
      await session.close();
    }
  });

  it.each([100, 1000])(
    'selects the end of a %i-response chain without reading its prefix',
    async (length) => {
      const reads = { reads: 0 };
      const session = await JournalSession.create(
        `${directory()}/chain-${length}.llxj`,
        {
          journal: testJournalSeams({ readCounter: reads }, 1, false)
            .dependencies,
        },
      );
      try {
        const rows: IContent[] = [
          { speaker: 'ai', blocks: [call('a')] },
          ...Array.from(
            { length },
            (_, index): IContent => ({
              speaker: 'tool',
              blocks: [
                {
                  ...response('a', index === length - 1),
                  result: index === length - 1 ? 'best' : null,
                },
              ],
            }),
          ),
        ];
        await session.append(rows);
        const snapshot = await session.store.snapshot();
        const reader = streamJournalResponseUnits(snapshot);
        reads.reads = 0;
        try {
          await reader.next();
          const selected = await reader.next();
          if (selected.done === true)
            throw new Error('Missing selected response');
          expect(selected.value.blocks).toStrictEqual(
            [response('a')].map((block) => ({ ...block, result: 'best' })),
          );
          expect(reads.reads).toBeLessThan(100);
        } finally {
          try {
            await reader.return(undefined);
          } finally {
            await snapshot.close();
          }
        }
      } finally {
        await session.close();
      }
    },
  );

  it('keeps label and split-block references correct after owner reuse, rebuild and reopen', async () => {
    const path = `${directory()}/mutated.llxj`;
    const options = { journal: testJournalSeams().dependencies };
    const session = await JournalSession.create(path, options);
    const human: IContent = {
      speaker: 'human',
      blocks: [call('a'), { type: 'text', text: 'question' }],
    };
    const split: IContent = {
      speaker: 'tool',
      blocks: [
        { type: 'text', text: 'source' },
        call('b'),
        response('b'),
        response('a'),
      ],
    };
    const better: IContent = {
      speaker: 'tool',
      blocks: [{ ...response('a'), result: 'replacement' }, MEDIA_REFERENCE],
    };
    try {
      await session.append([human], { owner: 7 });
      await session.append([split], { owner: 8 });
      await checkNative(session, [human, split]);
      await session.store.commit([
        {
          kind: 'density',
          removed: [],
          replacements: [
            { label: 2097152n, draft: encodeContentRow(better, { owner: 8 }) },
          ],
        },
      ]);
      await checkNative(session, [human, better]);
      await session.store.commit([
        {
          kind: 'replace',
          rows: [
            encodeContentRow(human, { owner: 8 }),
            encodeContentRow(split, { owner: 7 }),
          ],
        },
      ]);
      await checkNative(session, [human, split]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path, options);
    try {
      await checkNative(reopened, [human, split]);
      const owners: number[] = [];
      for await (const row of reopened.rows()) owners.push(row.entry.owner);
      expect(owners).toStrictEqual([8, 7]);
    } finally {
      await reopened.close();
    }
  });
});
