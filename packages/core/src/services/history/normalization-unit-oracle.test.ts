/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import {
  UNIT_CASE_COUNT,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import {
  oldUnits,
  digest,
  collectUnits,
} from './__tests__/support/normalization-oracle.js';
import { JournalSession } from './journalSession.js';
import { streamJournalOrphanUnits } from './journal-orphan-units.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import type { IContent } from './IContent.js';

const record = z
  .object({
    seed: z.number().int(),
    inputHash: z.string(),
    outputHash: z.string(),
    count: z.number().int(),
    pending: z.array(z.boolean()),
    firstOutputIndex: z.number().int().optional(),
  })
  .strict();
const fixture = new URL(
  './__tests__/fixtures/normalization-units.jsonl',
  import.meta.url,
);

describe('immutable old-normalizer unit oracle', () => {
  const directory = useTempDir('unit-oracle-');

  it('matches all 5000 frozen input, unit and pending hashes without regenerating them', async () => {
    const lines = (await readFile(fixture, 'utf8')).trimEnd().split('\n');
    expect(lines.length).toBe(UNIT_CASE_COUNT);
    for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
      const frozen = record.parse(JSON.parse(lines[seed]));
      expect({ seed, ...(await oldUnits(unitCase(seed))) }).toStrictEqual({
        ...frozen,
        firstOutputIndex: frozen.firstOutputIndex,
      });
    }
  }, 120000);

  it('matches the frozen subset admitted by the indexed orphan-only stream', async () => {
    const lines = (await readFile(fixture, 'utf8')).trimEnd().split('\n');
    const session = await JournalSession.create(`${directory()}/units.llxj`, {
      journal: testJournalSeams().dependencies,
    });
    let checked = 0;
    try {
      for (let seed = 0; seed < UNIT_CASE_COUNT; seed++) {
        const input = unitCase(seed);
        if (
          input.tail.length !== 0 ||
          input.rows.some((row) =>
            row.blocks.some((block) => block.type === 'tool_response'),
          )
        )
          continue;
        const frozen = record.parse(JSON.parse(lines[seed]));
        expect(digest(input)).toBe(frozen.inputHash);
        await session.store.commit([
          { kind: 'replace', rows: input.rows.map((row) => encode(row)) },
        ]);
        const snapshot = await session.store.snapshot();
        try {
          const units = await collectUnits(streamJournalOrphanUnits(snapshot));
          expect({ hash: digest(units), count: units.length }).toStrictEqual({
            hash: frozen.outputHash,
            count: frozen.count,
          });
          checked++;
        } finally {
          await snapshot.close();
        }
      }
      expect(checked).toBe(1436);
    } finally {
      await session.close();
    }
  }, 120000);
});

import { encodeContentRow } from './journalRowCodec.js';
function encode(row: IContent): ReturnType<typeof encodeContentRow> {
  return encodeContentRow(row, { owner: 0 });
}
