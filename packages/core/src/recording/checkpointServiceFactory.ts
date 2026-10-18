/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { selectBackend } from '../services/history/historyBackendSelect.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import { CheckpointService } from './CheckpointService.js';
import { JournalCheckpointService } from './journalCheckpointService.js';

/**
 * The operations both checkpoint services offer. The journal service takes no
 * `projectHash` for its listings (its file knows the project) and no media
 * store (a listing reads no media), so it satisfies the narrower shape.
 */
export type CheckpointServicePort = Pick<
  CheckpointService,
  | 'listCheckpoints'
  | 'getDeletionBlockers'
  | 'createCheckpoint'
  | 'renameCheckpoint'
  | 'deleteCheckpoint'
  | 'setSessionName'
  | 'deleteCheckpointClosed'
  | 'renameCheckpointClosed'
  | 'createCheckpointClosed'
>;

/**
 * The one place a checkpoint service class is chosen (#854 D23), beside
 * `createSessionRecorder`. A service is used with recorders of its own kind;
 * the journal service refuses any other.
 */
export function createCheckpointService(
  mediaStore?: LocalMediaStore,
  env: Readonly<Record<string, string | undefined>> = process.env,
): CheckpointServicePort {
  return selectBackend(env) === 'journal'
    ? new JournalCheckpointService()
    : new CheckpointService(mediaStore);
}
