/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import { basename } from 'node:path';
import type { SessionControl, SessionControlDeps } from './sessionControl.js';
import {
  captureRollbackFailure,
  cleanupSessionResources,
} from './sessionControlRollback.js';

export async function startNewSessionTransition(
  deps: SessionControlDeps,
  state: {
    owner: Pick<
      SessionControl,
      'getSessionId' | 'getRecording' | 'closeAdmission'
    >;
    retire: () => Promise<void>;
    publish: (
      id: string,
      recording: SessionRecordingService | null,
      integration: RecordingIntegration | null,
    ) => void;
  },
): Promise<void> {
  const ownsConfig = deps.sessionIdentityOwnership === 'config';
  if (ownsConfig && deps.config.getSessionId() !== state.owner.getSessionId()) {
    throw new Error('Cannot replace a session owned by another facade');
  }
  const nextSessionId = crypto.randomUUID();
  const candidate = await deps.prepareNewSessionClient(nextSessionId);
  let recording: SessionRecordingService | null = null;
  let integration: RecordingIntegration | null = null;
  let retirementStarted = false;
  try {
    if (state.owner.getRecording().enabled) {
      recording = await SessionRecordingService.createLocked({
        sessionId: nextSessionId,
        projectHash: basename(deps.config.projectTempDir),
        chatsDir: deps.config.projectChatsDir,
        workspaceDirs: [...deps.directories()],
        cwd: deps.config.getProjectRoot(),
        provider: deps.getProvider(),
        model: deps.getModel(),
        mediaStore: deps.mediaStore,
        maxQueueBytes: deps.readRecordingQueueLimit(),
      });
      integration = new RecordingIntegration(
        recording,
        deps.persistence.forRecording(nextSessionId),
      );
      const history = candidate.client.getHistoryService();
      if (history === null)
        throw new Error('New session client has no history service');
      integration.subscribeToHistory(history, state.owner);
    }
    retirementStarted = true;
    await state.retire();
    await candidate.retire();
    candidate.publish();
    if (ownsConfig) deps.config.adoptSessionId(nextSessionId);
    state.publish(nextSessionId, recording, integration);
  } catch (error) {
    if (retirementStarted) {
      state.owner.closeAdmission();
      deps.closeSessionAdmission();
    }
    const failures = await cleanupSessionResources(
      integration,
      recording,
      null,
    );
    await captureRollbackFailure(failures, () => candidate.discard());
    if (failures.length > 0)
      throw new AggregateError(
        [error, ...failures],
        'New session transition and cleanup failed',
      );
    throw error;
  }
}
