/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';

export function recordingDisposalTarget(): Pick<
  SessionRecordingPort,
  'dispose'
> {
  return JournalRecordingService.prototype;
}
