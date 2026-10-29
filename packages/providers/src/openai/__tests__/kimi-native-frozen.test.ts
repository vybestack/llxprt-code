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
import {
  assertKimiFacts,
  assertKimiCounters,
  assertNativeKimi,
} from './support/native-kimi-oracle.js';

describe('native Kimi frozen actual converter differential', () => {
  const directory = useTempDir('kimi-native-frozen-');
  it('keeps all 5000 frozen inputs unchanged and compares complete conversion and each unit counter without exclusions', async () => {
    const session = await JournalSession.create(`${directory()}/all.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    let converted = 0;
    try {
      await session.store.commit([{ kind: 'kimi' }]);
      for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
        const input = unitCase(seed);
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
          await assertKimiFacts(pin, await oldTailUnits(input.rows, []));
          const units = await oldTailUnits(input.rows, input.tail);
          await assertNativeKimi(request, units);
          await assertKimiCounters(request, units);
          converted++;
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
      unsupported: UNIT_CASE_COUNT - converted,
    }).toStrictEqual({ converted: 5000, unsupported: 0 });
  }, 120000);
});
