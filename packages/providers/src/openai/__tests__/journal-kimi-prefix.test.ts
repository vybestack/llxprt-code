/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  call,
  response,
  unitCase,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { encodeContentRow } from '../../../../core/src/services/history/journalRowCodec.js';
import {
  assertKimiFacts,
  assertKimiCounters,
  assertNativeKimi,
} from './support/native-kimi-oracle.js';

function namedRows(count: number): IContent[] {
  return Array.from(
    { length: count },
    (_, index): IContent => ({
      speaker: 'ai',
      blocks: [call(`named-${index}`)],
    }),
  );
}

async function verifyRows(
  session: JournalSession,
  rows: readonly IContent[],
): Promise<void> {
  await session.store.commit([
    {
      kind: 'replace',
      rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
    },
  ]);
  const units = await oldTailUnits(rows, []);
  const snapshot = await session.store.snapshot();
  const request = await IndexedJournalRequestSnapshot.create(snapshot);
  try {
    await assertKimiFacts(snapshot, units);
    await assertNativeKimi(request, units);
  } finally {
    await request.close();
    await snapshot.close();
  }
}

describe('Kimi consumed prefixes and written digits against actual conversion', () => {
  const directory = useTempDir('kimi-prefix-wire-');
  it('separates dropped counter consumption from written digits at every decimal boundary and on frozen source families', async () => {
    const session = await JournalSession.create(`${directory()}/digits.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const cases: ReadonlyArray<readonly IContent[]> = [
      [{ speaker: 'tool', blocks: [call('', 'split'), response('')] }],
      [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }, call('human', '')],
        },
        { speaker: 'tool', blocks: [response('human')] },
      ],
      [
        {
          speaker: 'tool',
          blocks: [{ ...response('orphan'), toolName: '' }, response('orphan')],
        },
      ],
      ...[8, 9, 10, 98, 99, 100, 998, 999, 1000].map((size): IContent[] => [
        ...namedRows(size),
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'q' }, call('h', '')],
        },
        { speaker: 'tool', blocks: [response('h')] },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'keep' },
            call('u', ''),
            call('', '空"\\\n😀\ud800'),
            call('u', ''),
          ],
        },
      ]),
      [
        {
          speaker: 'tool',
          blocks: [call('split', ''), response('r'), response('r')],
        },
        { speaker: 'ai', blocks: [call('r', 'renamed😀')] },
      ],
      ...Array.from({ length: 120 }, (_, seed) => {
        const input = unitCase(seed);
        return [...input.rows, ...input.tail];
      }),
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      let converted = 0;
      for (const rows of cases) {
        await verifyRows(session, rows);
        converted++;
      }
      expect(converted).toBe(133);
    } finally {
      await session.close();
    }
  }, 120000);

  it('projects counters before each normalized unit after a pending eligible duplicate maps earlier unnamed holders', async () => {
    const session = await JournalSession.create(`${directory()}/tail.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    const rows: readonly IContent[] = [
      {
        speaker: 'ai',
        blocks: [
          { type: 'text', text: 'keep' },
          call('x', ''),
          call('', 'empty'),
        ],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'keep' }, call('x', ''), call('y', '')],
      },
    ];
    const tail: readonly IContent[] = [
      { speaker: 'tool', blocks: [response('y')] },
      { speaker: 'human', blocks: [call('x', 'last😀')] },
      { speaker: 'ai', blocks: [call('', 'tail')] },
    ];
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      await session.append(rows);
      const expectedUnits = await oldTailUnits(rows, tail);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin, tail);
      try {
        await assertNativeKimi(request, expectedUnits);
        await assertKimiCounters(request, expectedUnits);
        expect(await pin.kimiUnmappedCount()).toBe(6);
        await expect(request.kimiCounterBefore(-1)).rejects.toThrow(
          'outside the request',
        );
        await expect(
          request.kimiCounterBefore(request.count + 1),
        ).rejects.toThrow('outside the request');
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
