/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalSession } from './journalSession.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';

import {
  assertTailQueries,
  oldTailUnits,
} from './__tests__/support/tail-query-oracle.js';

async function assertReadUnits(
  indexed: IndexedJournalRequestSnapshot,
  units: readonly IContent[],
): Promise<void> {
  for (let index = 0; index < units.length; index++)
    expect(await indexed.readAt(index)).toStrictEqual(units[index]);
}

describe('normalized pending-input query view', () => {
  const directory = useTempDir('tail-queries-');
  const cases: ReadonlyArray<{
    name: string;
    rows: readonly IContent[];
    tail: readonly IContent[];
  }> = [
    {
      name: 'stateful response cursor excludes a duplicate call response before the cursor',
      rows: [
        { speaker: 'ai', blocks: [call('a')] },
        { speaker: 'tool', blocks: [response('a')] },
      ],
      tail: [{ speaker: 'ai', blocks: [call('a'), call(''), call('call_')] }],
    },
    {
      name: 'cross-speaker tail creates an earlier adjacent unit and shifts later positions',
      rows: [
        { speaker: 'human', blocks: [call('a')] },
        { speaker: 'ai', blocks: [call('b')] },
      ],
      tail: [{ speaker: 'ai', blocks: [call('a')] }],
    },
    {
      name: 'tail best wins without moving its normalized response slot',
      rows: [
        { speaker: 'ai', blocks: [call('a')] },
        { speaker: 'tool', blocks: [response('a', false)] },
      ],
      tail: [{ speaker: 'tool', blocks: [response('a')] }],
    },
    {
      name: 'equal-score tail keeps the earlier response',
      rows: [
        { speaker: 'ai', blocks: [call('a')] },
        { speaker: 'tool', blocks: [response('a')] },
      ],
      tail: [
        { speaker: 'tool', blocks: [{ ...response('a'), result: 'later' }] },
      ],
    },
    {
      name: 'reconstructed duplicate responses share positions',
      rows: [{ speaker: 'human', blocks: [{ type: 'text', text: 'q' }] }],
      tail: [{ speaker: 'tool', blocks: [response('a'), response('a')] }],
    },
    {
      name: 'empty IDs and normalized prefix collisions retain multiplicity',
      rows: [
        {
          speaker: 'ai',
          blocks: [call(''), call('call_'), call('hist_tool_x')],
        },
      ],
      tail: [
        { speaker: 'tool', blocks: [response('call_'), response('toolu_x')] },
        { speaker: 'ai', blocks: [call('toolu_x'), call('call_x')] },
      ],
    },
    {
      name: 'split tool row projects part-one reconstructed responses after part-zero adjacency',
      rows: [
        { speaker: 'tool', blocks: [call('a'), response('b')] },
        { speaker: 'ai', blocks: [call('c')] },
      ],
      tail: [{ speaker: 'tool', blocks: [response('a')] }],
    },
  ];
  for (const input of cases)
    it(`${input.name}`, async () => {
      const session = await JournalSession.create(
        `${directory()}/${cases.indexOf(input)}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.append(input.rows);
        const snapshot = await session.store.snapshot();
        const indexed = await IndexedJournalRequestSnapshot.create(
          snapshot,
          input.tail,
        );
        try {
          const units = await oldTailUnits(input.rows, input.tail);
          expect(indexed.pending.inputCount).toBe(input.tail.length);
          await assertTailQueries(indexed, units, [
            ...input.rows,
            ...input.tail,
          ]);
          await assertReadUnits(indexed, units);
        } finally {
          await indexed.close();
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    });
});
