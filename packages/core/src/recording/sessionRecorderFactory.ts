/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import {
  JournalRecordingService,
  type JournalRecordingConfig,
} from './journalRecordingService.js';
import type { SessionRecordingPort } from './recordingPort.js';

/** A recorder for a new session; its file is created when first needed. */
export function createSessionRecorder(
  config: JournalRecordingConfig,
): SessionRecordingPort {
  return JournalRecordingService.create(config);
}

/** `createSessionRecorder`, holding the session lock. */
export function createLockedSessionRecorder(
  config: JournalRecordingConfig,
): Promise<SessionRecordingPort> {
  return JournalRecordingService.createLocked(config);
}
