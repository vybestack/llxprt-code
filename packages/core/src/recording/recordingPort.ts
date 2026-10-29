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

import type { LockHandle } from './SessionLockManager.js';
import type { RecordingCheckpointInfo, SessionForkedPayload } from './types.js';

/**
 * Session recorder lifecycle, identity, the session lock, facts and checkpoints.
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
