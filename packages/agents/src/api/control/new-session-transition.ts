/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  RecordingIntegration,
  createLockedSessionRecorder,
  type SessionRecordingPort,
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
      recording: SessionRecordingPort | null,
      integration: RecordingIntegration | null,
    ) => void;
  },
): Promise<void> {
  const ownsConfig = deps.sessionIdentityOwnership === 'config';
  if (ownsConfig && deps.readOwnedSessionId() !== state.owner.getSessionId()) {
    throw new Error('Cannot replace a session owned by another facade');
  }
  const nextSessionId = crypto.randomUUID();
  const candidate = await deps.prepareNewSessionClient(nextSessionId);
  let recording: SessionRecordingPort | null = null;
  let integration: RecordingIntegration | null = null;
  let retirementStarted = false;
  try {
    if (state.owner.getRecording().enabled) {
      recording = await createLockedSessionRecorder({
        sessionId: nextSessionId,
        projectHash: basename(deps.paths.projectTempDir),
        chatsDir: deps.paths.projectChatsDir,
        workspaceDirs: [...deps.directories()],
        cwd: deps.paths.projectRoot,
        provider: deps.getProvider(),
        model: deps.getModel(),
        resolveProviderModel: () => ({
          provider: deps.getProvider(),
          model: deps.getModel(),
        }),
        mediaStore: deps.mediaStore,
      });
      integration = new RecordingIntegration(recording);
      await candidate.attachRecording(integration, state.owner);
    }
    retirementStarted = true;
    // Retire the history before detaching its recorder, otherwise detachment
    // clones all live rows into an unlinked journal that retirement discards.
    const retirementFailures: unknown[] = [];
    await captureRollbackFailure(retirementFailures, () => candidate.retire());
    await captureRollbackFailure(retirementFailures, () => state.retire());
    if (retirementFailures.length === 1) throw retirementFailures[0];
    if (retirementFailures.length > 1)
      throw new AggregateError(retirementFailures, 'Session retirement failed');
    candidate.publish();
    if (ownsConfig) deps.adoptOwnedSessionId(nextSessionId);
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
