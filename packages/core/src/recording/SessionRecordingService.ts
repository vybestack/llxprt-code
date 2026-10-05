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
 * file materialization, and fail-fast write handling.
 *
 * Since PLAN-20260917-ISSUE854.P05b2, append is the commit point:
 * `commit`/`waitForCommit` await a per-record {seq, byteOffset} watermark,
 * the queue bound applies backpressure instead of throwing, explicit
 * `Infinity` opts out of the bound, and write failures reject every pending
 * commit with the underlying error and poison the recorder.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  RecordingTicketQueue,
  type PendingRecord,
} from './recording-ticket-queue.js';
import { type IContent } from '../services/history/IContent.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  type SessionRecordingServiceConfig,
  type SessionEventType,
  type SessionRecordLine,
  type RecordingCheckpointInfo,
  type SessionForkedPayload,
  type DensityMutationPayload,
  type SyntheticInsertPayload,
  type CompressionDetailPayload,
  type CommitWatermark,
  type RecordingWriterIo,
  type RecordingWriterObservation,
} from './types.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { replaySession } from './ReplayEngine.js';
import { CommitAckRegistry } from './CommitAckRegistry.js';
import { diagnoseMissingPath, watchChatsDir } from './ChatsDirWatcher.js';
import type { LocalMediaStore } from '../storage/local-media-store.js';
import {
  stagePurgeRecordingRows,
  preparePurgeRecordingRecord,
  validatePurgeRecordingForLiveFold,
  type PurgeRecordingOptions,
} from './semanticPurgeRecordingRows.js';

export type { SessionRecordingServiceConfig };

export const SESSION_FILE_ID_PREFIX_LENGTH = 12;

/**
 * Default hard bound for serialized records waiting for durable write
 * (PLAN-20260917-ISSUE854.P05b2). Above it, awaitable committers
 * (`commit`/`waitForCommit` callers) are held by backpressure instead of the
 * legacy synchronous throw; explicit `Infinity` is the only opt-out.
 */
export const DEFAULT_MAX_QUEUE_BYTES = 8 * 1024 * 1024;

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
 * write (issue #2852). Only the serialized form is retained: the live payload
 * object graph is not pinned until drain (issue #3432).
 */

function toPendingRecord(line: SessionRecordLine): PendingRecord {
  const json = JSON.stringify(line);
  return {
    seq: line.seq,
    json,
    bytes: Buffer.byteLength(json, 'utf8') + 1,
  };
}

/** Default write seam: journal appends go through `fs/promises.appendFile`. */
const defaultWriterIo: RecordingWriterIo = {
  appendFile(filePath, data, encoding) {
    return fs.appendFile(filePath, data, encoding);
  },
};

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
  private readonly queue = new RecordingTicketQueue();
  private queueBytes: number = 0;
  private highWaterReported: boolean = false;
  private seq: number = 0;
  private filePath: string | null = null;
  private materialized: boolean = false;
  private lifecycle: RecordingLifecycle = { status: 'active' };
  private closing = false;
  private draining: boolean = false;
  private drainPromise: Promise<void> | null = null;
  private readonly sessionId: string;
  private readonly projectHash: string;
  private readonly chatsDir: string;
  private readonly maxQueueBytes: number;
  private readonly mediaStore: LocalMediaStore | undefined;
  private readonly io: RecordingWriterIo;
  private readonly observeWriter:
    | ((state: RecordingWriterObservation) => void)
    | undefined;
  private writingBatch: readonly PendingRecord[] = [];
  private writingLines: string | null = null;
  private readonly preContentBuffer = new RecordingTicketQueue();
  private preContentBytes: number = 0;
  private chatsDirWatcher: { close(): void } | null = null;
  private sessionTitle: string | null | undefined;
  private lockHandle: LockHandle | null = null;

  // Awaitable commit protocol state (PLAN-20260917-ISSUE854.P05b2).
  /** Pending commit acks, seq-ordered watermarks, drain gate, base offset. */
  private readonly acks = new CommitAckRegistry();
  /** First write failure, preserved so poisoned commit()/waitForCommit() always reject with it. */
  private poisonError: unknown = null;
  private readonly watermarkListeners = new Set<
    (watermark: CommitWatermark) => void
  >();

  onCommitWatermark(
    listener: (watermark: CommitWatermark) => void,
  ): () => void {
    this.watermarkListeners.add(listener);
    return () => this.watermarkListeners.delete(listener);
  }

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
    const maxQueueBytes = config.maxQueueBytes ?? DEFAULT_MAX_QUEUE_BYTES;
    const validBound =
      (Number.isSafeInteger(maxQueueBytes) && maxQueueBytes >= 0) ||
      maxQueueBytes === Number.POSITIVE_INFINITY;
    if (!validBound) {
      throw new Error(
        'Session recording queue byte limit must be a non-negative safe integer or Infinity',
      );
    }
    this.sessionId = config.sessionId;
    this.projectHash = config.projectHash;
    this.chatsDir = config.chatsDir;
    this.maxQueueBytes = maxQueueBytes;
    this.mediaStore = config.mediaStore;
    this.io = config.io ?? defaultWriterIo;
    this.observeWriter = config.observeWriter;

    const startPayload = {
      sessionId: config.sessionId,
      projectHash: config.projectHash,
      workspaceDirs: config.workspaceDirs,
      ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
      provider: config.provider,
      model: config.model,
      startTime: new Date().toISOString(),
      kind: config.kind ?? 'main',
      ...(config.parentSessionId === undefined
        ? {}
        : { parentSessionId: config.parentSessionId }),
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
  private bufferPreContent(
    type: SessionEventType,
    payload: unknown,
  ): SessionRecordLine {
    const line: SessionRecordLine = {
      v: type === 'semantic_media_purge' ? 2 : recordingVersion(payload),
      seq: this.seq + 1,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    const record = toPendingRecord(line);
    this.preContentBuffer.push(record);
    this.seq = line.seq;
    this.preContentBytes += record.bytes;
    this.reportHighWater();
    this.observe('pre-content');
    return line;
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
    if (!this.isActive()) return null;
    if (!this.materialized && !MATERIALIZING_EVENT_TYPES.has(type)) {
      return this.bufferPreContent(type, payload);
    }

    const line: SessionRecordLine = {
      v: type === 'semantic_media_purge' ? 2 : recordingVersion(payload),
      seq: this.seq + 1,
      ts: new Date().toISOString(),
      type,
      payload,
    };
    const record = toPendingRecord(line);
    this.stageRecord(record);
    this.reportHighWater();
    this.scheduleDrain();
    return line;
  }

  // -------------------------------------------------------------------------
  // Awaitable commit protocol (PLAN-20260917-ISSUE854.P05b2).
  //
  // Append is the commit point: once a record's bytes are on disk the record
  // is committed and nothing rolls it back. `commit`/`waitForCommit` return a
  // per-record ack carrying a monotone {seq, byteOffset} watermark; write
  // failures reject every pending ack with the underlying error and poison
  // the recorder for subsequent commits.
  // -------------------------------------------------------------------------

  /**
   * Append an event and await its durability. Resolves with the commit
   * watermark once the record's bytes are on disk. Commits above the queue
   * byte bound apply backpressure (the caller awaits drain room) instead of
   * the legacy synchronous throw; a commit always materializes the session
   * file so the durability it promises has a target.
   *
   * @plan PLAN-20260917-ISSUE854.P05b2
   * @requirement G2
   */
  async commit(
    type: SessionEventType,
    payload: unknown,
  ): Promise<CommitWatermark> {
    this.requireCommittable();
    for (;;) {
      // Line serialization, room check, and admission form one synchronous
      // segment: no interleaving enqueue can invalidate the room decision
      // between check and push.
      const line: SessionRecordLine = {
        v: type === 'semantic_media_purge' ? 2 : recordingVersion(payload),
        seq: this.seq + 1,
        ts: new Date().toISOString(),
        type,
        payload,
      };
      const record = toPendingRecord(line);
      if (!this.admissionBlocked(record.bytes) || this.queueCannotDrain()) {
        return this.admitCommitRecord(line, record);
      }
      await this.acks.nextDrainCompletion();
      // Waking above does not imply room: the recorder may have been poisoned
      // or disposed while this commit was gated.
      this.requireCommittable();
    }
  }

  /**
   * Await durability of an already-enqueued line, in seq order relative to
   * other pending commits. Rejects when the write fails or the recorder is
   * poisoned or disposed — never resolves null.
   *
   * @plan PLAN-20260917-ISSUE854.P05b2
   * @requirement G2
   */
  waitForCommit(line: SessionRecordLine): Promise<CommitWatermark> {
    return this.waitForCommitSequence(line.seq);
  }

  waitForCommitSequence(seq: number): Promise<CommitWatermark> {
    const pending = this.acks.find(seq);
    if (pending !== undefined) return pending.chained;
    if (this.lifecycle.status === 'disposed') {
      return Promise.reject(
        new Error('waitForCommit: session recording is disposed'),
      );
    }
    if (this.poisonError !== null) {
      this.takeRecordingFailure();
      return Promise.reject(this.poisonError);
    }
    const last = this.acks.lastWatermark;
    if (last !== null && seq <= this.acks.lastAckedSeq) {
      // Already acked. Durability is monotone, so the latest watermark is a
      // valid proof for this seq (exact when it was the last record).
      return Promise.resolve(last);
    }
    if (seq > this.seq)
      return Promise.reject(
        new Error(
          `waitForCommit: sequence ${seq} was never enqueued in this recording`,
        ),
      );
    return this.acks.register(seq).chained;
  }

  /** Throws for disposed or poisoned recorders; commit-family rejects loudly instead of returning null. */
  private requireCommittable(): void {
    if (this.closing || this.lifecycle.status === 'disposed') {
      throw new Error('commit: session recording is disposed');
    }
    if (this.poisonError !== null) {
      this.takeRecordingFailure();
      throw this.poisonError;
    }
  }

  /** True when admitting `bytes` more would push the pending queue over the bound. `Infinity` never blocks. */
  private admissionBlocked(bytes: number): boolean {
    if (this.maxQueueBytes === Number.POSITIVE_INFINITY) return false;
    return this.queueBytes + this.preContentBytes + bytes > this.maxQueueBytes;
  }

  /** True when no drain can start on its own, so waiting for drain room would deadlock. */
  private queueCannotDrain(): boolean {
    return !this.draining && this.queue.length === 0;
  }

  private admitCommitRecord(
    line: SessionRecordLine,
    record: PendingRecord,
  ): Promise<CommitWatermark> {
    this.stageRecord(record);
    this.reportHighWater();
    const ack = this.acks.register(line.seq);
    this.scheduleDrain();
    this.observe('admit');
    return ack.chained;
  }

  private stageRecord(record: PendingRecord): void {
    if (!this.materialized) {
      this.materialize();
      try {
        for (const pending of this.preContentBuffer) this.queue.push(pending);
        this.queue.push(record);
      } catch (error) {
        this.queue.clear();
        throw error;
      }
      this.queueBytes += this.preContentBytes;
      this.preContentBuffer.clear();
      this.preContentBytes = 0;
      this.materialized = true;
    } else {
      this.queue.push(record);
    }
    this.seq = record.seq;
    this.queueBytes += record.bytes;
  }

  private takeRecordingFailure(): unknown | undefined {
    if (this.lifecycle.status !== 'failed') return undefined;
    const error = this.lifecycle.error;
    this.lifecycle = { status: 'failure-reported' };
    return error;
  }

  private transitionToFailure(error: unknown): void {
    const failures: unknown[] = [error];
    const hadPendingCommits = this.acks.pendingCount > 0;
    // Reject every pending commit/waitForCommit with the underlying error
    // before the teardown below discards their records: the ack registry is
    // independent of the legacy queue clearing
    // (PLAN-20260917-ISSUE854.P05b2).
    this.acks.failAll(error);
    // The commit rejections carry the failure to their callers, so consume
    // the one-shot flush() report with them when it is still armed:
    // `takeRecordingFailure` is a no-op while the lifecycle is still
    // 'active', and leaving the report armed made dispose()'s flush rethrow
    // an already-delivered failure (PLAN-20260917-ISSUE854.P05b2).
    if (
      hadPendingCommits &&
      (this.lifecycle.status === 'active' || this.lifecycle.status === 'failed')
    ) {
      this.lifecycle = { status: 'failure-reported' };
    }
    this.queue.clear();
    this.queueBytes = 0;
    this.preContentBuffer.clear();
    this.preContentBytes = 0;
    try {
      this.chatsDirWatcher?.close();
    } catch (cleanupError: unknown) {
      failures.push(cleanupError);
    }
    this.chatsDirWatcher = null;
    const canonicalError =
      failures.length === 1
        ? error
        : new AggregateError(
            failures,
            'Session recording write and watcher cleanup failed',
          );
    if (this.poisonError === null) {
      this.poisonError = canonicalError;
    }
    // Wake commits gated on drain room so they observe the poison instead of
    // hanging.
    this.acks.notifyDrainCompletion();
    // Preserve a failure-report already consumed above (pending commits
    // carried it); otherwise arm the one-shot flush() report.
    this.lifecycle =
      this.lifecycle.status === 'failure-reported'
        ? { status: 'failure-reported' }
        : { status: 'failed', error: canonicalError };
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

  retireIdleTicketStorage(): void {
    this.queue.retireIdleStorage();
    this.preContentBuffer.retireIdleStorage();
  }

  /** Number of records waiting to be written. Zero once the queue has drained. */
  getPendingRecordCount(): number {
    return this.queue.length + this.preContentBuffer.length;
  }

  /** Bytes waiting to be written. Zero once the queue has drained. */
  getPendingByteCount(): number {
    return this.queueBytes + this.preContentBytes;
  }

  private observe(phase: RecordingWriterObservation['phase']): void {
    this.observeWriter?.({
      phase,
      preContent: [],
      queue: [],
      batch: this.writingBatch,
      lines: this.writingLines,
      preContentBytes: this.preContentBytes,
      queueBytes: this.queueBytes,
      pendingAcks: this.acks.pendingCount,
      lastAckedSeq: this.acks.lastAckedSeq,
      lastByteOffset: this.acks.baseOffset,
    });
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
        const diag = diagnoseMissingPath(this.chatsDir);
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
        await this.acks.ensureBaseOffset(this.filePath!);
        const record = this.queue.read(0);
        const batch = [record];
        const batchBytes = record.bytes;
        const startOffset = this.acks.baseOffset;
        this.writingBatch = batch;
        if (batch[0].staged !== undefined) {
          await this.writeStagedRecord(batch[0]);
        } else {
          const lines = batch.map((record) => record.json).join('\n') + '\n';
          this.writingLines = lines;
          this.observe('append');
          await this.writeBatchToFile(lines);
        }
        if (this.lifecycle.status !== 'active') return;
        // The append resolved: this batch's bytes are durable. Ack each
        // record at its exclusive end offset before admitting the next
        // batch (read-your-write, PLAN-20260917-ISSUE854.P05b2).
        this.acks.fireBatch(batch, startOffset);
        const watermark = this.acks.lastWatermark;
        if (watermark !== null)
          this.watermarkListeners.forEach((listener) => listener(watermark));
        this.queue.removeFirst();
        this.queueBytes -= batchBytes;
        this.writingBatch = [];
        this.writingLines = null;
        this.observe('acked');
      }
    } finally {
      this.writingBatch = [];
      this.writingLines = null;
      this.draining = false;
      this.acks.notifyDrainCompletion();
      this.observe('drained');
    }
  }

  /**
   * Write a batch of events to the file.
   * Returns true if draining should continue, false if it should stop.
   */
  private async writeStagedRecord(record: PendingRecord): Promise<void> {
    const staged = record.staged;
    if (staged === undefined || record.suffix === undefined)
      throw new Error('Missing staged semantic purge recording');
    const append = async (text: string): Promise<void> => {
      this.writingLines = text;
      this.observe('append');
      await this.io.appendFile(this.filePath!, text, 'utf8');
      this.writingLines = null;
    };
    try {
      await append(record.json);
      for await (const chunk of staged.stream()) await append(chunk);
      await append(record.suffix);
    } finally {
      staged.close();
    }
  }

  private async writeBatchToFile(lines: string): Promise<boolean> {
    try {
      await this.io.appendFile(this.filePath!, lines, 'utf8');
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

    while (this.queue.length > 0 || this.draining) {
      this.scheduleDrain();
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
    return this.lifecycle.status === 'active' && !this.closing;
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

  getLastEnqueuedSequence(): number {
    return this.seq;
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
    this.preContentBuffer.clear();
    this.preContentBytes = 0;
    // Watermark offsets are absolute for the (possibly different) journal
    // file; re-seed from the file size at the next drained batch.
    this.acks.resetBaseOffset();
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
    this.closing = true;
    const failures: unknown[] = [];
    if (this.lifecycle.status !== 'disposed') {
      try {
        await this.flush();
      } catch (error: unknown) {
        failures.push(error);
      }
    }
    // Any commit still pending here can never become durable; reject it
    // rather than leave the caller hanging
    // (PLAN-20260917-ISSUE854.P05b2).
    this.acks.failAll(
      failures[0] ??
        new Error('Session recording disposed before commit was durable'),
    );
    this.acks.notifyDrainCompletion();
    this.lifecycle = { status: 'disposed' };
    this.watermarkListeners.clear();
    this.queue.clear();
    this.queueBytes = 0;
    this.preContentBuffer.clear();
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
   * Watch the chatsDir for rename/deletion events.
   * When the directory is removed mid-session, this fires and logs the
   * exact timestamp so it can be correlated with the shell command log.
   */
  private startChatsDirWatcher(): void {
    if (this.chatsDirWatcher) return;
    this.chatsDirWatcher = watchChatsDir(
      this.chatsDir,
      this.sessionId,
      () => this.filePath,
      () => {
        // Null the field so a later rollback-restore can re-arm the watch.
        this.chatsDirWatcher = null;
      },
    );
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

  recordSemanticMediaPurge(
    history: readonly IContent[],
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
  ): void {
    this.enqueue('semantic_media_purge', { history, frontier });
  }

  async recordSemanticMediaPurgeRows(
    history: AsyncIterable<IContent>,
    frontier: { readonly contentIndex: number; readonly blockIndex: number },
    options: PurgeRecordingOptions = {},
  ): Promise<void> {
    this.requireCommittable();
    const staged = await stagePurgeRecordingRows(history, options.signal);
    try {
      for (;;) {
        this.requireCommittable();
        options.signal?.throwIfAborted();
        const { line, record } = preparePurgeRecordingRecord(
          this.seq + 1,
          staged,
          frontier,
        );
        const hasRoom =
          !this.admissionBlocked(record.bytes) || this.queueCannotDrain();
        if (!hasRoom) await this.acks.nextDrainCompletion();
        if (hasRoom) await validatePurgeRecordingForLiveFold(record, options);
        this.requireCommittable();
        options.signal?.throwIfAborted();
        if (
          hasRoom &&
          record.seq === this.seq + 1 &&
          (!this.admissionBlocked(record.bytes) || this.queueCannotDrain())
        ) {
          await this.admitCommitRecord(line, record);
          return;
        }
      }
    } finally {
      staged.close();
    }
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
   * Record a rewind event — history cut from `cutSeq` onwards, which removed
   * `itemsRemoved` items from live history.
   *
   * `cutSeq` is the chronology `seq` of the first removed item and is omitted
   * entirely when the caller could not resolve one, keeping the event
   * byte-identical to a legacy count-only rewind (#2934).
   *
   * @plan PLAN-20260211-SESSIONRECORDING.P05
   * @requirement REQ-REC-002
   * @pseudocode session-recording-service.md lines 198-200
   */
  recordRewind(itemsRemoved: number, cutSeq?: number): void {
    this.enqueue(
      'rewind',
      cutSeq === undefined ? { itemsRemoved } : { itemsRemoved, cutSeq },
    );
  }

  /**
   * Record a density-mutation event — chronology entries removed outright by
   * density optimization plus each in-place replacement, so the previously
   * unjournalled mutation replays exactly (#854).
   *
   * Synchronous and non-blocking like `recordContent`; returns the appended
   * line, or null when recording is inactive/disposed.
   *
   * @plan PLAN-20260917-ISSUE854.P05b1
   * @requirement G2
   */
  recordDensityChange(
    payload: DensityMutationPayload,
  ): SessionRecordLine | null {
    return this.enqueue('density_mutation', payload);
  }

  /**
   * Record a synthetic-insert event — a history entry that did not originate
   * from a model turn (e.g. a synthetic tool response injected by history
   * validation), with its own chronology marker and the anchor marker it
   * follows (#854).
   *
   * @plan PLAN-20260917-ISSUE854.P05b1
   * @requirement G2
   */
  recordSyntheticInsert(
    payload: SyntheticInsertPayload,
  ): SessionRecordLine | null {
    return this.enqueue('synthetic_insert', payload);
  }

  /**
   * Record a compression-detail event — the destroyed span and item count
   * behind a `compressed` event, as a membership-pinning record. Scalars
   * only: content suppression is unchanged from `recordCompressed` (#854).
   *
   * @plan PLAN-20260917-ISSUE854.P05b1
   * @requirement G2
   */
  recordCompressionDetail(
    payload: CompressionDetailPayload,
  ): SessionRecordLine | null {
    return this.enqueue('compression_detail', payload);
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
