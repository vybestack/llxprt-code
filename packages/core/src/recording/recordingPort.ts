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

import type { IContent } from '../services/history/IContent.js';
import type { LockHandle } from './SessionLockManager.js';
import type { PurgeRecordingOptions } from './semanticPurgeRecordingRows.js';
import type {
  CommitWatermark,
  CompressionDetailPayload,
  DensityMutationPayload,
  RecordingCheckpointInfo,
  SessionEventType,
  SessionForkedPayload,
  SessionRecordLine,
  SyntheticInsertPayload,
} from './types.js';

/**
 * What a session recorder is, apart from how it writes: lifecycle, identity,
 * the session lock, header facts and checkpoints. Both recorders provide it
 * (the JSONL `SessionRecordingService` and the journal recorder).
 */
export interface SessionRecordingPort {
  // Lifecycle, identity and the session lock.
  flush(): Promise<void>;
  dispose(): Promise<void>;
  isActive(): boolean;
  getFilePath(): string | null;
  getSessionId(): string;
  getChatsDir(): string;
  getProjectHash(): string;
  adoptLock(lockHandle: LockHandle): void;
  ownsLockFor(sessionId: string): boolean;
  getOwnedLockHandle(): LockHandle | null;

  // Session facts.
  recordProviderSwitch(provider: string, model: string): void;
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void;
  recordDirectoriesChanged(directories: string[]): void;
  recordSessionMetadata(title: string | null): void;
  getSessionMetadataTitle(): string | null | undefined;
  setSessionName(name: string | null): Promise<void>;
  recordSessionFork(payload: SessionForkedPayload): void;

  // Checkpoints.
  createCheckpoint(name: string): Promise<RecordingCheckpointInfo>;
  deleteCheckpoint(checkpointId: string): Promise<void>;
  renameCheckpoint(checkpointId: string, name: string): Promise<void>;
}

/**
 * The surface of the JSONL recorder that the history store and its callers
 * use: the session surface plus the old record layout (envelope lines, seq
 * watermarks, mutation records). History-side modules depend on this port
 * rather than on the concrete `SessionRecordingService`. The journal recorder
 * has no such layout; its rows are written by the history store, and the
 * members below leave with the JSONL recorder (#854 phase 4, S15).
 */
export interface RecordingPort extends SessionRecordingPort {
  // Acks and the commit protocol.
  onCommitWatermark(listener: (watermark: CommitWatermark) => void): () => void;
  enqueue(type: SessionEventType, payload: unknown): SessionRecordLine | null;
  commit(type: SessionEventType, payload: unknown): Promise<CommitWatermark>;
  waitForCommit(line: SessionRecordLine): Promise<CommitWatermark>;
  waitForCommitSequence(seq: number): Promise<CommitWatermark>;
  requireCommittable(): void;
  retireIdleTicketStorage(): void;
  getPendingRecordCount(): number;
  getPendingByteCount(): number;
  getLastEnqueuedSequence(): number;
  initializeForResume(
    filePath: string,
    lastSeq: number,
    title?: string | null,
    unfinishedReplaceTxId?: string,
  ): void;

  // History mutations.
  recordContent(content: IContent): void;
  recordSemanticMediaPurge(
    history: readonly IContent[],
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
  ): void;
  recordSemanticMediaPurgeRows(
    history: AsyncIterable<IContent>,
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
    options?: PurgeRecordingOptions,
  ): Promise<void>;
  recordCompressed(summary: IContent, itemsCompressed: number): void;
  recordRewind(itemsRemoved: number, cutSeq?: number): void;
  recordDensityChange(
    payload: DensityMutationPayload,
  ): SessionRecordLine | null;
  recordSyntheticInsert(
    payload: SyntheticInsertPayload,
  ): SessionRecordLine | null;
  recordCompressionDetail(
    payload: CompressionDetailPayload,
  ): SessionRecordLine | null;
}
