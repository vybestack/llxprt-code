/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  type CheckpointDescriptor,
  checkpointKey,
  encodeCheckpointDescriptor,
} from '../journal/checkpointDescriptor.js';
import type { VersionEdit } from '../journal/groupEdits.js';
import { encodeSessionFact } from './sessionMetaKeys.js';

/**
 * The edits that state a session fact or change a checkpoint. The recorder
 * writes them for the open session and the checkpoint service for a closed
 * file, so both say the same thing in the same form.
 */

export function sessionFactEdit(key: string, value: unknown): VersionEdit {
  return { kind: 'setState', key, value: encodeSessionFact(value) };
}

export function createCheckpointEdit(id: string, name: string): VersionEdit {
  return { kind: 'checkpoint', id, name, createdAtMs: Date.now() };
}

export function renameCheckpointEdit(
  id: string,
  descriptor: CheckpointDescriptor,
  name: string,
): VersionEdit {
  return {
    kind: 'setState',
    key: checkpointKey(id),
    value: encodeCheckpointDescriptor({ ...descriptor, name }),
  };
}

export function deleteCheckpointEdit(id: string): VersionEdit {
  return { kind: 'deleteCheckpoint', id };
}
