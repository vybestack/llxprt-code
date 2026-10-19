/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import type { SessionRecordingPort } from '@vybestack/llxprt-code-core';
import { selectBackend } from '@vybestack/llxprt-code-core/services/history/historyBackendSelect.js';

export function recordingDisposalTarget(): Pick<
  SessionRecordingPort,
  'dispose'
> {
  return selectBackend() === 'journal'
    ? JournalRecordingService.prototype
    : SessionRecordingService.prototype;
}
