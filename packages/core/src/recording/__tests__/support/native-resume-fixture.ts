import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { withTestNamedWriters } from '../../../journal/__tests__/support/namedWriterOwner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryService } from '../../../services/history/HistoryService.js';
import { RecordingIntegration } from '../../RecordingIntegration.js';
import { resumeSession, type ResumeResult } from '../../resumeSession.js';
import type { NativeIntegrationFixture } from './native-integration-fixture.js';

const recordingScratchRoots = new ScratchRootOwner();

export async function withResumed(
  fixture: NativeIntegrationFixture,
  run: (
    resumed: ResumeResult,
    history: HistoryService,
    integration: RecordingIntegration,
  ) => Promise<void>,
): Promise<void> {
  await fixture.integration.dispose();
  await fixture.history.dispose();
  await fixture.recording.dispose();
  const resumed = await resumeSession(
    withTestNamedWriters({
      continueRef: fixture.recording.getSessionId(),
      projectHash: fixture.recording.getProjectHash(),
      chatsDir: fixture.recording.getChatsDir(),
      currentProvider: 'anthropic',
      currentModel: 'model-1',
      workspaceDirs: ['/different/resume-default'],
    }),
  );
  if (!resumed.ok) throw new Error(resumed.error);
  const history = new HistoryService({ scratchRoots: recordingScratchRoots });
  const integration = new RecordingIntegration(
    resumed.recording,
    recordingScratchRoots,
  );
  try {
    await history.adoptResumeBoot(resumed.recording, resumed.boot);
    await integration.subscribeToJournal(history);
    await run(resumed, history, integration);
  } finally {
    await integration.dispose();
    await history.dispose();
    await resumed.recording.dispose();
  }
}
