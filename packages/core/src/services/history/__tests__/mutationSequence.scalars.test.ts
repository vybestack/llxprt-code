/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'bun:test';
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
 * #854 W2: the synchronous scalars and the last row per speaker of the
 * journal store, compared after every step of the frozen mutation sequences
 * with what the accumulators and the rows themselves give.
 */
const SPEAKERS = ['human', 'ai', 'tool'] as const;

interface Observed {
  readonly statistics: ReturnType<JournalHistoryStore['statistics']>;
  readonly boundary: ReturnType<JournalHistoryStore['contextBoundary']>;
  readonly last: ReadonlyArray<IContent | undefined>;
  readonly lastAny: IContent | undefined;
  readonly stored: readonly IContent[];
}

async function observe(store: JournalHistoryStore): Promise<Observed> {
  return {
    statistics: store.statistics(),
    boundary: store.contextBoundary(),
    last: await Promise.all(
      SPEAKERS.map((speaker) => store.lastContent(speaker)),
    ),
    lastAny: await store.lastContent(),
    stored: await store.materialize(),
  };
}

function lastBySpeaker(
  rows: readonly IContent[],
  speaker: IContent['speaker'],
): IContent | undefined {
  return rows.filter((row) => row.speaker === speaker).pop();
}

describe('journal store scalars over the frozen mutation sequences', () => {
  const directory = useTempDir('journal-scalars-differential-');
  const open: JournalHistoryStore[] = [];
  afterEach(async () => {
    for (const store of open.splice(0)) await store.dispose();
  });

  for (const fixture of loadMutationFixtures()) {
    it(`${fixture.name}: statistics, boundary and last rows after every step`, async () => {
      const session = await JournalSession.create(
        path.join(directory(), `${fixture.name}.llxj`),
        { journal: testJournalSeams({}).dependencies },
      );
      const store = new JournalHistoryStore(session);
      open.push(store);

      const results = await replayOntoJournal(fixture, store, () =>
        observe(store),
      );

      expect(results).toHaveLength(fixture.steps.length);
      for (const { rows, observed } of results) {
        expect(observed.statistics).toStrictEqual(computeStatistics(rows));
        const range = computeContextRange(rows);
        expect(observed.boundary).toStrictEqual({
          firstSeq: range.firstSeq,
          lastSeq: range.lastSeq,
          totalEntries: range.totalEntries,
          approximate: range.approximate,
        });
        SPEAKERS.forEach((speaker, at) => {
          expect(observed.last[at]).toStrictEqual(
            lastBySpeaker(observed.stored, speaker),
          );
        });
        expect(observed.lastAny).toStrictEqual(
          observed.stored[observed.stored.length - 1],
        );
      }
    }, 180_000);
  }
});
