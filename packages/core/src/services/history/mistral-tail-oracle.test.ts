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
import { oldTailUnits } from './__tests__/support/tail-query-oracle.js';
import { assertMistralTail } from './__tests__/support/mistral-tail-oracle.js';

const frozenRecord = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
});

describe('Mistral request-tail frozen differential', () => {
  const directory = useTempDir('mistral-tail-oracle-');
  it('matches the independent old normalizer and tools mapper for all 5000 unchanged inputs', async () => {
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
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
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
        const pin = await session.store.snapshot();
        const indexed = await IndexedJournalRequestSnapshot.create(
          pin,
          input.tail,
        );
        try {
          await assertMistralTail(indexed, units);
          expect(digest(input)).toBe(frozen.inputHash);
        } finally {
          await indexed.close();
          await pin.close();
        }
      }
    } finally {
      await session.close();
    }
  }, 120000);
});
