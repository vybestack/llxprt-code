/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  CHECKPOINT_KEY_PREFIX,
  isCheckpointKey,
  parseCheckpointEntry,
  type CheckpointDescriptor,
} from './checkpointDescriptor.js';
import type { IdNodeCache } from './idTrieCache.js';
import { readMapEntries, readValueBody } from './mapEntries.js';
import type { RecordAccess } from './recordAccess.js';

/** A live checkpoint of a state map: its id and what it names. */
export interface ListedCheckpoint {
  readonly id: string;
  readonly descriptor: CheckpointDescriptor;
}

/**
 * The live checkpoints of the state map at `stateRoot`, a deleted one left
 * out. The walk reads one state entry at a time, and the state map holds
 * session facts and checkpoints only, so it does not grow with the history.
 */
export async function* listCheckpoints(
  access: RecordAccess,
  cache: IdNodeCache,
  stateRoot: number,
): AsyncGenerator<ListedCheckpoint> {
  for await (const entry of readMapEntries(access, cache, stateRoot)) {
    if (!isCheckpointKey(entry.key)) continue;
    const descriptor = parseCheckpointEntry(
      await readValueBody(access, entry.head),
    );
    if (descriptor !== undefined) {
      yield { id: entry.key.slice(CHECKPOINT_KEY_PREFIX.length), descriptor };
    }
  }
}
