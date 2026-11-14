/**
 * Copyright 2025 Vybestack LLC
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

/**
 * @plan PLAN-20260211-SESSIONRECORDING.P20
 * @requirement REQ-RSM-001, REQ-RSM-004
 * @pseudocode resume-flow.md lines 50-124
 *
 * Resume session flow. Discovers, resolves, locks, replays, and initializes
 * recording for a previously saved session.
 */

import type { JournalSessionOptions } from '../services/history/journalSession.js';
import { JournalResumeBoot, resumeJournalSession } from './journalResume.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import type { LockHandle } from './SessionLockManager.js';
import type { JournalReadCounters } from './journalCounters.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type { SessionMetadata, UnreadableRecording } from './types.js';
import type { CONTINUE_LATEST } from './continueLatest.js';
export { CONTINUE_LATEST } from './continueLatest.js';

export interface ResumeRequest {
  continueRef: string | typeof CONTINUE_LATEST;
  projectHash: string;
  chatsDir: string;
  currentProvider: string;
  currentModel: string;
  workspaceDirs: string[];
  mediaStore?: LocalMediaStore;
  maxQueueBytes?: number;
  /** Injectable read counters (issue #854 P05d); absent = uninstrumented. */
  counters?: JournalReadCounters;
  /** File seams of the journal (tests). */
  journal?: JournalSessionOptions;
}

export type ResumeBootHandle = JournalResumeBoot;

export interface ResumeResult {
  ok: true;
  boot: ResumeBootHandle;
  metadata: SessionMetadata;
  recording: SessionRecordingPort;
  lockHandle: LockHandle;
  warnings: string[];
  /** Recordings in the project that could not be read and were passed over. */
  skippedRecordings: readonly UnreadableRecording[];
}

export interface ResumeError {
  ok: false;
  error: string;
  /** Recordings in the project that could not be read and were passed over. */
  skippedRecordings?: readonly UnreadableRecording[];
}

export async function resumeSession(
  request: ResumeRequest,
): Promise<ResumeResult | ResumeError> {
  const result = await resumeJournalSession({
    mediaStore: request.mediaStore,
    continueRef: request.continueRef,
    projectHash: request.projectHash,
    chatsDir: request.chatsDir,
    currentProvider: request.currentProvider,
    currentModel: request.currentModel,
    workspaceDirs: request.workspaceDirs,
    ...(request.journal === undefined ? {} : { journal: request.journal }),
  });
  if (!result.ok) return result;
  return {
    ok: true,
    boot: new JournalResumeBoot(
      result.recording,
      result.resumePoint,
      request.counters,
    ),
    metadata: result.metadata,
    recording: result.recording,
    lockHandle: result.lockHandle,
    warnings: [],
    skippedRecordings: result.skippedRecordings,
  };
}
