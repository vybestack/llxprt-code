/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryIndexedRows } from './historyMutationSnapshot.js';
import type { IContent } from './IContent.js';

/**
 * The rows of a checkpoint the journal store hands out: read from the version
 * that was published when the checkpoint was taken, one decoded row per step,
 * none retained. Every pass starts again at the first row.
 */
export interface HistoryCheckpointRows extends AsyncIterable<IContent> {
  readonly length: number;
}

/**
 * What a checkpoint callback receives: the indexed scratch rows of the old
 * store or the async source of the journal store. S14 deletes the first.
 */
export type HistoryCheckpoint = HistoryIndexedRows | HistoryCheckpointRows;

/** The rows of either kind of checkpoint, in order. */
export async function* checkpointRows(
  checkpoint: HistoryCheckpoint,
): AsyncGenerator<IContent, void, unknown> {
  yield* checkpoint;
}
