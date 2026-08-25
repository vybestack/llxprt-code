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
 * @plan PLAN-20260211-SESSIONRECORDING.P05
 * @requirement REQ-REC-001, REQ-REC-002, REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007, REQ-REC-008
 * @pseudocode session-recording-service.md lines 40-212
 *
 * Session recording service that writes events to a JSONL file.
 * Uses synchronous enqueue with async background writes, deferred
 * file materialization, and graceful ENOSPC handling.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  mkdirSync,
  existsSync,
  watch,
  watchFile,
  unwatchFile,
  type Stats,
} from 'node:fs';
import { type IContent } from '../services/history/IContent.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  type SessionRecordingServiceConfig,
  type SessionEventType,
  type SessionRecordLine,
  type RecordingCheckpointInfo,
  type SessionForkedPayload,
} from './types.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';

export const SESSION_FILE_ID_PREFIX_LENGTH = 12;

/**
 * Queue depth at which the writer is clearly not keeping up with production.
 * Crossing it is reported once so the condition is diagnosable; records are
 * never dropped, because the session file is the durable transcript.
 */
const QUEUE_HIGH_WATER_RECORDS = 4096;
const MATERIALIZING_EVENT_TYPES: ReadonlySet<SessionEventType> = new Set([
  'content',
  'session_metadata',
  'session_named',
  'semantic_media_purge',
]);

type RecordingLifecycle =
  | { readonly status: 'active' }
  | { readonly status: 'failed'; readonly error: unknown }
  | { readonly status: 'failure-reported' }
  | { readonly status: 'disposed' };

/**
 * A record that has already been serialised. Serialising at enqueue time keeps
 * byte accounting free and means each record — including large media payloads —
 * is stringified exactly once instead of once for accounting and again for the
 * write (issue #2852).
 */
interface PendingRecord {
  readonly line: SessionRecordLine;
  readonly json: string;
  readonly bytes: number;
}

export interface PreparedContentBatch {
  publish(): void;
  rollback(): void;
  finalize(): void;
}

function toPendingRecord(line: SessionRecordLine): PendingRecord {
  const json = JSON.stringify(line);
  return { line, json, bytes: Buffer.byteLength(json, 'utf8') + 1 };
}

function totalRecordBytes(records: readonly PendingRecord[]): number {
  return records.reduce((total, record) => total + record.bytes, 0);
}

function containsMediaReference(
  value: unknown,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  if (
    Reflect.get(value, 'type') === 'media' &&
    Reflect.get(value, 'encoding') === 'reference'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsMediaReference(entry, seen));
  }
  return Reflect.ownKeys(value).some((key) =>
    containsMediaReference(Reflect.get(value, key), seen),
  );
}

function recordingVersion(payload: unknown): number {
  return containsMediaReference(payload) ? 2 : 1;
}

/**
 * Core service for recording session events to a JSONL file.
 *
 * @plan PLAN-20260211-SESSIONRECORDING.P05
 * @requirement REQ-REC-003, REQ-REC-004, REQ-REC-005, REQ-REC-006, REQ-REC-007, REQ-REC-008
 * @pseudocode session-recording-service.md lines 40-185
 */
export class SessionRecordingService {
  /** @pseudocode session-recording-service.md lines 40-51 */
  private queue: PendingRecord[] = [];
  private queueBytes: number = 0;
  private highWaterReported: boolean = false;
  private seq: number = 0;
  private filePath: string | null = null;
  private materialized: boolean = false;
  private lifecycle: RecordingLifecycle = { status: 'active' };
  private draining: boolean = false;
  private drainPromise: Promise<void> | null = null;
  private readonly sessionId: string;
  private readonly projectHash: string;
  private readonly chatsDir: string;
  private readonly maxQueueBytes: number;
  private readonly mediaStore: LocalMediaStore | undefined;
  private preContentBuffer: PendingRecord[] = [];
  private preContentBytes: number = 0;
  private chatsDirWatcher: { close(): void } | null = null;
  private sessionTitle: string | null | undefined;
  private lockHandle: LockHandle | null = null;

  static async createLocked(
    config: SessionRecordingServiceConfig,
  ): Promise<SessionRecordingService> {
    const lockHandle = await SessionLockManager.acquire(
      config.chatsDir,
      config.sessionId,
    );
    try {
      const recording = new SessionRecordingService(config);
      recording.adoptLock(lockHandle);
      return recording;
    } catch (error: unknown) {
      await lockHandle.release();
      throw error;
    }
  }

  adoptLock(lockHandle: LockHandle): void {
    if (this.lockHandle !== null) {
      throw new Error('Session recording already owns a lock');
    }
    this.lockHandle = lockHandle;
  }

  /**
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 53-67
   */
  constructor(config: SessionRecordingServiceConfig) {
    const maxQueueBytes = config.maxQueueBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxQueueBytes) || maxQueueBytes < 0) {
      throw new Error(
        'Session recording queue byte limit must be a non-negative safe integer',
      );
    }
    this.sessionId = config.sessionId;
    this.projectHash = config.projectHash;
    this.chatsDir = config.chatsDir;
    this.maxQueueBytes = maxQueueBytes;
    this.mediaStore = config.mediaStore;

    const startPayload = {
      sessionId: config.sessionId,
      projectHash: config.projectHash,
      workspaceDirs: config.workspaceDirs,
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      provider: config.provider,
      model: config.model,
      startTime: new Date().toISOString(),
    };
    this.bufferPreContent('session_start', startPayload);
  }

  /**
   * Buffer an event before file materialization (before first content event).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 69-79
   */
  private bufferPreContent(type: SessionEventType, payload: unknown): void {
    const line: SessionRecordLine = {
      v: type === 'semantic_media_purge' ? 2 : recordingVersion(payload),
      seq: this.seq + 1,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    const record = toPendingRecord(line);
    this.reserveQueueBytes(record.bytes);
    this.seq = line.seq;
    this.preContentBuffer.push(record);
    this.preContentBytes += record.bytes;
    this.reportHighWater();
  }

  /**
   * Enqueue an event for writing to the JSONL file.
   * Synchronous and non-blocking — actual I/O happens in the background.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003, REQ-REC-004
   * @pseudocode session-recording-service.md lines 81-110
   */
  enqueue(type: SessionEventType, payload: unknown): SessionRecordLine | null {
    if (this.lifecycle.status !== 'active') return null;
    if (!this.materialized && !MATERIALIZING_EVENT_TYPES.has(type)) {
      this.bufferPreContent(type, payload);
      return (
        this.preContentBuffer[this.preContentBuffer.length - 1]?.line ?? null
      );
    }

    const line: SessionRecordLine = {
      v: type === 'semantic_media_purge' ? 2 : recordingVersion(payload),
      seq: this.seq + 1,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    const record = toPendingRecord(line);
    this.reserveQueueBytes(record.bytes);
    if (!this.materialized) {
      this.materialize();
      this.queue.push(...this.preContentBuffer);
      this.queueBytes += this.preContentBytes;
      this.preContentBuffer = [];
      this.preContentBytes = 0;
      this.materialized = true;
    }
    this.seq = line.seq;
    this.queue.push(record);
    this.queueBytes += record.bytes;
    this.reportHighWater();
    this.scheduleDrain();
    return line;
  }

  private reserveQueueBytes(bytes: number): void {
    const pendingBytes = this.queueBytes + this.preContentBytes;
    if (bytes > this.maxQueueBytes - pendingBytes) {
      throw new Error(
        `Session recording queue byte limit exceeded: ${pendingBytes} + ${bytes} > ${this.maxQueueBytes}`,
      );
    }
  }

  private takeRecordingFailure(): unknown | undefined {
    if (this.lifecycle.status !== 'failed') return undefined;
    const error = this.lifecycle.error;
    this.lifecycle = { status: 'failure-reported' };
    return error;
  }

  private transitionToFailure(error: unknown): void {
    const failures: unknown[] = [error];
    this.queue = [];
    this.queueBytes = 0;
    this.preContentBuffer = [];
    this.preContentBytes = 0;
    try {
      this.chatsDirWatcher?.close();
    } catch (cleanupError: unknown) {
      failures.push(cleanupError);
    }
    this.chatsDirWatcher = null;
    this.lifecycle = {
      status: 'failed',
      error:
        failures.length === 1
          ? error
          : new AggregateError(
              failures,
              'Session recording write and watcher cleanup failed',
            ),
    };
  }

  /**
   * Reports, once, that the writer has fallen far behind. Deliberately does not
   * drop records: the JSONL file is the durable transcript, and the queue is
   * bounded in practice by disk throughput, which far exceeds the rate at which
   * a model can produce content.
   */
  private reportHighWater(): void {
    if (
      this.highWaterReported ||
      this.queue.length + this.preContentBuffer.length <
        QUEUE_HIGH_WATER_RECORDS
    ) {
      return;
    }
    this.highWaterReported = true;
    debugLogger.error(
      `[SessionRecording] pending queue exceeded ${QUEUE_HIGH_WATER_RECORDS} records ` +
        `(${this.queueBytes + this.preContentBytes} bytes); the session file writer is behind. ` +
        `No records are dropped.`,
    );
  }

  /** Number of records waiting to be written. Zero once the queue has drained. */
  getPendingRecordCount(): number {
    return this.queue.length + this.preContentBuffer.length;
  }

  /** Bytes waiting to be written. Zero once the queue has drained. */
  getPendingByteCount(): number {
    return this.queueBytes + this.preContentBytes;
  }

  /**
   * Construct the filename and ensure the chats directory exists.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 112-118
   */
  private materialize(): void {
    const now = new Date();
    const timestamp = now.toISOString().slice(0, 19).replace(/:/g, '-');
    const prefix = this.sessionId.substring(0, SESSION_FILE_ID_PREFIX_LENGTH);
    const fileName = `session-${timestamp}-${prefix}.jsonl`;
    this.filePath = path.join(this.chatsDir, fileName);
    mkdirSync(this.chatsDir, { recursive: true });
    this.startChatsDirWatcher();
  }

  /**
   * Schedule a background drain of the queue.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 120-124
   */
  private scheduleDrain(): void {
    if (this.draining) return;
    this.draining = true;
    this.drainPromise = this.drain().catch((error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        const diag = this.diagnoseMissingPath();
        debugLogger.error(
          `[SessionRecording] ENOENT writing session file — recording stopped.
` +
            `  filePath: ${this.filePath}
` +
            `  chatsDir exists: ${diag.chatsDirExists}
` +
            `  parentDir exists: ${diag.parentDirExists} (${diag.parentDir})
` +
            `  grandparentDir exists: ${diag.grandparentDirExists} (${diag.grandparentDir})
` +
            `  This directory was removed mid-session by an external process or AI shell command.`,
        );
      } else {
        debugLogger.error(
          `[SessionRecording] Unexpected error writing session file — recording stopped.
` +
            `  filePath: ${this.filePath}
` +
            `  error: ${error}`,
        );
      }
      this.transitionToFailure(error);
    });
  }

  /**
   * Drain the queue by writing all queued events to disk via appendFile.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-005, REQ-REC-006
   * @pseudocode session-recording-service.md lines 126-146
   */
  private async drain(): Promise<void> {
    try {
      while (this.queue.length > 0) {
        const batch = [...this.queue];
        const lines = batch.map((record) => record.json).join('\n') + '\n';
        const shouldContinue = await this.writeBatchToFile(lines);
        if (!shouldContinue) {
          return;
        }
        this.queue = this.queue.slice(batch.length);
        this.queueBytes -= batch.reduce(
          (total, record) => total + record.bytes,
          0,
        );
      }
    } finally {
      this.draining = false;
    }
  }

  /**
   * Write a batch of events to the file.
   * Returns true if draining should continue, false if it should stop.
   */
  private async writeBatchToFile(lines: string): Promise<boolean> {
    try {
      await fs.appendFile(this.filePath!, lines, 'utf-8');
      return true;
    } catch (error: unknown) {
      if (this.isDiskSpaceError(error)) {
        this.transitionToFailure(error);
        return false;
      }
      throw error;
    }
  }

  /**
   * Check if an error indicates disk space or permission issues.
   */
  private isDiskSpaceError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException).code;
    return code === 'ENOSPC' || code === 'EACCES';
  }

  /**
   * Flush all queued events to disk.
   * Returns a Promise that resolves when all pending writes are complete.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-005
   * @pseudocode session-recording-service.md lines 148-160
   */
  async flush(): Promise<void> {
    const existingFailure = this.takeRecordingFailure();
    if (existingFailure !== undefined) throw existingFailure;
    if (this.lifecycle.status !== 'active') return;
    if (this.queue.length === 0 && !this.draining) return;

    if (this.drainPromise) {
      await this.drainPromise;
      const drainFailure = this.takeRecordingFailure();
      if (drainFailure !== undefined) throw drainFailure;
    }

    if (this.queue.length > 0) {
      this.draining = true;
      this.drainPromise = this.drain().catch((error: unknown) => {
        this.transitionToFailure(error);
      });
      await this.drainPromise;
      const drainFailure = this.takeRecordingFailure();
      if (drainFailure !== undefined) throw drainFailure;
    }
  }

  /**
   * Whether recording is active (not disabled by ENOSPC or disposal).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-007
   * @pseudocode session-recording-service.md line 162-164
   */
  isActive(): boolean {
    return this.lifecycle.status === 'active';
  }

  /**
   * Path to the JSONL file, or null if not yet materialized.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-004
   * @pseudocode session-recording-service.md lines 166-168
   */
  getFilePath(): string | null {
    return this.filePath;
  }

  /**
   * The session identifier for this recording.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 170-172
   */
  getSessionId(): string {
    return this.sessionId;
  }

  ownsLockFor(sessionId: string): boolean {
    return (
      this.lifecycle.status === 'active' &&
      this.sessionId === sessionId &&
      this.lockHandle !== null
    );
  }

  getChatsDir(): string {
    return this.chatsDir;
  }

  getProjectHash(): string {
    return this.projectHash;
  }

  getOwnedLockHandle(): LockHandle | null {
    return this.lifecycle.status === 'active' ? this.lockHandle : null;
  }

  /**
   * Initialize for resuming an existing session file.
   * Sets the file path and sequence counter so new events append correctly.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-008
   * @pseudocode session-recording-service.md lines 174-179
   */
  initializeForResume(
    filePath: string,
    lastSeq: number,
    title?: string | null,
  ): void {
    this.filePath = filePath;
    this.seq = lastSeq;
    this.materialized = true;
    this.preContentBuffer = [];
    this.preContentBytes = 0;
    this.sessionTitle = title;
    this.startChatsDirWatcher();
  }

  /**
   * Dispose of the service: flush any remaining events, then stop recording.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-003
   * @pseudocode session-recording-service.md lines 181-185
   */
  async dispose(): Promise<void> {
    const failures: unknown[] = [];
    if (this.lifecycle.status !== 'disposed') {
      try {
        await this.flush();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    this.lifecycle = { status: 'disposed' };
    this.queue = [];
    this.queueBytes = 0;
    this.preContentBuffer = [];
    this.preContentBytes = 0;
    if (this.chatsDirWatcher) {
      try {
        this.chatsDirWatcher.close();
      } catch (error: unknown) {
        failures.push(error);
      }
      this.chatsDirWatcher = null;
    }
    const lockHandle = this.lockHandle;
    try {
      await lockHandle?.release();
    } catch (error: unknown) {
      failures.push(error);
    } finally {
      if (this.lockHandle === lockHandle) {
        this.lockHandle = null;
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Failed to dispose recording service');
    }
  }

  /**
   * Diagnose which directory level is missing when ENOENT occurs.
   */
  private diagnoseMissingPath(): {
    chatsDirExists: boolean;
    parentDir: string;
    parentDirExists: boolean;
    grandparentDir: string;
    grandparentDirExists: boolean;
  } {
    const parentDir = path.dirname(this.chatsDir);
    const grandparentDir = path.dirname(parentDir);
    return {
      chatsDirExists: existsSync(this.chatsDir),
      parentDir,
      parentDirExists: existsSync(parentDir),
      grandparentDir,
      grandparentDirExists: existsSync(grandparentDir),
    };
  }

  /**
   * Watch the chatsDir for rename/deletion events.
   * When the directory is removed mid-session, this fires and logs the
   * exact timestamp so it can be correlated with the shell command log.
   */
  private startChatsDirWatcher(): void {
    if (this.chatsDirWatcher) return;
    try {
      if (process.platform === 'win32') {
        const listener = (currentStats: Stats): void => {
          if (currentStats.nlink === 0) {
            this.handleChatsDirChange(this.chatsDir);
          }
        };
        watchFile(
          this.chatsDir,
          { persistent: false, interval: 100 },
          listener,
        );
        this.chatsDirWatcher = {
          close: () => unwatchFile(this.chatsDir, listener),
        };
        return;
      }

      const watcher = watch(
        this.chatsDir,
        { persistent: false },
        (eventType) => {
          if (eventType === 'rename') {
            this.handleChatsDirChange(this.chatsDir);
          }
        },
      );
      this.chatsDirWatcher = watcher;
      watcher.on('error', () => {
        watcher.close();
        if (this.chatsDirWatcher === watcher) {
          this.chatsDirWatcher = null;
        }
      });
    } catch {
      // If watch fails (e.g. directory already gone), silently skip
    }
  }

  private handleChatsDirChange(watchDir: string): void {
    if (existsSync(watchDir)) {
      return;
    }
    debugLogger.error(
      `[SessionRecording] chatsDir was removed at ${new Date().toISOString()}!\n` +
        `  path: ${this.chatsDir}\n` +
        `  sessionId: ${this.sessionId}\n` +
        `  filePath: ${this.filePath}\n` +
        `  Check the preceding shell command for the culprit.`,
    );
    this.chatsDirWatcher?.close();
    this.chatsDirWatcher = null;
  }

  // -------------------------------------------------------------------------
  // Convenience methods — delegate to enqueue with typed payloads
  // @pseudocode session-recording-service.md lines 190-212
  // -------------------------------------------------------------------------

  /**
   * Record a content event (user message, AI response, or tool interaction).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 190-192
   */
  recordContent(content: IContent): void {
    this.enqueue('content', { content });
  }

  prepareContentBatch(contents: readonly IContent[]): PreparedContentBatch {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot record content batch: recording is not active');
    }
    if (this.draining) {
      throw new Error(
        'Cannot record content batch while recording is draining',
      );
    }

    const expectedSeq = this.seq;
    const records = contents.map((content, index) =>
      toPendingRecord({
        v: recordingVersion({ content }),
        seq: expectedSeq + index + 1,
        ts: new Date().toISOString(),
        type: 'content',
        payload: { content },
      }),
    );
    const batchBytes = totalRecordBytes(records);
    const pendingBytes = this.queueBytes + this.preContentBytes;
    if (batchBytes > this.maxQueueBytes - pendingBytes) {
      throw new Error(
        `Session recording queue byte limit exceeded: ${pendingBytes} + ${batchBytes} > ${this.maxQueueBytes}`,
      );
    }

    const queueBefore = this.queue;
    const queueBytesBefore = this.queueBytes;
    const preContentBefore = this.preContentBuffer;
    const preContentBytesBefore = this.preContentBytes;
    const materializedBefore = this.materialized;
    const filePathBefore = this.filePath;
    const watcherBefore = this.chatsDirWatcher;
    let published = false;
    let finalized = false;

    return {
      publish: () => {
        if (published) throw new Error('Content batch was already published');
        if (this.seq !== expectedSeq) {
          throw new Error('Recording changed after content batch preflight');
        }
        published = true;
        if (!this.materialized) {
          this.materialize();
          this.queue = [...this.preContentBuffer, ...records];
          this.queueBytes = this.preContentBytes + batchBytes;
          this.preContentBuffer = [];
          this.preContentBytes = 0;
          this.materialized = true;
        } else {
          this.queue = [...this.queue, ...records];
          this.queueBytes += batchBytes;
        }
        this.seq = expectedSeq + records.length;
        this.reportHighWater();
      },
      rollback: () => {
        if (!published || finalized) return;
        if (this.chatsDirWatcher !== watcherBefore) {
          this.chatsDirWatcher?.close();
        }
        this.queue = queueBefore;
        this.queueBytes = queueBytesBefore;
        this.preContentBuffer = preContentBefore;
        this.preContentBytes = preContentBytesBefore;
        this.materialized = materializedBefore;
        this.filePath = filePathBefore;
        this.chatsDirWatcher = watcherBefore;
        this.seq = expectedSeq;
        published = false;
      },
      finalize: () => {
        if (!published) {
          throw new Error('Cannot finalize an unpublished content batch');
        }
        finalized = true;
        this.scheduleDrain();
      },
    };
  }

  recordSemanticMediaPurge(
    history: readonly IContent[],
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
  ): void {
    this.enqueue('semantic_media_purge', { history, frontier });
  }

  /**
   * Record a compression event — history was compressed into a summary.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 194-196
   */
  recordCompressed(summary: IContent, itemsCompressed: number): void {
    this.enqueue('compressed', { summary, itemsCompressed });
  }

  /**
   * Record a rewind event — last N items removed from history.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 198-200
   */
  recordRewind(itemsRemoved: number): void {
    this.enqueue('rewind', { itemsRemoved });
  }

  /**
   * Record a provider/model switch event.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 202-204
   */
  recordProviderSwitch(provider: string, model: string): void {
    this.enqueue('provider_switch', { provider, model });
  }

  /**
   * Record an operational session event (info, warning, or error).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 206-208
   */
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void {
    this.enqueue('session_event', { severity, message });
  }

  /**
   * Record a workspace directories change event.
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 210-212
   */
  recordDirectoriesChanged(directories: string[]): void {
    this.enqueue('directories_changed', { directories });
  }

  /**
   * Record a session_metadata event — persisted human-readable title.
   * The title is tri-state: `string` for a concrete title, `null` for explicit
   * untitled, `undefined` for legacy (field absent). Like `content`, this event
   * materializes the file so slash/failure sessions persist metadata even
   * without a content event.
   *
   * @requirement REQ-REC-002
   */
  recordSessionMetadata(title: string | null): void {
    if (this.lifecycle.status !== 'active') {
      return;
    }
    this.enqueue('session_metadata', { title });
    this.sessionTitle = title;
  }

  getSessionMetadataTitle(): string | null | undefined {
    return this.sessionTitle;
  }

  // -------------------------------------------------------------------------
  // Durable checkpoint / session-name / fork lifecycle operations.
  //
  // These operations flush to disk before resolving and reject on
  // inactive/failed recorders rather than silently succeeding.
  // -------------------------------------------------------------------------

  /**
   * Create an immutable checkpoint at the current recording sequence.
   * The checkpoint is flushed before the promise resolves.
   * Rejects if the conversation is empty/unmaterialized or the recorder is inactive.
   */
  async createCheckpoint(name: string): Promise<RecordingCheckpointInfo> {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot create checkpoint: recording is not active');
    }
    if (!this.materialized) {
      throw new Error(
        'Cannot create checkpoint: conversation has no content yet',
      );
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot create checkpoint: name must not be empty');
    }

    await this.flushAndRequireActive('create checkpoint');
    const filePath = this.filePath;
    if (filePath === null) {
      throw new Error(
        'Cannot create checkpoint: conversation has no content yet',
      );
    }
    const replay = await replaySession(filePath, this.projectHash, {
      mediaStore: this.mediaStore,
    });
    if (!replay.ok) {
      throw new Error(`Cannot create checkpoint: ${replay.error}`);
    }
    if (replay.sequenceCorrupt) {
      throw new Error(
        'Cannot create checkpoint: recording has non-monotonic sequences',
      );
    }
    if (replay.history.length === 0) {
      throw new Error(
        'Cannot create checkpoint: conversation has no content yet',
      );
    }

    const checkpointId = crypto.randomUUID();
    const event = this.enqueue('checkpoint_created', {
      checkpointId,
      name: trimmed,
    });
    if (event === null) {
      throw new Error('Cannot create checkpoint: recording is not active');
    }
    await this.flushAndRequireActive('create checkpoint');

    return { checkpointId, name: trimmed, sequence: event.seq };
  }

  /**
   * Delete (tombstone) a checkpoint by stable ID.
   * The lifecycle event is flushed before the promise resolves.
   */
  async deleteCheckpoint(checkpointId: string): Promise<void> {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot delete checkpoint: recording is not active');
    }
    if (!this.materialized) {
      throw new Error(
        'Cannot delete checkpoint: recording is not materialized',
      );
    }
    this.enqueue('checkpoint_deleted', { checkpointId });
    await this.flushAndRequireActive('delete checkpoint');
  }

  /**
   * Rename a checkpoint by stable ID.
   * Only display metadata changes; the watermark and ID are unaffected.
   */
  async renameCheckpoint(checkpointId: string, name: string): Promise<void> {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot rename checkpoint: recording is not active');
    }
    if (!this.materialized) {
      throw new Error(
        'Cannot rename checkpoint: recording is not materialized',
      );
    }
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new Error('Cannot rename checkpoint: name must not be empty');
    }
    this.enqueue('checkpoint_renamed', { checkpointId, name: trimmed });
    await this.flushAndRequireActive('rename checkpoint');
  }

  /**
   * Assign or clear the mutable session name.
   * Pass `null` to clear the name.
   */
  async setSessionName(name: string | null): Promise<void> {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot set session name: recording is not active');
    }
    const resolved = name === null ? null : name.trim();
    if (resolved !== null && resolved.length === 0) {
      throw new Error('Cannot set session name: name must not be empty');
    }
    this.enqueue('session_named', { name: resolved });
    await this.flushAndRequireActive('set session name');
  }

  private async flushAndRequireActive(operation: string): Promise<void> {
    await this.flush();
    if (!this.isActive()) {
      throw new Error(`Cannot ${operation}: recording failed during flush`);
    }
  }

  /**
   * Record ancestry metadata when seeding a forked child session.
   * The child recording is self-contained after this.
   */
  recordSessionFork(payload: SessionForkedPayload): void {
    if (this.lifecycle.status !== 'active') {
      throw new Error('Cannot record session fork: recording is inactive');
    }
    this.enqueue('session_forked', payload);
  }
}
