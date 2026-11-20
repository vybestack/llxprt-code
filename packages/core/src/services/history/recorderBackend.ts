/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';

/** The recorder the journal store works with; any other kind is a backend mismatch (G8). */
export function requireJournalRecorder(
  recording: SessionRecordingPort,
): JournalRecordingService {
  if (!(recording instanceof JournalRecordingService))
    throw new Error(
      'Recorder/backend mismatch: the journal history store takes only a journal recorder',
    );
  return recording;
}
