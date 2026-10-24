/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { HistoryService } from '../services/history/HistoryService.js';
import type { ResumeBoot } from '../services/history/historyStorePort.js';
import type { CheckpointServicePort } from './checkpointServiceFactory.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { RecordingIntegration } from './RecordingIntegration.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { SessionTransitionService } from './SessionTransitionService.js';

/**
 * Compile-time contract (#854 W12): every consumer below takes the session
 * surface, so the journal recorder is a valid argument. The function is never
 * called; `tsc` is the assertion, and a consumer that asks for the JSONL
 * recorder again breaks the build here.
 */
export function consumersAcceptTheJournalRecorder(
  journal: JournalRecordingService,
  history: HistoryService,
  checkpoints: CheckpointServicePort,
  transitions: SessionTransitionService,
  boot: ResumeBoot,
  target: Parameters<SessionTransitionService['forkFromCheckpoint']>[0],
): readonly unknown[] {
  return [
    new RecordingIntegration(journal),
    history.adoptResumeBoot(journal, boot),
    checkpoints.createCheckpoint(journal, 'project', 'name'),
    transitions.forkFromCheckpoint(
      target,
      'chats',
      'project',
      'p',
      'm',
      [],
      journal,
    ),
  ];
}

describe('recorder consumers take the session surface', () => {
  it('RecordingIntegration hands back the recorder it was given, typed as the port', async () => {
    const journal = JournalRecordingService.create({
      sessionId: 'session-port-0001',
      projectHash: 'project',
      chatsDir: 'unused',
      workspaceDirs: [],
      provider: 'anthropic',
      model: 'model-1',
    });
    const integration = new RecordingIntegration(journal);
    const returned: SessionRecordingPort = integration.getRecordingService();
    expect(returned).toBe(journal);
    await integration.dispose();
  });
});
