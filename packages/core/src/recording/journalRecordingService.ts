/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import type { VersionEdit } from '../journal/groupEdits.js';
import type { CommitAck } from '../journal/groupWriter.js';
import {
  type CheckpointDescriptor,
  checkpointKey,
  encodeCheckpointDescriptor,
  parseCheckpointDescriptor,
} from '../journal/checkpointDescriptor.js';
import {
  JournalSession,
  type JournalSessionOptions,
} from '../services/history/journalSession.js';
import { SessionLockManager, type LockHandle } from './SessionLockManager.js';
import { requireCheckpointName } from './sessionCheckpointGuards.js';
import { journalSessionFileName } from './sessionFileName.js';
import {
  SESSION_KEYS,
  decodeDirectoriesFact,
  decodeProviderFact,
  decodeSessionFact,
  decodePreviewFact,
  decodeTitleFact,
  encodeSessionFact,
} from './sessionMetaKeys.js';
import { logDrainFailure } from './recordingDrainFailure.js';
import type { SessionRecordingPort } from './recordingPort.js';
import type {
  RecordingCheckpointInfo,
  SessionForkedPayload,
  SessionStartKind,
} from './types.js';
import { debugLogger } from '../utils/debugLogger.js';

export interface JournalRecordingConfig {
  readonly sessionId: string;
  readonly projectHash: string;
  readonly chatsDir: string;
  readonly workspaceDirs: string[];
  readonly cwd?: string;
  readonly provider: string;
  readonly model: string;
  readonly kind?: SessionStartKind;
  readonly parentSessionId?: string;
  /** Read once, when the file is created, so the header carries the provider in effect then (#3732). */
  readonly resolveProviderModel?: () => { provider: string; model: string };
  /** File seams and the occurrence planner of the journal (tests, phase 5). */
  readonly journal?: JournalSessionOptions;
}

/** Receives the ack of every group the recorder itself writes. */
export type CommitAckListener = (ack: CommitAck) => void;

function ignore(): void {
  // The failure is kept in `failure` and reported by flush and the next write.
}

/**
 * The session recorder over a journal file. It owns the file, the session
 * lock and the session facts (design 3.5, G6): provider, directories, title,
 * name, fork ancestry and checkpoints are state map entries written one group
 * at a time, in the order they were asked for. Rows are written by the history
 * store through `session()`, not by the recorder.
 *
 * The file is created when something first needs it (a row, a title, a name,
 * a checkpoint), so a session that never says anything leaves no file.
 */
export class JournalRecordingService implements SessionRecordingPort {
  private journalSession: JournalSession | undefined;
  private materialization: Promise<JournalSession> | undefined;
  private tail: Promise<void> = Promise.resolve();
  private failure: { readonly error: unknown } | undefined;
  private failureReported = false;
  private closing = false;
  private disposed = false;
  private lockHandle: LockHandle | null = null;
  private lastCommitAck: CommitAck | undefined;
  private readonly ackListeners = new Set<CommitAckListener>();
  private provider: string;
  private model: string;
  private directories: string[];
  private title: string | null | undefined;
  private preview: string | undefined;

  private constructor(
    private readonly config: JournalRecordingConfig,
    private filePath: string | null,
  ) {
    this.provider = config.provider;
    this.model = config.model;
    this.directories = [...config.workspaceDirs];
  }

  /** A recorder for a new session; its file is created on first use. */
  static create(config: JournalRecordingConfig): JournalRecordingService {
    return new JournalRecordingService(config, null);
  }

  /** `create`, holding the session lock. */
  static async createLocked(
    config: JournalRecordingConfig,
  ): Promise<JournalRecordingService> {
    const lockHandle = await SessionLockManager.acquire(
      config.chatsDir,
      config.sessionId,
    );
    const recording = JournalRecordingService.create(config);
    recording.adoptLock(lockHandle);
    return recording;
  }

  /** A recorder over an existing journal file of the same session. */
  static async open(
    config: JournalRecordingConfig,
    filePath: string,
  ): Promise<JournalRecordingService> {
    const recording = new JournalRecordingService(config, filePath);
    const session = await JournalSession.open(filePath, config.journal);
    try {
      await recording.adoptOpened(session);
    } catch (error) {
      await session.close();
      throw error;
    }
    return recording;
  }

  private async adoptOpened(session: JournalSession): Promise<void> {
    const store = session.store;
    const id = await store.getState(SESSION_KEYS.id);
    if (id === undefined || decodeSessionFact(id) !== this.config.sessionId) {
      throw new Error(
        `Session file ${store.path} does not belong to session ${this.config.sessionId}`,
      );
    }
    const provider = await store.getState(SESSION_KEYS.provider);
    if (provider !== undefined) {
      ({ provider: this.provider, model: this.model } =
        decodeProviderFact(provider));
    }
    const directories = await store.getState(SESSION_KEYS.directories);
    if (directories !== undefined) {
      this.directories = decodeDirectoriesFact(directories);
    }
    const title = await store.getState(SESSION_KEYS.title);
    if (title !== undefined) {
      this.title = decodeTitleFact(title);
    }
    const preview = await store.getState(SESSION_KEYS.preview);
    if (preview !== undefined) this.preview = decodePreviewFact(preview);
    this.journalSession = session;
    this.materialization = Promise.resolve(session);
  }

  // Lifecycle, identity and the lock.

  adoptLock(lockHandle: LockHandle): void {
    if (this.lockHandle !== null) {
      throw new Error('Session recording already owns a lock');
    }
    this.lockHandle = lockHandle;
  }

  ownsLockFor(sessionId: string): boolean {
    return (
      this.isActive() &&
      this.config.sessionId === sessionId &&
      this.lockHandle !== null
    );
  }

  getOwnedLockHandle(): LockHandle | null {
    return this.isActive() ? this.lockHandle : null;
  }

  isActive(): boolean {
    return this.failure === undefined && !this.closing && !this.disposed;
  }

  getFilePath(): string | null {
    return this.filePath;
  }

  getSessionId(): string {
    return this.config.sessionId;
  }

  getChatsDir(): string {
    return this.config.chatsDir;
  }

  getProjectHash(): string {
    return this.config.projectHash;
  }

  /** The ack of the last group this recorder wrote. */
  get lastAck(): CommitAck | undefined {
    return this.lastCommitAck;
  }

  onCommitAck(listener: CommitAckListener): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /**
   * The journal session, created if the file does not exist yet. The history
   * store takes its session here, in the same order as the recorder's own
   * writes.
   */
  session(): Promise<JournalSession> {
    return this.enqueue(() => this.ensureSession());
  }

  /** Waits for every queued write; throws the first failure once. */
  async flush(): Promise<void> {
    await this.tail;
    if (this.failure !== undefined && !this.failureReported) {
      this.failureReported = true;
      throw this.failure.error;
    }
  }

  async dispose(): Promise<void> {
    this.closing = true;
    const failures: unknown[] = [];
    try {
      await this.flush();
    } catch (error) {
      failures.push(error);
    }
    this.disposed = true;
    this.ackListeners.clear();
    try {
      await this.journalSession?.close();
    } catch (error) {
      failures.push(error);
    }
    const lockHandle = this.lockHandle;
    try {
      await lockHandle?.release();
    } catch (error) {
      failures.push(error);
    } finally {
      if (this.lockHandle === lockHandle) this.lockHandle = null;
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Failed to dispose recording service');
    }
  }

  // Session facts.

  recordProviderSwitch(provider: string, model: string): void {
    if (!this.isActive()) return;
    this.provider = provider;
    this.model = model;
    this.writeFact(SESSION_KEYS.provider, { provider, model });
  }

  recordDirectoriesChanged(directories: string[]): void {
    if (!this.isActive()) return;
    this.directories = [...directories];
    this.writeFact(SESSION_KEYS.directories, this.directories);
  }

  /**
   * Operational events (info, warning, error) have no reader in the journal,
   * and an event log in the state map would grow without bound, so they go to
   * the debug log only.
   */
  recordSessionEvent(
    severity: 'info' | 'warning' | 'error',
    message: string,
  ): void {
    if (!this.isActive()) return;
    debugLogger.log(`[SessionRecording] ${severity}: ${message}`);
  }

  /** The title is tri-state: a string, null for explicitly untitled, undefined when never set. */
  recordSessionMetadata(title: string | null): void {
    if (!this.isActive()) return;
    this.title = title;
    this.persistFact(SESSION_KEYS.title, title);
  }

  /**
   * The first user message of the session (decision G7). Written once: a
   * recorder that already holds a preview, from this process or an earlier
   * one, ignores later offers.
   */
  recordFirstUserPreview(text: string): void {
    if (!this.isActive() || this.preview !== undefined) return;
    this.preview = text;
    this.writeFact(SESSION_KEYS.preview, text);
  }

  getSessionMetadataTitle(): string | null | undefined {
    return this.title;
  }

  async setSessionName(name: string | null): Promise<void> {
    this.requireActive('set session name');
    const resolved = name === null ? null : name.trim();
    if (resolved !== null && resolved.length === 0) {
      throw new Error('Cannot set session name: name must not be empty');
    }
    await this.enqueue(() =>
      this.commitFacts([this.factEdit(SESSION_KEYS.name, resolved)]),
    );
    await this.flushAndRequireActive('set session name');
  }

  recordSessionFork(payload: SessionForkedPayload): void {
    if (!this.isActive()) {
      throw new Error('Cannot record session fork: recording is inactive');
    }
    this.persistFact(SESSION_KEYS.fork, payload);
  }

  // Checkpoints (design 4.9).

  async createCheckpoint(name: string): Promise<RecordingCheckpointInfo> {
    this.requireActive('create checkpoint');
    const trimmed = requireCheckpointName('create checkpoint', name);
    const checkpointId = crypto.randomUUID();
    // A refusal is returned out of the queue: only a failed write may poison it.
    const descriptor = await this.enqueue(async () => {
      const session = this.journalSession;
      if (session === undefined || (session.store.published?.rows ?? 0) === 0) {
        return undefined;
      }
      await this.commitFacts([
        {
          kind: 'checkpoint',
          id: checkpointId,
          name: trimmed,
          createdAtMs: Date.now(),
        },
      ]);
      return this.findCheckpoint(checkpointId);
    });
    await this.flushAndRequireActive('create checkpoint');
    if (descriptor === undefined) {
      throw new Error(
        'Cannot create checkpoint: conversation has no content yet',
      );
    }
    return { checkpointId, name: trimmed, sequence: descriptor.commitSeq };
  }

  /**
   * The library has no edit that removes a state entry or releases the
   * version a checkpoint retains, so a deletion cannot be recorded honestly.
   * CheckpointService (S10) and compaction (S11) add it together.
   */
  deleteCheckpoint(checkpointId: string): Promise<void> {
    return Promise.reject(
      new Error(
        `not implemented: S10 (delete checkpoint ${checkpointId} needs a state-entry removal edit)`,
      ),
    );
  }

  async renameCheckpoint(checkpointId: string, name: string): Promise<void> {
    this.requireActive('rename checkpoint');
    const trimmed = requireCheckpointName('rename checkpoint', name);
    const renamed = await this.enqueue(async () => {
      const descriptor = await this.findCheckpoint(checkpointId);
      if (descriptor === undefined) return false;
      await this.commitFacts([
        {
          kind: 'setState',
          key: checkpointKey(checkpointId),
          value: encodeCheckpointDescriptor({ ...descriptor, name: trimmed }),
        },
      ]);
      return true;
    });
    await this.flushAndRequireActive('rename checkpoint');
    if (!renamed) throw new Error(`Checkpoint ${checkpointId} does not exist`);
  }

  // The write queue.

  private async findCheckpoint(
    checkpointId: string,
  ): Promise<CheckpointDescriptor | undefined> {
    const bytes = await this.journalSession?.store.getState(
      checkpointKey(checkpointId),
    );
    return bytes === undefined ? undefined : parseCheckpointDescriptor(bytes);
  }

  private requireActive(operation: string): void {
    if (!this.isActive()) {
      throw new Error(`Cannot ${operation}: recording is not active`);
    }
  }

  private async flushAndRequireActive(operation: string): Promise<void> {
    await this.flush();
    if (!this.isActive()) {
      throw new Error(`Cannot ${operation}: recording failed during flush`);
    }
  }

  private factEdit(key: string, value: unknown): VersionEdit {
    return { kind: 'setState', key, value: encodeSessionFact(value) };
  }

  /** A fact that needs the file: it is written, creating the file first. */
  private persistFact(key: string, value: unknown): void {
    this.enqueue(() => this.commitFacts([this.factEdit(key, value)])).catch(
      ignore,
    );
  }

  /** A fact that rides in the start group until the file exists, then is written alone. */
  private writeFact(key: string, value: unknown): void {
    if (this.journalSession === undefined && this.materialization === undefined)
      return;
    this.persistFact(key, value);
  }

  private async commitFacts(edits: readonly VersionEdit[]): Promise<void> {
    const session = await this.ensureSession();
    const ack = await session.store.commit(edits);
    this.lastCommitAck = ack;
    for (const listener of this.ackListeners) listener(ack);
  }

  private enqueue<T>(step: () => Promise<T>): Promise<T> {
    const run = this.tail.then(() => {
      if (this.failure !== undefined) throw this.failure.error;
      if (this.disposed) {
        throw new Error('Session recording is disposed');
      }
      return step();
    });
    this.tail = run.then(ignore, (error: unknown) => {
      if (this.failure === undefined) {
        this.failure = { error };
        logDrainFailure(error, this.filePath, this.config.chatsDir);
      }
    });
    return run;
  }

  private ensureSession(): Promise<JournalSession> {
    this.materialization ??= this.createSession();
    return this.materialization;
  }

  private async createSession(): Promise<JournalSession> {
    await mkdir(this.config.chatsDir, { recursive: true });
    const filePath = path.join(
      this.config.chatsDir,
      journalSessionFileName(this.config.sessionId),
    );
    const session = await JournalSession.create(filePath, this.config.journal);
    try {
      await this.commitStart(session);
    } catch (error) {
      await session.close();
      throw error;
    }
    this.filePath = filePath;
    this.journalSession = session;
    return session;
  }

  private async commitStart(session: JournalSession): Promise<void> {
    const { provider, model } = this.config.resolveProviderModel?.() ?? {
      provider: this.provider,
      model: this.model,
    };
    this.provider = provider;
    this.model = model;
    const { config } = this;
    const edits: VersionEdit[] = [
      this.factEdit(SESSION_KEYS.id, config.sessionId),
      this.factEdit(SESSION_KEYS.start, {
        startTime: new Date().toISOString(),
        projectHash: config.projectHash,
        workspaceDirs: config.workspaceDirs,
        ...(config.cwd === undefined ? {} : { cwd: config.cwd }),
        kind: config.kind ?? 'main',
        ...(config.parentSessionId === undefined
          ? {}
          : { parentSessionId: config.parentSessionId }),
      }),
      this.factEdit(SESSION_KEYS.provider, { provider, model }),
      this.factEdit(SESSION_KEYS.directories, this.directories),
    ];
    if (this.title !== undefined) {
      edits.push(this.factEdit(SESSION_KEYS.title, this.title));
    }
    if (this.preview !== undefined) {
      edits.push(this.factEdit(SESSION_KEYS.preview, this.preview));
    }
    const ack = await session.store.commit(edits);
    this.lastCommitAck = ack;
    for (const listener of this.ackListeners) listener(ack);
  }
}
