/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { validateReplayRows } from './ReplayEngine.js';

/** Trim a checkpoint name and reject an empty one. */
export function requireCheckpointName(operation: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error(`Cannot ${operation}: name must not be empty`);
  }
  return trimmed;
}

/** Fail unless the recording replays cleanly and holds at least one row. */
export async function assertCheckpointReplayable(
  filePath: string,
  projectHash: string,
  mediaStore: LocalMediaStore | undefined,
): Promise<void> {
  const { replay, rowCount } = await validateReplayRows(filePath, projectHash, {
    mediaStore,
  });
  if (!replay.ok) {
    throw new Error(`Cannot create checkpoint: ${replay.error}`);
  }
  if (replay.sequenceCorrupt) {
    throw new Error(
      'Cannot create checkpoint: recording has non-monotonic sequences',
    );
  }
  if (rowCount === 0) {
    throw new Error(
      'Cannot create checkpoint: conversation has no content yet',
    );
  }
}
