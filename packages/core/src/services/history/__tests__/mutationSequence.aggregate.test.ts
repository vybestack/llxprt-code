/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'bun:test';
import type { Aggregate } from '../../../journal/aggregate.js';
import { CHRONOLOGY_SEQ_NONE } from '../../../journal/rowRecord.js';
import { testJournalSeams } from '../../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../journal/__tests__/support/useTempDir.js';
import { computeContextRange } from '../contextRange.js';
import { computeStatistics } from '../curationDebugLogger.js';
import { HistoryService } from '../HistoryService.js';
import type { IContent } from '../IContent.js';
import { JournalHistoryStore } from '../journalHistoryStore.js';
import { JournalSession } from '../journalSession.js';
import {
  applyStep,
  currentRows,
  tagOf,
  type MutationSequenceFixture,
} from './support/mutationSequence.js';

/**
 * Differential check of the trailer aggregate counters (#854 W1) over the
 * frozen mutation sequences. After each step the rows the old store holds are
 * written to a journal store (appended when they extend the previous rows,
 * replaced otherwise, so both the path-copy and the bulk-build paths run), and
 * the published root aggregate must give what the accumulators give over the
 * same rows.
 */
const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'mutation-sequence',
);

function loadFixtures(): MutationSequenceFixture[] {
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map(
      (file) =>
        JSON.parse(
          fs.readFileSync(path.join(FIXTURE_DIR, file), 'utf8'),
        ) as MutationSequenceFixture,
    );
}

function extendsPrevious(
  previous: readonly IContent[],
  rows: readonly IContent[],
): boolean {
  return (
    rows.length >= previous.length &&
    previous.every((row, index) => tagOf(row) === tagOf(rows[index]))
  );
}

function noneAsZero(seq: bigint): number {
  return seq === CHRONOLOGY_SEQ_NONE ? 0 : Number(seq);
}

/** Writes `rows` to the store as the group the step would have been: an append or a replacement. */
async function syncStore(
  store: JournalHistoryStore,
  previous: readonly IContent[],
  rows: readonly IContent[],
): Promise<void> {
  if (extendsPrevious(previous, rows)) {
    for (const row of rows.slice(previous.length))
      store.apply({ kind: 'content', content: row });
  } else {
    await store.replaceFrom(rows, rows.length);
  }
  await store.waitForDurable();
}

function expectAggregateMatches(
  aggregate: Aggregate,
  rows: readonly IContent[],
): void {
  const statistics = computeStatistics(rows);
  const range = computeContextRange(rows);
  expect({
    totalMessages: aggregate.rows,
    userMessages: aggregate.humanRows,
    aiMessages: aggregate.aiRows,
    toolCalls: aggregate.toolCallBlocks,
    toolResponses: aggregate.responseBlocks,
  }).toStrictEqual({
    totalMessages: statistics.totalMessages,
    userMessages: statistics.userMessages,
    aiMessages: statistics.aiMessages,
    toolCalls: statistics.toolCalls,
    toolResponses: statistics.toolResponses,
  });
  expect({
    totalEntries: aggregate.rows,
    firstSeq: rows.length === 0 ? 0 : noneAsZero(aggregate.firstSeq),
    lastSeq: rows.length === 0 ? 0 : noneAsZero(aggregate.lastSeq),
    approximate: aggregate.noChronologyRows > 0,
  }).toStrictEqual({
    totalEntries: range.totalEntries,
    firstSeq: range.firstSeq,
    lastSeq: range.lastSeq,
    approximate: range.approximate,
  });
}

interface StepResult {
  readonly aggregate: Aggregate;
  readonly rows: readonly IContent[];
}

/** Runs the steps on the old store and mirrors the rows after each one into the journal store. */
async function replaySteps(
  fixture: MutationSequenceFixture,
  store: JournalHistoryStore,
  session: JournalSession,
): Promise<StepResult[]> {
  const history = new HistoryService();
  const results: StepResult[] = [];
  let previous: IContent[] = [];
  try {
    for (const entry of fixture.steps) {
      await applyStep(history, entry.step);
      const rows = await currentRows(history);
      await syncStore(store, previous, rows);
      previous = rows;
      const aggregate = session.store.published?.aggregate;
      if (aggregate === undefined) throw new Error('nothing published');
      results.push({ aggregate, rows });
    }
    return results;
  } finally {
    await history.dispose();
  }
}

describe('trailer aggregate against the accumulators over the frozen mutation sequences', () => {
  const directory = useTempDir('aggregate-differential-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  for (const fixture of loadFixtures()) {
    it(`${fixture.name}: statistics and context boundary after every step`, async () => {
      const session = await JournalSession.create(
        path.join(directory(), `${fixture.name}.llxj`),
        { journal: testJournalSeams({}).dependencies },
      );
      const store = new JournalHistoryStore(session);
      open.push(store);

      const results = await replaySteps(fixture, store, session);

      expect(results).toHaveLength(fixture.steps.length);
      for (const { aggregate, rows } of results)
        expectAggregateMatches(aggregate, rows);
    }, 180_000);
  }
});
