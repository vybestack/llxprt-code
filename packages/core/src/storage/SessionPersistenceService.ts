/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { type IContent } from '../services/history/IContent.js';
import type { Storage } from '@vybestack/llxprt-code-settings';
import { DebugLogger } from '../debug/index.js';
import type { LocalMediaStore } from './local-media-store.js';
import {
  MediaAdmissionService,
  type MediaAdmissionContext,
} from './media-admission-service.js';
import {
  collectMediaReferences,
  verifyHistoryMedia,
} from './media-reference-lifecycle.js';
import {
  containsMediaDiagnostic,
  errorCode,
  persistenceRequestLowerBound,
} from './session-persistence-helpers.js';
import {
  type ToolResultDisplay,
  type ToolCallConfirmationDetails,
} from '@vybestack/llxprt-code-tools';

const logger = new DebugLogger('llxprt:session:persistence');

/**
 * Persisted tool call display information.
 * Matches CLI's IndividualToolCallDisplay interface for type compatibility.
 */
export interface PersistedToolCall {
  /** Unique identifier for the tool call */
  callId: string;
  /** Tool name */
  name: string;
  /** Human-readable description of what the tool is doing */
  description: string;
  /** Tool execution status (string to accept CLI's ToolCallStatus enum) */
  status: string;
  /** Result display for completed tools */
  resultDisplay: ToolResultDisplay | undefined;
  /** Confirmation details for tools requiring user approval */
  confirmationDetails: ToolCallConfirmationDetails | undefined;
  /** Whether to render output as markdown */
  renderOutputAsMarkdown?: boolean;
  /** Whether this tool is currently focused in UI */
  isFocused?: boolean;
}

/**
 * Minimal interface for persisted UI history items.
 * CLI's HistoryItem should satisfy this interface.
 * Uses permissive types since CLI has multiple history types with different shapes.
 */
export interface PersistedUIHistoryItem {
  /** Unique identifier for the history item */
  id: number;
  /** Type discriminator for the history item */
  type: string;
  /** Optional text content (for user/gemini/info/warning/error messages) */
  text?: string;
  /** Optional model identifier (for gemini responses) */
  model?: string;
  /** Optional agent ID (for subagent contexts) */
  agentId?: string;
  /** Optional tools array - shape varies by type (tool_group vs tools_list) */
  tools?: unknown[];
}

/**
 * Persisted session format for --continue functionality
 */
export interface PersistedSession {
  /** Schema version for future migrations */
  version: number;
  /** Monotonic save generation. Absent in legacy persisted sessions. */
  generation?: number;
  /** Unique session identifier */
  sessionId: string;
  /** Hash of project root for validation */
  projectHash: string;
  /** When session was created */
  createdAt: string;
  /** Last update timestamp */
  updatedAt: string;
  /** Full conversation history (core format) */
  history: IContent[];
  /** UI history items for display restoration (preserves exactly what user sees) */
  uiHistory?: PersistedUIHistoryItem[];
  /** Optional metadata */
  metadata?: {
    provider?: string;
    model?: string;
    tokenCount?: number;
  };
}

/**
 * Session file prefix for persistence files
 */
const PERSISTED_SESSION_PREFIX = 'persisted-session-';

export interface SessionPersistenceServiceOptions {
  readonly mediaStore?: LocalMediaStore;
  readonly maxQueueBytes?: number;
}

export interface PreparedPersistenceSave {
  publish(): Promise<void>;
  rollback(): Promise<void>;
  finalize(): Promise<void>;
}

export interface LoadedSessionMediaOwnership {
  release(): Promise<void>;
}

export interface LoadedPersistedSession extends PersistedSession {
  readonly mediaOwnership: LoadedSessionMediaOwnership;
}

interface PendingPersistenceSave {
  readonly generation: number;
  readonly history: IContent[];
  readonly metadata: PersistedSession['metadata'] | undefined;
  readonly uiHistory: PersistedUIHistoryItem[] | undefined;
  readonly updatedAt: string;
  accountedBytes: number;
  readonly resolve: () => void;
  readonly reject: (error: unknown) => void;
}

interface PreparedSaveState {
  accountedBytes: number;
  admittedHistory: readonly IContent[] | undefined;
  reservedContentIds: readonly string[];
  previousContents: Buffer | undefined;
  ownershipPending: boolean;
  published: boolean;
  settled: boolean;
  readonly admissionContext: MediaAdmissionContext;
  readonly ownerId: string;
  readonly tempPath: string;
}

type PersistenceSaveOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

/**
 * Service for persisting and restoring conversation sessions.
 * Enables the --continue flag to resume previous sessions.
 */
export class SessionPersistenceService {
  private readonly storage: Storage;
  private readonly sessionId: string;
  private readonly chatsDir: string;
  private readonly sessionFilePath: string;
  private readonly mediaStore: LocalMediaStore | undefined;
  private readonly maxQueueBytes: number;
  private pendingBytes = 0;
  private nextGeneration = 0;
  private saveInProgress = false;
  private transactionActive = false;
  private readonly transactionWaiters: Array<() => void> = [];
  private readonly saveQueue: PendingPersistenceSave[] = [];

  constructor(
    storage: Storage,
    sessionId: string,
    options: SessionPersistenceServiceOptions = {},
  ) {
    const maxQueueBytes = options.maxQueueBytes ?? Number.MAX_SAFE_INTEGER;
    if (!Number.isSafeInteger(maxQueueBytes) || maxQueueBytes < 0) {
      throw new Error(
        'Session persistence queue byte limit must be a non-negative safe integer',
      );
    }
    this.storage = storage;
    this.sessionId = sessionId;
    this.mediaStore = options.mediaStore;
    this.maxQueueBytes = maxQueueBytes;
    this.chatsDir = path.join(storage.getProjectTempDir(), 'chats');

    // Use timestamp-based filename for easy "most recent" lookup
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionFilePath = path.join(
      this.chatsDir,
      `${PERSISTED_SESSION_PREFIX}${timestamp}.json`,
    );
  }

  private preflightQueueRequest(
    history: readonly IContent[],
    metadata: PersistedSession['metadata'] | undefined,
    uiHistory: readonly PersistedUIHistoryItem[] | undefined,
  ): void {
    const lowerBound = persistenceRequestLowerBound(
      history,
      metadata,
      uiHistory,
    );
    if (lowerBound > this.maxQueueBytes - this.pendingBytes) {
      throw new Error(
        `Session persistence queue byte limit exceeded: ${this.pendingBytes} + at least ${lowerBound} > ${this.maxQueueBytes}`,
      );
    }
  }

  private async releaseAdmission(
    history: readonly IContent[],
    context: MediaAdmissionContext,
  ): Promise<void> {
    if (this.mediaStore === undefined) return;
    await new MediaAdmissionService(this.mediaStore).releaseContents(
      history,
      context,
    );
  }

  private async releaseSaveOwnership(
    admissionHistory: readonly IContent[] | undefined,
    admissionContext: MediaAdmissionContext,
    reservedContentIds: readonly string[],
    ownerId: string,
  ): Promise<void> {
    const failures: unknown[] = [];
    await this.collectCleanupFailure(failures, () =>
      this.releaseMedia(reservedContentIds, ownerId),
    );
    if (admissionHistory !== undefined) {
      await this.collectCleanupFailure(failures, () =>
        this.releaseAdmission(admissionHistory, admissionContext),
      );
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(
        failures,
        'Session media ownership release failed',
      );
    }
  }

  private async reserveMedia(
    history: readonly IContent[],
    ownerId: string,
  ): Promise<readonly string[]> {
    if (this.mediaStore === undefined) return [];
    const references = collectMediaReferences(history);
    const unique = new Map(
      references.map((reference) => [reference.contentId, reference]),
    );
    const reserved: string[] = [];
    try {
      for (const reference of unique.values()) {
        await this.mediaStore.reserve(reference, ownerId);
        reserved.push(reference.contentId);
      }
      return reserved;
    } catch (error) {
      const releaseFailures: unknown[] = [];
      for (const contentId of reserved) {
        try {
          await this.mediaStore.release(contentId, ownerId);
        } catch (releaseError) {
          releaseFailures.push(releaseError);
        }
      }
      if (releaseFailures.length > 0) {
        throw new AggregateError(
          [error, ...releaseFailures],
          'Media reservation and rollback failed',
        );
      }
      throw error;
    }
  }

  private async releaseMedia(
    contentIds: readonly string[],
    ownerId: string,
  ): Promise<void> {
    if (this.mediaStore === undefined) return;
    const failures: unknown[] = [];
    for (const contentId of contentIds) {
      try {
        await this.mediaStore.release(contentId, ownerId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'Failed to release persisted media');
    }
  }

  /**
   * Get the directory containing persisted sessions
   */
  getChatsDir(): string {
    return this.chatsDir;
  }

  /**
   * Get the current session's file path
   */
  getSessionFilePath(): string {
    return this.sessionFilePath;
  }

  /**
   * Save conversation history to disk
   */
  async save(
    history: IContent[],
    metadata?: PersistedSession['metadata'],
    uiHistory?: PersistedUIHistoryItem[],
  ): Promise<void> {
    this.preflightQueueRequest(history, metadata, uiHistory);
    const generation = ++this.nextGeneration;
    const historySnapshot = structuredClone(history);
    const metadataSnapshot = structuredClone(metadata);
    const uiHistorySnapshot = structuredClone(uiHistory);
    const updatedAt = new Date().toISOString();
    const queuedSession = this.buildSession(
      generation,
      historySnapshot,
      metadataSnapshot,
      uiHistorySnapshot,
      updatedAt,
    );
    const accountedBytes = Buffer.byteLength(
      JSON.stringify(queuedSession, null, 2),
      'utf8',
    );
    this.enforcePendingByteIncrease(accountedBytes);
    this.pendingBytes += accountedBytes;
    return new Promise<void>((resolve, reject) => {
      this.saveQueue.push({
        generation,
        history: historySnapshot,
        metadata: metadataSnapshot,
        uiHistory: uiHistorySnapshot,
        updatedAt,
        accountedBytes,
        resolve,
        reject,
      });
      this.startNextSave();
    });
  }

  private startNextSave(): void {
    if (this.saveInProgress || this.transactionActive) return;
    const pending = this.saveQueue.shift();
    if (pending === undefined) return;
    this.saveInProgress = true;
    void this.executeSave(pending).then(
      () => this.completeSave(pending, { ok: true }),
      (error: unknown) => this.completeSave(pending, { ok: false, error }),
    );
  }

  private completeSave(
    pending: PendingPersistenceSave,
    outcome: PersistenceSaveOutcome,
  ): void {
    this.pendingBytes -= pending.accountedBytes;
    this.saveInProgress = false;
    if (outcome.ok) pending.resolve();
    else pending.reject(outcome.error);
    this.startNextSave();
    this.notifyIdleWaiters();
  }

  private async restorePersistenceTarget(
    previousTargetBytes: Buffer | null,
  ): Promise<void> {
    if (previousTargetBytes === null) {
      await fs.promises.rm(this.sessionFilePath, { force: true });
      return;
    }

    const restorePath = `${this.sessionFilePath}.restore.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(restorePath, previousTargetBytes);
      await fs.promises.rename(restorePath, this.sessionFilePath);
    } catch (error: unknown) {
      try {
        await fs.promises.rm(restorePath, { force: true });
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'Session persistence restoration and temporary-file cleanup failed',
        );
      }
      throw error;
    }
  }

  private acquireTransaction(): Promise<void> {
    if (
      !this.saveInProgress &&
      !this.transactionActive &&
      this.saveQueue.length === 0
    ) {
      this.transactionActive = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.transactionWaiters.push(resolve);
    });
  }

  private notifyIdleWaiters(): void {
    if (
      this.saveInProgress ||
      this.transactionActive ||
      this.saveQueue.length > 0
    ) {
      return;
    }
    const waiter = this.transactionWaiters.shift();
    if (waiter !== undefined) {
      this.transactionActive = true;
      waiter();
    }
  }

  async prepareSave(
    history: readonly IContent[],
  ): Promise<PreparedPersistenceSave> {
    this.preflightQueueRequest(history, undefined, undefined);
    await this.acquireTransaction();
    let state: PreparedSaveState | undefined;
    try {
      const generation = ++this.nextGeneration;
      const historySnapshot = structuredClone([...history]);
      const updatedAt = new Date().toISOString();
      const accountedBytes = Buffer.byteLength(
        JSON.stringify(
          this.buildSession(
            generation,
            historySnapshot,
            undefined,
            undefined,
            updatedAt,
          ),
          null,
          2,
        ),
        'utf8',
      );
      this.enforcePendingByteIncrease(accountedBytes);
      state = {
        accountedBytes,
        admittedHistory: undefined,
        reservedContentIds: [],
        previousContents: undefined,
        ownershipPending: false,
        published: false,
        settled: false,
        admissionContext: {
          turnId: `persistence-generation-${generation}`,
          source: 'session-persistence-save',
          reservationOwnerScope: `persistence-admission:${this.sessionId}:${generation}:${crypto.randomUUID()}`,
        },
        ownerId: `persistence:${this.sessionId}:${generation}:${crypto.randomUUID()}`,
        tempPath: `${this.sessionFilePath}.${generation}.${crypto.randomUUID()}.tmp`,
      };
      this.pendingBytes += accountedBytes;
      await this.stagePreparedSave(
        state,
        historySnapshot,
        generation,
        updatedAt,
      );
      return this.preparedSaveLifecycle(state);
    } catch (error: unknown) {
      this.finishPreparedSave(state);
      throw error;
    }
  }

  private enforcePendingByteIncrease(bytes: number): void {
    if (bytes > this.maxQueueBytes - this.pendingBytes) {
      throw new Error(
        `Session persistence queue byte limit exceeded: ${this.pendingBytes} + ${bytes} > ${this.maxQueueBytes}`,
      );
    }
  }

  private async stagePreparedSave(
    state: PreparedSaveState,
    history: IContent[],
    generation: number,
    updatedAt: string,
  ): Promise<void> {
    try {
      state.admittedHistory =
        this.mediaStore === undefined
          ? history
          : await new MediaAdmissionService(this.mediaStore).admitContents(
              history,
              state.admissionContext,
            );
      state.ownershipPending = true;
      await verifyHistoryMedia(
        state.admittedHistory,
        this.mediaStore,
        'session-persistence-save',
      );
      const serialized = JSON.stringify(
        this.buildSession(
          generation,
          [...state.admittedHistory],
          undefined,
          undefined,
          updatedAt,
        ),
        null,
        2,
      );
      const serializedBytes = Buffer.byteLength(serialized, 'utf8');
      const accountingDelta = serializedBytes - state.accountedBytes;
      this.enforcePendingByteIncrease(accountingDelta);
      state.accountedBytes = serializedBytes;
      this.pendingBytes += accountingDelta;
      state.reservedContentIds = await this.reserveMedia(
        state.admittedHistory,
        state.ownerId,
      );
      state.previousContents = await this.readPersistenceTarget();
      await fs.promises.mkdir(this.chatsDir, { recursive: true });
      await fs.promises.writeFile(state.tempPath, serialized, 'utf-8');
    } catch (error: unknown) {
      const failures: unknown[] = [error];
      await this.collectCleanupFailure(failures, () =>
        fs.promises.rm(state.tempPath, { force: true }),
      );
      if (state.ownershipPending) {
        const released = await this.collectCleanupFailure(failures, () =>
          this.releasePreparedOwnership(state),
        );
        if (released) state.ownershipPending = false;
      }
      if (failures.length > 1) {
        throw new AggregateError(
          failures,
          'Session persistence staging failed',
        );
      }
      throw error;
    }
  }

  private async readPersistenceTarget(): Promise<Buffer | undefined> {
    try {
      return await fs.promises.readFile(this.sessionFilePath);
    } catch (error: unknown) {
      if (errorCode(error) === 'ENOENT') return undefined;
      throw error;
    }
  }

  private preparedSaveLifecycle(
    state: PreparedSaveState,
  ): PreparedPersistenceSave {
    return {
      publish: () => this.publishPreparedSave(state),
      rollback: () => this.rollbackPreparedSave(state),
      finalize: async () => this.finalizePreparedSave(state),
    };
  }

  private async publishPreparedSave(state: PreparedSaveState): Promise<void> {
    if (state.settled || state.published) {
      throw new Error('Persistence save was already published or settled');
    }
    await fs.promises.rename(state.tempPath, this.sessionFilePath);
    state.published = true;
    await this.releasePreparedOwnership(state);
    state.ownershipPending = false;
    state.reservedContentIds = [];
  }

  private async rollbackPreparedSave(state: PreparedSaveState): Promise<void> {
    if (state.settled) return;
    const failures: unknown[] = [];
    await this.collectCleanupFailure(failures, () =>
      state.published
        ? this.restorePersistenceTarget(state.previousContents ?? null)
        : fs.promises.rm(state.tempPath, { force: true }),
    );
    if (state.ownershipPending) {
      const released = await this.collectCleanupFailure(failures, () =>
        this.releasePreparedOwnership(state),
      );
      if (released) {
        state.ownershipPending = false;
        state.reservedContentIds = [];
      }
    }
    this.finishPreparedSave(state);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Session persistence rollback failed');
    }
  }

  private async releasePreparedOwnership(
    state: PreparedSaveState,
  ): Promise<void> {
    await this.releaseSaveOwnership(
      state.admittedHistory,
      state.admissionContext,
      state.reservedContentIds,
      state.ownerId,
    );
  }

  private finalizePreparedSave(state: PreparedSaveState): void {
    if (!state.published) {
      throw new Error('Cannot finalize an unpublished persistence save');
    }
    this.finishPreparedSave(state);
  }

  private finishPreparedSave(state: PreparedSaveState | undefined): void {
    if (state?.settled === true) return;
    if (state !== undefined) {
      state.settled = true;
      this.pendingBytes -= state.accountedBytes;
    }
    this.transactionActive = false;
    this.startNextSave();
    this.notifyIdleWaiters();
  }

  private async collectCleanupFailure(
    failures: unknown[],
    cleanup: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await cleanup();
      return true;
    } catch (error: unknown) {
      failures.push(error);
      return false;
    }
  }

  private async executeSave(pending: PendingPersistenceSave): Promise<void> {
    const admissionContext: MediaAdmissionContext = {
      turnId: `persistence-generation-${pending.generation}`,
      source: 'session-persistence-save',
      reservationOwnerScope: `persistence-admission:${this.sessionId}:${pending.generation}:${crypto.randomUUID()}`,
    };
    const ownerId = `persistence:${this.sessionId}:${pending.generation}:${crypto.randomUUID()}`;
    const tempPath = `${this.sessionFilePath}.${pending.generation}.${crypto.randomUUID()}.tmp`;
    let admittedHistory: IContent[] | undefined;
    let reservedContentIds: readonly string[] = [];
    const failures: unknown[] = [];
    try {
      admittedHistory =
        this.mediaStore === undefined
          ? pending.history
          : await new MediaAdmissionService(this.mediaStore).admitContents(
              pending.history,
              admissionContext,
            );
      await verifyHistoryMedia(
        admittedHistory,
        this.mediaStore,
        'session-persistence-save',
      );
      const session = this.buildSession(
        pending.generation,
        admittedHistory,
        pending.metadata,
        pending.uiHistory,
        pending.updatedAt,
      );
      const serialized = JSON.stringify(session, null, 2);
      const serializedBytes = Buffer.byteLength(serialized, 'utf8');
      const accountingDelta = serializedBytes - pending.accountedBytes;
      this.enforcePendingByteIncrease(accountingDelta);
      pending.accountedBytes = serializedBytes;
      this.pendingBytes += accountingDelta;
      reservedContentIds = await this.reserveMedia(admittedHistory, ownerId);
      await fs.promises.mkdir(this.chatsDir, { recursive: true });
      await fs.promises.writeFile(tempPath, serialized, 'utf-8');
      await fs.promises.rename(tempPath, this.sessionFilePath);
      logger.debug('Session saved:', {
        path: this.sessionFilePath,
        historyLength: admittedHistory.length,
        generation: pending.generation,
        metadata: pending.metadata,
      });
    } catch (error: unknown) {
      logger.error('Failed to save session:', error);
      failures.push(error);
      try {
        await fs.promises.rm(tempPath, { force: true });
      } catch (cleanupError: unknown) {
        failures.push(cleanupError);
      }
    }
    if (admittedHistory !== undefined) {
      try {
        await this.releaseSaveOwnership(
          admittedHistory,
          admissionContext,
          reservedContentIds,
          ownerId,
        );
      } catch (releaseError: unknown) {
        failures.push(releaseError);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'Session save failed');
    }
  }

  private buildSession(
    generation: number,
    history: IContent[],
    metadata: PersistedSession['metadata'] | undefined,
    uiHistory: PersistedUIHistoryItem[] | undefined,
    updatedAt: string,
  ): PersistedSession {
    return {
      version: 1,
      generation,
      sessionId: this.sessionId,
      projectHash: this.getProjectHash(),
      createdAt: this.getCreatedAt(),
      updatedAt,
      history,
      ...(uiHistory === undefined ? {} : { uiHistory }),
      ...(metadata === undefined ? {} : { metadata }),
    };
  }

  getPendingByteCount(): number {
    return this.pendingBytes;
  }

  private async loadMediaOwnership(
    session: PersistedSession,
  ): Promise<LoadedPersistedSession> {
    const admissionContext: MediaAdmissionContext = {
      turnId: 'session-persistence-load',
      source: 'session-persistence-load',
      reservationOwnerScope: `persistence-load:${this.sessionId}:${crypto.randomUUID()}`,
    };
    let admittedHistory: IContent[] | undefined;
    try {
      admittedHistory =
        this.mediaStore === undefined
          ? session.history
          : await new MediaAdmissionService(this.mediaStore).admitContents(
              session.history,
              admissionContext,
            );
      await verifyHistoryMedia(
        admittedHistory,
        this.mediaStore,
        'session-persistence-load',
      );
    } catch (error: unknown) {
      if (admittedHistory === undefined) throw error;
      try {
        await this.releaseAdmission(admittedHistory, admissionContext);
      } catch (cleanupError: unknown) {
        throw new AggregateError(
          [error, cleanupError],
          'Session load and media ownership release failed',
        );
      }
      throw error;
    }
    let released = false;
    return {
      ...session,
      history: admittedHistory,
      mediaOwnership: {
        release: async (): Promise<void> => {
          if (released) return;
          await this.releaseAdmission(admittedHistory, admissionContext);
          released = true;
        },
      },
    };
  }

  /**
   * Load the most recent session for this project
   */
  async loadMostRecent(): Promise<LoadedPersistedSession | null> {
    try {
      // Find all persisted session files (readdir throws ENOENT if dir doesn't exist)
      let files: string[];
      try {
        files = await fs.promises.readdir(this.chatsDir);
      } catch (err: unknown) {
        if (errorCode(err) === 'ENOENT') {
          logger.debug('No chats directory found');
          return null;
        }
        throw err;
      }
      const sessionFiles = files
        .filter(
          (f) => f.startsWith(PERSISTED_SESSION_PREFIX) && f.endsWith('.json'),
        )
        .sort()
        .reverse(); // Most recent first (timestamp-based naming)

      if (sessionFiles.length === 0) {
        logger.debug('No persisted sessions found');
        return null;
      }

      const mostRecentFile = sessionFiles[0];
      const filePath = path.join(this.chatsDir, mostRecentFile);

      logger.debug('Loading most recent session:', filePath);

      const content = await fs.promises.readFile(filePath, 'utf-8');
      const session = JSON.parse(content) as PersistedSession;

      // Validate project hash matches
      const currentProjectHash = this.getProjectHash();
      if (session.projectHash !== currentProjectHash) {
        logger.warn('Session project hash mismatch, skipping:', {
          expected: currentProjectHash,
          found: session.projectHash,
        });
        return null;
      }

      // Validate version
      if (session.version !== 1) {
        logger.warn('Unknown session version:', session.version);
        return null;
      }

      const loadedSession = await this.loadMediaOwnership(session);
      logger.debug('Session loaded:', {
        sessionId: loadedSession.sessionId,
        historyLength: loadedSession.history.length,
        createdAt: loadedSession.createdAt,
        updatedAt: loadedSession.updatedAt,
      });

      return loadedSession;
    } catch (error) {
      logger.error('Failed to load session:', error);
      if (containsMediaDiagnostic(error)) {
        throw error;
      }

      // If file is corrupted, back it up and return null
      if (error instanceof SyntaxError) {
        await this.backupCorruptedSession();
      }

      return null;
    }
  }

  /**
   * Get formatted timestamp for display
   */
  static formatSessionTime(session: PersistedSession): string {
    const date = new Date(session.updatedAt || session.createdAt);
    return date.toLocaleString();
  }

  /**
   * Get project hash for validation
   */
  private getProjectHash(): string {
    const projectRoot = this.storage.getProjectRoot();
    return crypto.createHash('sha256').update(projectRoot).digest('hex');
  }

  /**
   * Get or track session creation time
   */
  private createdAt: string | null = null;
  private getCreatedAt(): string {
    this.createdAt ??= new Date().toISOString();
    return this.createdAt;
  }

  /**
   * Back up corrupted session file
   */
  private async backupCorruptedSession(): Promise<void> {
    try {
      const files = await fs.promises.readdir(this.chatsDir);
      const sessionFiles = files
        .filter(
          (f) => f.startsWith(PERSISTED_SESSION_PREFIX) && f.endsWith('.json'),
        )
        .sort()
        .reverse();

      if (sessionFiles.length > 0) {
        const corruptedFile = path.join(this.chatsDir, sessionFiles[0]);
        const backupFile = `${corruptedFile}.corrupted-${Date.now()}`;
        await fs.promises.rename(corruptedFile, backupFile);
        logger.warn('Backed up corrupted session to:', backupFile);
      }
    } catch (backupError) {
      logger.error('Failed to backup corrupted session:', backupError);
    }
  }
}
