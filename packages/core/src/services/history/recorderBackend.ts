/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import type {
  RecordingPort,
  SessionRecordingPort,
} from '../../recording/recordingPort.js';

/** The JSONL recorder is the only kind with a commit watermark. */
export function isJsonlRecorder(
  recording: SessionRecordingPort,
): recording is RecordingPort {
  return 'onCommitWatermark' in recording;
}

/** The recorder the JSONL store works with; any other kind is a backend mismatch (G8). */
export function requireJsonlRecorder(
  recording: SessionRecordingPort,
): RecordingPort {
  if (!isJsonlRecorder(recording))
    throw new Error(
      'Recorder/backend mismatch: the JSONL history store takes only a JSONL recorder',
    );
  return recording;
}

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
