/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { JournalSession } from '../../../../core/src/services/history/journalSession.js';
import { IndexedJournalRequestSnapshot } from '../../../../core/src/services/history/indexed-journal-request-snapshot.js';
import { testJournalSeams } from '../../../../core/src/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import {
  UNIT_CASE_COUNT,
  unitCase,
} from '../../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { oldTailUnits } from '../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { encodeContentRow } from '../../../../core/src/services/history/journalRowCodec.js';
import { assertNativeMistral } from './support/native-mistral-oracle.js';

describe('native Mistral frozen actual converter differential', () => {
  const directory = useTempDir('mistral-native-frozen-');
  it('converts every unchanged Stage A input and a fresh filtered selection without exclusions', async () => {
    const session = await JournalSession.create(`${directory()}/all.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    let converted = 0;
    let selected = 0;
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
        const input = unitCase(seed);
        const units = await oldTailUnits(input.rows, input.tail);
        await session.store.commit([
          {
            kind: 'replace',
            rows: input.rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        const pin = await session.store.snapshot();
        const request = await IndexedJournalRequestSnapshot.create(
          pin,
          input.tail,
        );
        try {
          await request.withMistral(0, (view) =>
            assertNativeMistral(() => request.openReader(), units, view),
          );
          converted++;
          const indices = units.flatMap((_unit, index) =>
            (index + seed) % 3 === 0 ? [] : [index],
          );
          await request.withMistralSelection(
            session.store,
            0,
            indices,
            (view) =>
              assertNativeMistral(
                () => view.openReader(),
                indices.map((index) => units[index]),
                view,
              ),
          );
          selected++;
        } finally {
          await request.close();
          await pin.close();
        }
      }
    } finally {
      await session.close();
    }
    expect({
      converted,
      selected,
      unsupported: UNIT_CASE_COUNT - converted,
    }).toStrictEqual({ converted: 5000, selected: 5000, unsupported: 0 });
  }, 120000);
});
