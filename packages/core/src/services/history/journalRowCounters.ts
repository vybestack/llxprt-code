/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { IContent } from './IContent.js';

/**
 * Reports one decoded row to the optional read counters (WIRING G9) and
 * returns the call that reports its release. The memory proofs read these
 * counters, so a reader calls the release when it lets go of the row, which
 * for a stream is when the consumer asks for the next one.
 */
export function countDecodedRow(
  row: IContent,
  counters: JournalReadCounters | undefined,
): () => void {
  if (counters === undefined) return () => {};
  counters.rowDecoded();
  try {
    counters.ownership?.retain(row);
  } catch (error) {
    counters.rowReleased();
    throw error;
  }
  return () => {
    counters.ownership?.release(row);
    counters.rowReleased();
  };
}
