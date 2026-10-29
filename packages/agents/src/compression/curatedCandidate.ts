/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { DetachedHistorySink } from '@vybestack/llxprt-code-core/services/history/detachedHistoryMutation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * The curated rows of `rows` as a scratch journal a compression strategy reads
 * and a publisher writes from. Each row records its ordinal in `rows`, which
 * the publisher passes to the sink so the row keeps the owner of the history
 * row it comes from. The caller closes the journal.
 */
export async function curatedCandidate(
  rows: AsyncIterable<IContent>,
): Promise<DetachedHistoryJournal> {
  const curated = new DetachedHistoryJournal();
  try {
    let ordinal = 0;
    for await (const row of rows) {
      if (isCuratedContent(row)) curated.append(row, ordinal);
      ordinal++;
    }
    return curated;
  } catch (error) {
    curated.close();
    throw error;
  }
}

/**
 * The curated rows of `rows` as the density rows a high-density, middle-out or
 * one-shot strategy reads. Each row records its ordinal in `rows`, which the
 * strategy passes on when it copies the row into its candidate. The caller
 * closes the result.
 */
export async function curatedDensityRows(
  rows: AsyncIterable<IContent>,
): Promise<HistoryDensityRows> {
  const curated = new HistoryDensityRows();
  try {
    let ordinal = 0;
    for await (const row of rows) {
      if (isCuratedContent(row)) curated.append(row, ordinal);
      ordinal++;
    }
    return curated;
  } catch (error) {
    curated.close();
    throw error;
  }
}

/**
 * Writes a candidate row. A row taken from the history (it has a source
 * ordinal) keeps that row's owner; any other row is written under the
 * operation's origin.
 */
export async function appendCandidateRow(
  sink: DetachedHistorySink,
  row: IContent,
  sourceOrdinal: number | undefined,
): Promise<void> {
  if (sourceOrdinal === undefined) await sink.appendValue(row);
  else await sink.appendDerived(sourceOrdinal, row);
}
