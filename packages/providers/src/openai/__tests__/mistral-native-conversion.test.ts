/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  call,
  response,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import type { IContent } from '../../../../core/src/services/history/IContent.js';
import { assertNativeMistral } from './support/native-mistral-oracle.js';
const cases: ReadonlyArray<{
  readonly name: string;
  readonly rows: readonly IContent[];
  readonly tail: readonly IContent[];
}> = [
  {
    name: 'empty results and unnamed calls',
    rows: [{ speaker: 'tool', blocks: [response('')] }],
    tail: [
      { speaker: 'ai', blocks: [call('', ''), call('toolu_alpha-1', '')] },
    ],
  },
  {
    name: 'human calls whose tool messages are dropped',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'q' }, call('X')] },
      { speaker: 'tool', blocks: [response('X')] },
    ],
    tail: [
      { speaker: 'ai', blocks: [call('Y')] },
      { speaker: 'tool', blocks: [response('Y')] },
    ],
  },
  {
    name: 'reconstruction before later duplicate',
    rows: [{ speaker: 'tool', blocks: [response('toolu_alpha-1')] }],
    tail: [
      {
        speaker: 'ai',
        blocks: [
          call('4SftZvDMX'),
          call('toolu_alpha-1', 'other'),
          call('toolu_alpha-1', ''),
        ],
      },
    ],
  },
  {
    name: 'pending observed holder reserves before earlier lazy emission',
    rows: [{ speaker: 'ai', blocks: [call('')] }],
    tail: [
      {
        speaker: 'ai',
        blocks: [call('4Q3rUlnAu'), call('4SftZvDMX'), call('toolu_alpha-1')],
      },
    ],
  },
];

describe('native Mistral actual conversion', () => {
  const directory = useTempDir('mistral-conversion-');
  it('matches the old normalizer and chat converter including lazy allocations', async () => {
    for (const [index, fixture] of cases.entries()) {
      const session = await JournalSession.create(
        `${directory()}/${index}.llxj`,
        { journal: testJournalSeams().dependencies },
      );
      try {
        await session.store.commit([{ kind: 'mistral', slot: 0 }]);
        await session.append(fixture.rows);
        const pin = await session.store.snapshot();
        const request = await IndexedJournalRequestSnapshot.create(
          pin,
          fixture.tail,
        );
        try {
          const units = await oldTailUnits(fixture.rows, fixture.tail);
          expect(request.count).toBe(units.length);
          await request.withMistral(0, (view) =>
            assertNativeMistral(() => request.openReader(), units, view),
          );
        } finally {
          await request.close();
          await pin.close();
        }
      } finally {
        await session.close();
      }
    }
  });

  it('changes actual conversion salt after removal without changing a pinned request', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
    ];
    const oldUnits = await oldTailUnits(rows, []);
    const survivingUnits = await oldTailUnits(rows.slice(1), []);
    const session = await JournalSession.create(`${directory()}/removed.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const holder = await pin.entryAt(0);
        await session.store.commit([
          { kind: 'density', removed: [holder.label], replacements: [] },
        ]);
        await request.withMistral(0, (view) =>
          assertNativeMistral(() => request.openReader(), oldUnits, view),
        );
        expect((await request.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(
          1,
        );
        const fresh = await session.store.snapshot();
        const after = await IndexedJournalRequestSnapshot.create(fresh);
        try {
          await after.withMistral(0, (view) =>
            assertNativeMistral(() => after.openReader(), survivingUnits, view),
          );
          expect((await after.mistralMapping('toolu_alpha-1', 0))?.salt).toBe(
            0,
          );
        } finally {
          await after.close();
          await fresh.close();
        }
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });

  it('rebuilds a filtered request with fresh observed and response-only allocations', async () => {
    const rows: readonly IContent[] = [
      { speaker: 'ai', blocks: [call('4SftZvDMX')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
      { speaker: 'tool', blocks: [response('toolu_alpha-1')] },
      { speaker: 'ai', blocks: [call('other raw')] },
    ];
    const session = await JournalSession.create(
      `${directory()}/filtered.llxj`,
      { journal: testJournalSeams().dependencies },
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const pin = await session.store.snapshot();
      const request = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const units = await oldTailUnits(rows, []);
        for (const indices of [[2, 3], [3], [3, 4], [0, 2, 3]]) {
          await request.withMistralSelection(
            session.store,
            0,
            indices,
            async (selected) => {
              await assertNativeMistral(
                () => selected.openReader(),
                indices.map((index) => units[index]),
                selected,
              );
              expect((await selected.resolve('toolu_alpha-1')).salt).toBe(
                indices.includes(0) ? 1 : 0,
              );
            },
          );
        }
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  });
});
