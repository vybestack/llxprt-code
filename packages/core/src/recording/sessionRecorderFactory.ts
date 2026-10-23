/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { SessionRecordingServiceConfig } from './types.js';

/**
 * The one place a session recorder class is chosen (#854 G8). Callers hold the
 * result as the session surface and never convert it to the other kind; the
 * history store checks the kind it is given.
 *
 * The journal recorder has no use for the JSONL writer's queue bound or I/O
 * seams, so those fields of the shared config are not passed on.
 */
function journalConfig(
  config: SessionRecordingServiceConfig,
): JournalRecordingConfig {
  return {
    sessionId: config.sessionId,
    projectHash: config.projectHash,
    chatsDir: config.chatsDir,
    workspaceDirs: config.workspaceDirs,
    cwd: config.cwd,
    provider: config.provider,
    model: config.model,
    mediaStore: config.mediaStore,
    kind: config.kind,
    parentSessionId: config.parentSessionId,
    resolveProviderModel: config.resolveProviderModel,
  };
}

/** A recorder for a new session; its file is created when first needed. */
export function createSessionRecorder(
  config: SessionRecordingServiceConfig,
): SessionRecordingPort {
  return JournalRecordingService.create(journalConfig(config));
}

/** `createSessionRecorder`, holding the session lock. */
export function createLockedSessionRecorder(
  config: SessionRecordingServiceConfig,
): Promise<SessionRecordingPort> {
  return JournalRecordingService.createLocked(journalConfig(config));
}
