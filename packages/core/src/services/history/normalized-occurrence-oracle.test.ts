/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { ROW_FLAG } from '../../journal/rowRecord.js';
import {
  UNIT_CASE_COUNT,
  unitCase,
} from './__tests__/support/normalization-cases.js';
import { digest } from './__tests__/support/normalization-oracle.js';
import { assertNormalizedOccurrences } from './__tests__/support/normalized-occurrence-oracle.js';
import { JournalSession } from './journalSession.js';
import { encodeContentRow } from './journalRowCodec.js';
import { isCuratedContent } from './historyCuration.js';
import { buildProviderContent } from './historyProviderPipeline.js';

const frozenRecord = z.object({
  inputHash: z.string(),
  outputHash: z.string(),
});

async function verifyCase(
  session: JournalSession,
  seed: number,
  line: string,
): Promise<void> {
  const input = unitCase(seed);
  const frozen = frozenRecord.parse(JSON.parse(line));
  expect(digest(input)).toBe(frozen.inputHash);
  const units = buildProviderContent(
    input.rows.filter(isCuratedContent),
    [...input.tail],
    new DebugLogger('normalized-fact-oracle'),
  );
  expect(digest(units)).toBe(frozen.outputHash);
  const rows = [...input.rows.filter(isCuratedContent), ...input.tail];
  await session.store.commit([
    {
      kind: 'replace',
      rows: rows.map((row) => {
        const draft = encodeContentRow(row, { owner: 0 });
        return { ...draft, flags: draft.flags | ROW_FLAG.curated };
      }),
    },
  ]);
  const snapshot = await session.store.snapshot();
  try {
    expect(snapshot.units).toBe(units.length);
    await assertNormalizedOccurrences(snapshot, units, rows);
  } finally {
    await snapshot.close();
  }
}

describe('normalized occurrence frozen differential', () => {
  const directory = useTempDir('normalized-occurrence-oracle-');

  it('matches counts and every occurrence against all 5000 unchanged old-normalizer outputs', async () => {
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
      journal: testJournalSeams().dependencies,
    });
    try {
      for (let seed = 0; seed < UNIT_CASE_COUNT; seed++)
        await verifyCase(session, seed, lines[seed]);
    } finally {
      await session.close();
    }
  }, 120000);
});
