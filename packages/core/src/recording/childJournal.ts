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

/**
 * @plan:PLAN-20260917-ISSUE854.P05c
 * @requirement:G7
 *
 * Lifecycle seam for ephemeral subagent session journals. One call owns the
 * whole lifecycle: allocate an fs-safe id, acquire the session lock, stamp
 * `kind: 'subagent'` plus `parentSessionId` into the durable session_start
 * header, and guarantee teardown (journal file + lock) on success, failure,
 * timeout, and cancellation. Teardown mirrors the fork-child precedent
 * (SessionTransitionService.cleanupFailedChild): dispose the recorder, then
 * remove the journal file.
 */

import * as fs from 'node:fs/promises';
import { SessionRecordingService } from './SessionRecordingService.js';
import { allocateChildSessionId } from './childSessionIds.js';
import type { RecordingWriterIo } from './types.js';

/** Inputs for {@link createChildSessionJournal}. */
export interface ChildSessionJournalOptions {
  /**
   * Pre-allocated fs-safe id, when the caller minted one BEFORE runtime
   * construction (the orchestrator does). Defaults to a fresh
   * {@link allocateChildSessionId}.
   */
  readonly sessionId?: string;
  /** Session id of the owning parent, stamped into the child header. */
  parentSessionId: string;
  projectHash: string;
  chatsDir: string;
  workspaceDirs: readonly string[];
  provider: string;
  model: string;
  /** Write seam for failure injection (mirrors RecordingWriterIo). */
  readonly io?: RecordingWriterIo;
}

/** An ephemeral child journal whose dispose() removes every artifact. */
export interface ChildSessionJournal {
  /** The fs-safe id allocated for this child (== recording.getSessionId()). */
  readonly sessionId: string;
  /** Same recorder class main sessions use; safe for HistoryService attach. */
  readonly recording: SessionRecordingService;
  /**
   * Flush best effort, dispose the recorder, release the lock, and REMOVE
   * the journal file. Idempotent; never leaves a `.lock` or a
   * `session-*.jsonl` behind, even when writes already failed.
   */
  dispose(): Promise<void>;
}

/**
 * Tear down a recorder without letting a poisoned flush block artifact
 * removal: dispose() releases the lock even when flush failed, then the
 * journal file (materialized by the failed write attempt) is removed.
 */
async function cleanupRecording(
  recording: SessionRecordingService,
): Promise<void> {
  try {
    await recording.dispose();
  } catch {
    // Flush failures must not block artifact removal.
  }
  const filePath = recording.getFilePath();
  if (filePath !== null) {
    await fs.rm(filePath, { force: true });
  }
}

/**
 * Allocate a child session id, create the locked journal under it, and
 * durably initialize the header. Any failure during acquisition or the init
 * flush removes the lock and partial file before rethrowing.
 */
export async function createChildSessionJournal(
  options: ChildSessionJournalOptions,
): Promise<ChildSessionJournal> {
  // The id is minted BEFORE any runtime construction so launch failures can
  // clean up deterministically and the filename prefix is fully random.
  const sessionId = options.sessionId ?? allocateChildSessionId();
  let recording: SessionRecordingService | null = null;
  try {
    recording = await SessionRecordingService.createLocked({
      sessionId,
      projectHash: options.projectHash,
      chatsDir: options.chatsDir,
      workspaceDirs: [...options.workspaceDirs],
      provider: options.provider,
      model: options.model,
      kind: 'subagent',
      parentSessionId: options.parentSessionId,
      ...(options.io === undefined ? {} : { io: options.io }),
    });
    // Durably initialize: commit materializes the file and appends the
    // buffered session_start header, so a broken writer fails creation
    // instead of leaving an unreadable journal behind.
    await recording.commit('session_event', {
      severity: 'info',
      message: 'child session journal initialized',
    });
  } catch (error: unknown) {
    if (recording !== null) {
      await cleanupRecording(recording);
    }
    throw error;
  }
  let disposed = false;
  return {
    sessionId,
    recording,
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await cleanupRecording(recording);
    },
  };
}
