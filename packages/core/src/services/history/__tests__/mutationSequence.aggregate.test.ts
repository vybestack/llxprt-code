/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
import type { Aggregate } from '../../../journal/aggregate.js';
import { CHRONOLOGY_SEQ_NONE } from '../../../journal/rowRecord.js';
import { testJournalSeams } from '../../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../../journal/__tests__/support/useTempDir.js';
import { computeContextRange } from '../contextRange.js';
import { computeStatistics } from '../curationDebugLogger.js';
import type { IContent } from '../IContent.js';
import { JournalHistoryStore } from '../journalHistoryStore.js';
import { JournalSession } from '../journalSession.js';
import {
  loadMutationFixtures,
  replayOntoJournal,
} from './support/mutationSequenceJournal.js';

/**
 * Differential check of the trailer aggregate counters (#854 W1) over the
 * frozen mutation sequences. After each step the rows the old store holds are
 * written to a journal store (appended when they extend the previous rows,
 * replaced otherwise, so both the path-copy and the bulk-build paths run), and
 * the published root aggregate must give what the accumulators give over the
 * same rows.
 */

function noneAsZero(seq: bigint): number {
  return seq === CHRONOLOGY_SEQ_NONE ? 0 : Number(seq);
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

describe('trailer aggregate against the accumulators over the frozen mutation sequences', () => {
  const directory = useTempDir('aggregate-differential-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  for (const fixture of loadMutationFixtures()) {
    it(`${fixture.name}: statistics and context boundary after every step`, async () => {
      const session = await JournalSession.create(
        path.join(directory(), `${fixture.name}.llxj`),
        { journal: testJournalSeams({}).dependencies },
      );
      const store = new JournalHistoryStore(session);
      open.push(store);

      const results = await replayOntoJournal(fixture, store, () => {
        const aggregate = session.store.published?.aggregate;
        if (aggregate === undefined) throw new Error('nothing published');
        return aggregate;
      });

      expect(results).toHaveLength(fixture.steps.length);
      for (const { observed, rows } of results)
        expectAggregateMatches(observed, rows);
    }, 180_000);
  }
});
