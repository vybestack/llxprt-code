/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as fs from 'node:fs/promises';
import { type IContent } from '../services/history/IContent.js';
import { replaySession, replaySessionThroughSequence } from './ReplayEngine.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  type CheckpointMetadataView,
  type ContinueTarget,
  type SessionMetadata,
} from './types.js';

export type { ContinueTarget } from './types.js';

export interface ForkResult {
  ok: true;
  recording: SessionRecordingService;
  lockHandle: LockHandle;
  history: IContent[];
  metadata: SessionMetadata;
}

export interface ForkError {
  ok: false;
  error: string;
}

interface ForkRuntime {
  chatsDir: string;
  projectHash: string;
  provider: string;
  model: string;
  workspaceDirs: string[];
}

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;
type HistoryResult =
  | {
      ok: true;
      history: IContent[];
      checkpoint: CheckpointMetadataView;
    }
  | ForkError;

async function loadCheckpointHistory(
  target: CheckpointTarget,
  projectHash: string,
): Promise<HistoryResult> {
  const fullReplay = await replaySession(target.source.filePath, projectHash);
  if (!fullReplay.ok) {
    return {
      ok: false,
      error: `Failed to replay source session: ${fullReplay.error}`,
    };
  }
  if (fullReplay.sequenceCorrupt) {
    return {
      ok: false,
      error: 'Failed to replay source session: non-monotonic sequences',
    };
  }
  const liveCheckpoint = fullReplay.checkpoints?.find(
    (checkpoint) =>
      checkpoint.checkpointId === target.checkpointId && !checkpoint.deleted,
  );
  if (liveCheckpoint === undefined) {
    return {
      ok: false,
      error: `Checkpoint '${target.checkpointName}' (${target.checkpointId}) is not live`,
    };
  }
  const boundedReplay = await replaySessionThroughSequence(
    target.source.filePath,
    projectHash,
    liveCheckpoint.sequence,
  );
  if (!boundedReplay.ok) {
    return {
      ok: false,
      error: `Failed to replay source through checkpoint: ${boundedReplay.error}`,
    };
  }
  if (boundedReplay.sequenceCorrupt) {
    return {
      ok: false,
      error:
        'Failed to replay source through checkpoint: non-monotonic sequences',
    };
  }
  if (boundedReplay.history.length === 0) {
    return { ok: false, error: 'Checkpoint has no conversation history' };
  }
  return {
    ok: true,
    history: boundedReplay.history,
    checkpoint: liveCheckpoint,
  };
}

async function cleanupFailedChild(
  recording: SessionRecordingService | null,
  lockHandle: LockHandle | null,
): Promise<void> {
  const filePath = recording?.getFilePath() ?? null;
  const ownedLock = recording?.getOwnedLockHandle() ?? lockHandle;
  await recording?.dispose().catch(() => undefined);
  await ownedLock?.release().catch(() => undefined);
  if (filePath !== null) {
    await fs.unlink(filePath).catch(() => undefined);
  }
}

async function materializeChild(
  target: CheckpointTarget,
  checkpoint: CheckpointMetadataView,
  history: IContent[],
  runtime: ForkRuntime,
): Promise<ForkResult | ForkError> {
  const childSessionId = crypto.randomUUID();
  let recording: SessionRecordingService | null = null;
  try {
    recording = await SessionRecordingService.createLocked({
      sessionId: childSessionId,
      projectHash: runtime.projectHash,
      chatsDir: runtime.chatsDir,
      workspaceDirs: runtime.workspaceDirs,
      provider: runtime.provider,
      model: runtime.model,
    });
    recording.recordSessionFork({
      parentSessionId: target.source.sessionId,
      parentSequence: checkpoint.sequence,
      checkpointId: checkpoint.checkpointId,
      checkpointName: checkpoint.name,
    });
    for (const content of history) recording.recordContent(content);
    await recording.flush();
    if (!recording.isActive()) {
      throw new Error('Child recording failed during flush');
    }
    const childFilePath = recording.getFilePath();
    if (childFilePath === null) {
      throw new Error('Child recording did not materialize');
    }
    await fs.access(childFilePath);
  } catch (error: unknown) {
    await cleanupFailedChild(recording, null);
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Failed to create child session: ${detail}` };
  }

  const lockHandle = recording.getOwnedLockHandle();
  if (lockHandle === null) {
    await cleanupFailedChild(recording, null);
    return { ok: false, error: 'Failed to retain child session lock' };
  }
  return {
    ok: true,
    recording,
    lockHandle,
    history,
    metadata: {
      sessionId: childSessionId,
      projectHash: runtime.projectHash,
      provider: runtime.provider,
      model: runtime.model,
      workspaceDirs: runtime.workspaceDirs,
      startTime: new Date().toISOString(),
    },
  };
}

export class SessionTransitionService {
  async forkFromCheckpoint(
    target: CheckpointTarget,
    chatsDir: string,
    projectHash: string,
    currentProvider: string,
    currentModel: string,
    workspaceDirs: string[],
    activeSource?: SessionRecordingService | null,
  ): Promise<ForkResult | ForkError> {
    let sourceLock: LockHandle | null = null;
    if (
      activeSource?.getSessionId() !== target.source.sessionId ||
      !activeSource.ownsLockFor(target.source.sessionId)
    ) {
      try {
        sourceLock = await SessionLockManager.acquire(
          chatsDir,
          target.source.sessionId,
        );
      } catch (error: unknown) {
        const detail = error instanceof Error ? `: ${error.message}` : '';
        return { ok: false, error: `Source session is in use${detail}` };
      }
    }
    try {
      const history = await loadCheckpointHistory(target, projectHash);
      if (!history.ok) return history;
      return await materializeChild(
        target,
        history.checkpoint,
        history.history,
        {
          chatsDir,
          projectHash,
          provider: currentProvider,
          model: currentModel,
          workspaceDirs,
        },
      );
    } finally {
      await sourceLock?.release().catch(() => undefined);
    }
  }
}
