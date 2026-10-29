/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { JournalCheckpointService } from './journalCheckpointService.js';

/**
 * The checkpoint operations provided by the journal service.
 */
export type CheckpointServicePort = Pick<
  JournalCheckpointService,
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
export function createCheckpointService(): CheckpointServicePort {
  return new JournalCheckpointService();
}
