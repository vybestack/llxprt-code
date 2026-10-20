/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import {
  UNIT_CASE_COUNT,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import { digest } from './__tests__/support/normalization-oracle.js';
import {
  assertTailQueries,
  oldTailUnits,
} from './__tests__/support/tail-query-oracle.js';

function assertPending(
  indexed: IndexedJournalRequestSnapshot,
  pending: readonly boolean[],
): void {
  for (let index = 0; index < pending.length; index++)
    expect(indexed.isPending(index)).toBe(pending[index]);
}

const frozenRecord = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
  count: z.number(),
  pending: z.array(z.boolean()),
  firstOutputIndex: z.number().optional(),
});

describe('normalized request-tail frozen differential', () => {
  const directory = useTempDir('tail-query-oracle-');
  it('matches count, selection, last, successor and cursor ranges for all 5000 unchanged inputs', async () => {
    const lines = (
      await readFile(
        new URL(
          './__tests__/fixtures/normalization-units.jsonl',
          import.meta.url,
        ),
        'utf8',
      )
    )
      .trimEnd()
      .split('\n');
    expect(lines.length).toBe(UNIT_CASE_COUNT);
    const session = await JournalSession.create(`${directory()}/oracle.llxj`, {
      journal: testJournalSeams({}, 1, false).dependencies,
    });
    try {
      for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
        const input = unitCase(seed);
        const frozen = frozenRecord.parse(JSON.parse(lines[seed]));
        expect(digest(input)).toBe(frozen.inputHash);
        const units = await oldTailUnits(input.rows, input.tail);
        expect(digest(units)).toBe(frozen.outputHash);
        await session.store.commit([
          {
            kind: 'replace',
            rows: input.rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        const snapshot = await session.store.snapshot();
        const indexed = await IndexedJournalRequestSnapshot.create(
          snapshot,
          input.tail,
        );
        try {
          await assertTailQueries(indexed, units, [
            ...input.rows,
            ...input.tail,
          ]);
          expect(indexed.count).toBe(frozen.count);
          expect(indexed.pending.firstOutputIndex).toBe(
            frozen.firstOutputIndex,
          );
          expect(indexed.pending.inputCount).toBe(input.tail.length);
          assertPending(indexed, frozen.pending);
        } finally {
          await indexed.close();
          await snapshot.close();
        }
      }
    } finally {
      await session.close();
    }
  }, 120000);
});
