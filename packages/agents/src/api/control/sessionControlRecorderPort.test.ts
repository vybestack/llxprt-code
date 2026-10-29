/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { RecordingIntegration } from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { requireActiveRecording } from './journalRecordingLifecycle.js';
import {
  adoptRecordingSessionId,
  cleanupSessionResources,
  rollbackPreparedSessionArtifacts,
} from './sessionControlRollback.js';

/**
 * Compile-time contract (#854 W12): the session-control helpers take the
 * session surface, so the journal recorder is a valid argument. Never called;
 * `tsc` is the assertion.
 */
export function helpersAcceptTheJournalRecorder(
  journal: JournalRecordingService,
  integration: RecordingIntegration,
  config: Config,
  lock: Parameters<typeof rollbackPreparedSessionArtifacts>[0]['lockHandle'],
): readonly unknown[] {
  return [
    requireActiveRecording(journal),
    cleanupSessionResources(integration, journal, null),
    rollbackPreparedSessionArtifacts({
      integration,
      recording: journal,
      lockHandle: lock,
    }),
    adoptRecordingSessionId(
      () => config.getSessionId(),
      (sessionId) => config.adoptSessionId(sessionId),
      'facade',
      'prior',
      journal,
      () => undefined,
    ),
  ];
}

describe('session control helpers take the session surface', () => {
  it('requireActiveRecording returns a live journal recorder and rejects a disposed one', async () => {
    const journal = JournalRecordingService.create({
      sessionId: 'session-port-0002',
      projectHash: 'project',
      chatsDir: 'unused',
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'model-1',
    });
    expect(requireActiveRecording(journal)).toBe(journal);
    await journal.dispose();
    expect(() => requireActiveRecording(journal)).toThrow(
      'No active recording',
    );
  });
});
