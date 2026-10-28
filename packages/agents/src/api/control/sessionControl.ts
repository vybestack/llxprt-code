import type { SessionNativeHistory } from './session-history-observation.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 *
 * SessionControl implements the public `agent.session` surface (REQ-010),
 * mapping checkpoint lifecycle, recording swap, and resume onto the real core
 * session machinery WITHOUT any deep CLI imports:
 *
 * - Checkpoints are append-only recording metadata. Forks are prepared by the
 *   canonical transition service before the active recording is replaced.
 * - Recording is backed by SessionRecordingService; setRecording(true) starts a
 *   service and seeds it with the current history so a file is materialized,
 *   then subscribes a RecordingIntegration to the client's HistoryService so
 *   EVERY subsequent turn's content is appended to the JSONL file (continuous
 *   recording, not a one-shot snapshot). setRecording(false) disposes the
 *   integration + service.
 * - resume is backed by resumeSession (CONTINUE_LATEST for 'latest'); a success
 *   feeds the reconstructed IContent history through the client restore path,
 *   adopts the returned recording service, subscribes a fresh RecordingIntegration
 *   so post-resume turns keep appending to the resumed file, and returns the
 *   restored IContent[] so callers (e.g. the Zed loadSession path) can replay it.
 */

import type { LocalMediaStore } from '@vybestack/llxprt-code-core';
import {
  CONTINUE_LATEST,
  CheckpointService,
  RecordingIntegration,
  SessionDiscovery,
  SessionRecordingService,
  SessionTransitionService,
  importSessionMediaPackage,
  resumeSession,
  type ContinueTarget,
  type LockHandle,
  type ReplayResult,
  type ResumeRequest,
  type SessionSummary,
} from '@vybestack/llxprt-code-core';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import { basename } from 'node:path';
import type { PreparedRecordingSession } from '../../session/session-new-client.js';
import type {
  AgentSessionControl,
  CheckpointInfo,
  SessionInfo,
  SessionRecordingState,
} from '../agent.js';
import type { SessionRecordingEvent } from './recordSessionEvent.js';
import { recordSessionEvent } from './recordSessionEvent.js';
import {
  createAgentSessionPersistence,
  persistSemanticMediaPurge as persistPurge,
  replayOwnerRecording,
  restartRecording,
  type AgentSessionPersistence,
} from './recordedHistoryPersistence.js';
import { exportRecordedSession } from './sessionControlExport.js';
import {
  clearOwnerHistory,
  restoreOwnerTurns,
} from './sessionControlHistoryMutation.js';
import {
  checkpointInfoFromReplay,
  currentSessionInfo,
  deleteDiscoveredSession,
  readRecordingState,
  readSessionInfo,
  resolveCheckpointTarget,
} from './sessionControlInfo.js';
import {
  SessionRecordingLifetime,
  adoptRecordingSessionId,
  captureRollbackFailure,
  cleanupPreviousSession,
  cleanupSessionResources,
  prepareSessionArtifacts,
  restoreConfigSessionId,
  rethrowSessionTransitionFailure,
  rollbackPreparedSessionArtifacts,
} from './sessionControlRollback.js';
import { warnSkippedRecordings } from './skippedRecordings.js';

const RECORDING_FORMAT = 'jsonl';

/**
 * Logger for the otherwise-silent recording-subscription gap, so lost
 * continuous recording is diagnosable. Built per call, matching the other lazy
 * logger helpers in this package: only the logging path needs an instance, and
 * a module-wide one would be shared mutable state.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
function logger(): DebugLogger {
  return new DebugLogger('llxprt:agents:session-control');
}

/**
 * Callback bundle injected by AgentImpl so SessionControl can drive the core
 * session machinery without holding a back-reference to the whole AgentImpl.
 * Mirrors the ProfilesControlDeps pattern (lazy accessors / callbacks).
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */

export interface SessionRecordingPaths {
  readonly storageRoot: string;
  readonly projectTempDir: string;
  readonly projectChatsDir: string;
  readonly projectRoot: string;
  readonly persistenceQueueBytes: number;
}
export class SessionControl implements AgentSessionControl {
  private readonly recordingLifetime: SessionRecordingLifetime;
  /**
   * Promise-chain mutex (FINDING A1) serializing the state-mutating public
   * operations (resume, setRecording enable/disable, dispose) so they never
   * interleave their multi-await recording/integration/lock swaps. Without it a
   * concurrent resume()/setRecording()/dispose() could adopt+dispose the same
   * recording service or session lock across each other's await points
   * (use-after-free / orphaned lock). runExclusive chains onto this so each op
   * runs strictly after the prior one settles; it always settles (never
   * rejects) so a failed op cannot poison the chain for the next caller.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private opChain: Promise<void> = Promise.resolve();
  private disposalPromise: Promise<void> | undefined;
  private admissionClosed = false;
  private checkpointService: CheckpointService | undefined;
  private adoptedPath: string | null = null;

  private readonly mediaStore: LocalMediaStore;
  private readonly persistence: AgentSessionPersistence;
  constructor(
    private readonly paths: SessionRecordingPaths,
    mediaStore: LocalMediaStore,
    private readonly readRecordingQueueLimit: () => number,
    private readonly directories: () => readonly string[],
    private readonly sessionIdentityOwnership: 'config' | 'facade',
    sessionId: () => string,
    private readonly nativeHistory: SessionNativeHistory,
    private readonly withSessionTransition: (
      operation: () => Promise<void>,
    ) => Promise<void>,
    private readonly closeSessionAdmission: () => void,
    private readonly prepareNewSessionClient: (
      sessionId: string,
    ) => Promise<PreparedRecordingSession>,
    private readonly getProvider: () => string,
    private readonly getModel: () => string,
    private readonly readOwnedSessionId: () => string,
    private readonly adoptOwnedSessionId: (sessionId: string) => void,
    persistence?: AgentSessionPersistence,
  ) {
    this.mediaStore = mediaStore;
    this.persistence =
      persistence ??
      createAgentSessionPersistence(
        paths.storageRoot,
        paths.projectChatsDir,
        mediaStore,
        paths.persistenceQueueBytes,
      );
    this.recordingLifetime = new SessionRecordingLifetime(
      nativeHistory,
      sessionId(),
      this,
    );
  }

  private getCheckpointService(): CheckpointService {
    return (this.checkpointService ??= new CheckpointService(this.mediaStore));
  }

  /**
   * Runs `fn` under the {@link opChain} serializer (FINDING A1) so the
   * state-mutating public operations execute strictly one-at-a-time. The chain
   * link is made to always settle (errors swallowed for the CHAIN only) so a
   * rejected operation does not break serialization for the next caller, while
   * the caller of runExclusive still receives the real result/rejection of its
   * own `fn`.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.admissionClosed)
      return Promise.reject(new Error('Session disposed'));
    const priorSettled = this.opChain;
    const run = (async () => {
      await priorSettled;
      return fn();
    })();
    this.opChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Resumes a previously recorded session via the core resumeSession flow.
   * `target:'latest'` resolves to CONTINUE_LATEST; any other target is a
   * session reference (id or, when options.prefix is set, an id-prefix that the
   * core SessionDiscovery resolves). On success the returned recording service
   * is adopted as this owner's live recording (same swap semantics as
   * setRecording) and the returned session
   * lock is retained. The resumed resources remain local while the prior
   * recording service and session lock are released and the reconstructed
   * IContent history is fed through the client restore path. Only after the new
   * integration subscribes successfully are the recording and lock committed to
   * the instance fields; every earlier failure disposes/releases the locals, so
   * neither the prior nor the resumed resources leak on any path. On failure a
   * clear typed Error is
   * thrown carrying the core error (never a not-implemented signal).
   *
   * After the resumed history is restored into the client, a fresh
   * RecordingIntegration is subscribed to the client's HistoryService so
   * post-resume turns keep appending to the resumed JSONL file (continuous
   * recording across the resume boundary). The prior integration (if any) is
   * disposed alongside the prior recording so no history-event listener leaks.
   *
   * Returns the reconstructed IContent[] history so callers that need to replay
   * the restored conversation (e.g. the Zed ACP loadSession path streaming
   * session/update notifications) can consume it directly WITHOUT a lossy
   * getHistory() Gemini Content[] round-trip. Callers that ignore the return
   * value remain source-compatible.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async resume(
    target: 'latest' | string,
    options?: {
      readonly prefix?: boolean;
      readonly startup?: boolean;
      readonly onStartupRestoreFailure?: (
        sessionId: string,
        reason: string,
      ) => void;
    },
  ): Promise<readonly IContent[]> {
    // FINDING A1: serialize through the op-chain mutex so a concurrent
    // resume/setRecording/dispose cannot interleave their multi-await
    // recording/integration/lock swaps (use-after-free / orphaned lock).
    return this.runExclusive(async () => {
      if (target === 'latest')
        return this.resumeInternal(
          target,
          options?.startup,
          options?.onStartupRestoreFailure,
        );
      await this.recordingLifetime.ensureSubscribed();
      const targets = await this.continueTargets();
      const resolved = SessionDiscovery.resolveContinueRef(target, targets);
      if ('error' in resolved) {
        throw new Error(`Failed to resume session: ${resolved.error}`);
      }
      if (resolved.target.kind === 'checkpoint') {
        await this.forkTarget(
          resolved.target,
          options?.startup,
          options?.onStartupRestoreFailure,
        );
        return this.nativeHistory.getHistory();
      }
      return this.resumeInternal(
        resolved.target.session.sessionId,
        options?.startup,
        options?.onStartupRestoreFailure,
      );
    });
  }

  /**
   * The serialized resume body (runs inside {@link runExclusive}). Ordering is
   * failure-safe (FINDINGS A2/A3):
   *
   *  1. ensureSubscribed() first re-attempts any previously-dead integration
   *     subscription (A3) so a resume that follows a null-history enable does not
   *     start from a silently-dead recording.
   *  2. resumeSession() builds the resumed recording (already seeded with the
   *     resumed history) + acquires its session lock. These are held in LOCALS,
   *     NOT committed to the instance fields yet.
   *  3. The prior integration is unsubscribed before history replacement, so
   *     replacement events are not appended to the prior recording. Its service,
   *     lock, and instance fields remain available until commit succeeds.
   *  4. The replacement runs with neither integration subscribed; the resumed
   *     items already in the resumed recording are therefore not duplicated.
   *  5. The resumed integration is subscribed and committed atomically. On any
   *     failure, prior history and subscription state are restored before the
   *     prepared recording and lock are released. Only after successful commit
   *     are the prior integration, recording, and lock disposed.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async resumeInternal(
    target: 'latest' | string,
    startup = false,
    onStartupRestoreFailure?: (sessionId: string, reason: string) => void,
  ): Promise<readonly IContent[]> {
    await this.recordingLifetime.ensureSubscribed();
    const request: ResumeRequest = {
      continueRef: target === 'latest' ? CONTINUE_LATEST : target,
      projectHash: this.persistenceProjectHash(),
      chatsDir: this.chatsDir(),
      currentProvider: this.getProvider(),
      currentModel: this.getModel(),
      workspaceDirs: this.workspaceDirs(),
      mediaStore: this.mediaStore,
      maxQueueBytes: this.readRecordingQueueLimit(),
    };
    const result = await resumeSession(request);
    if (!result.ok) {
      warnSkippedRecordings(logger(), result.skippedRecordings ?? []);
      throw new Error(`Failed to resume session: ${result.error}`);
    }
    warnSkippedRecordings(logger(), result.skippedRecordings);
    await this.commitPreparedSession(
      result.recording,
      result.lockHandle,
      result.history,
      startup,
      onStartupRestoreFailure,
    );
    return result.history;
  }

  private async commitPreparedSession(
    recording: SessionRecordingService,
    lockHandle: LockHandle,
    history: readonly IContent[],
    startup = false,
    onStartupRestoreFailure?: (sessionId: string, reason: string) => void,
  ): Promise<void> {
    const priorRecording = this.recordingLifetime.recording;
    const priorIntegration = this.recordingLifetime.integration;
    const priorLockHandle = this.recordingLifetime.currentLockHandle;
    const priorNeedsSubscribe =
      this.recordingLifetime.integrationNeedsSubscribe;
    const priorSessionId = this.recordingLifetime.recordingSessionId;
    const { priorHistory, integration } = await this.prepareRecording(
      recording,
      lockHandle,
    );
    let historyReplacementAttempted = false;
    let historyReplacementCompleted = false;
    let adoptionAttempted = false;
    let priorIntegrationUnsubscribed = false;
    try {
      if (priorIntegration !== null && !priorNeedsSubscribe) {
        priorIntegration.unsubscribeFromHistory();
        priorIntegrationUnsubscribed = true;
      }
      historyReplacementAttempted = !startup || history.length > 0;
      await this.replacePreparedHistory(history, startup);
      historyReplacementCompleted = true;
      this.publishPreparedHistory(
        history,
        integration,
        recording,
        priorSessionId,
        () => {
          adoptionAttempted = true;
        },
      );
      this.recordingLifetime.recording = recording;
      this.recordingLifetime.integration = integration;
      this.recordingLifetime.currentLockHandle = lockHandle;
      this.recordingLifetime.recordingSessionId = recording.getSessionId();
    } catch (error: unknown) {
      const failures = await rollbackPreparedSessionArtifacts({
        integration,
        recording,
        lockHandle,
      });
      await this.undoIdentity(priorSessionId, adoptionAttempted, failures);
      this.recordingLifetime.recording = priorRecording;
      this.recordingLifetime.integration = priorIntegration;
      this.recordingLifetime.integrationNeedsSubscribe = priorNeedsSubscribe;
      this.recordingLifetime.currentLockHandle = priorLockHandle;
      await this.recordingLifetime.restoreRecordingHistory(
        priorHistory,
        startup,
        historyReplacementAttempted,
        priorIntegrationUnsubscribed,
        failures,
      );
      if (
        startup &&
        historyReplacementAttempted &&
        !historyReplacementCompleted &&
        failures.length === 0
      )
        onStartupRestoreFailure?.(
          recording.getSessionId(),
          error instanceof Error ? error.message : String(error),
        );
      rethrowSessionTransitionFailure(error, failures);
    }

    this.adoptedPath = recording.getFilePath();
    await cleanupPreviousSession(
      priorIntegration,
      priorRecording,
      priorLockHandle,
    );
  }

  private prepareRecording(
    recording: SessionRecordingService,
    lockHandle: LockHandle,
  ): ReturnType<typeof prepareSessionArtifacts> {
    return prepareSessionArtifacts(
      recording,
      lockHandle,
      this.persistence.forRecording(recording.getSessionId()),
      this.nativeHistory.getHistory,
    );
  }

  private async replacePreparedHistory(
    history: readonly IContent[],
    startup: boolean,
  ): Promise<void> {
    if (startup) {
      if (history.length > 0)
        await this.nativeHistory.restoreHistory(history, this);
    } else {
      await this.nativeHistory.setHistory(history, { historyOrigin: this });
    }
  }

  private undoIdentity(
    priorSessionId: string,
    adoptionAttempted: boolean,
    failures: unknown[],
  ): Promise<void> {
    return restoreConfigSessionId(
      this.readOwnedSessionId,
      this.adoptOwnedSessionId,
      this.sessionIdentityOwnership,
      priorSessionId,
      adoptionAttempted,
      failures,
    );
  }

  private publishPreparedHistory(
    history: readonly IContent[],
    integration: RecordingIntegration,
    recording: SessionRecordingService,
    priorSessionId: string,
    adoptionStarted: () => void,
  ): void {
    integration.rememberRecordedHistory(history);
    this.recordingLifetime.integrationNeedsSubscribe =
      !this.recordingLifetime.attachHistory(integration);
    adoptRecordingSessionId(
      this.readOwnedSessionId,
      this.adoptOwnedSessionId,
      this.sessionIdentityOwnership,
      priorSessionId,
      recording,
      adoptionStarted,
    );
  }

  flushRecording = (event?: SessionRecordingEvent): Promise<void> =>
    this.runExclusive(async () => {
      await this.recordingLifetime.ensureSubscribed();
      recordSessionEvent(this.recordingLifetime.integration, event);
      await this.recordingLifetime.integration?.flushAtTurnBoundary();
    });

  recordRecordingEvent = this.flushRecording;

  async createCheckpoint(
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<CheckpointInfo> {
    return this.runExclusive(async () => {
      await this.recordingLifetime.ensureSubscribed();
      if (this.recordingLifetime.recording === null) {
        await this.startRecording();
      }
      const recording = this.recordingLifetime.requireRecording();
      await this.recordingLifetime.integration?.flushAtTurnBoundary();
      const created = await this.getCheckpointService().createCheckpoint(
        recording,
        this.persistenceProjectHash(),
        name,
        options?.overwrite === true,
      );
      const replay = await this.replayRecording(recording);
      return checkpointInfoFromReplay(
        replay,
        created.checkpointId,
        recording.getSessionId(),
      );
    });
  }

  async forkFromCheckpoint(ref: string): Promise<SessionInfo> {
    return this.runExclusive(async () => {
      await this.recordingLifetime.ensureSubscribed();
      const target = await this.resolveCheckpointTarget(ref);
      return this.forkTarget(target);
    });
  }

  async listCheckpoints(): Promise<readonly CheckpointInfo[]> {
    return this.runExclusive(async () =>
      this.getCheckpointService().listDiscoveredCheckpoints(
        await this.continueTargets(),
        this.persistenceProjectHash(),
      ),
    );
  }

  async renameCheckpoint(
    ref: string,
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<void> {
    await this.runExclusive(async () =>
      this.getCheckpointService().renameCheckpointTarget(
        await this.resolveCheckpointTarget(ref),
        this.recordingLifetime.recording,
        this.persistenceProjectHash(),
        this.chatsDir(),
        name,
        options,
      ),
    );
  }

  async deleteCheckpoint(ref: string): Promise<void> {
    await this.runExclusive(async () =>
      this.getCheckpointService().deleteCheckpointTarget(
        await this.resolveCheckpointTarget(ref),
        this.recordingLifetime.recording,
        this.persistenceProjectHash(),
        this.chatsDir(),
      ),
    );
  }

  async nameCurrentSession(
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<void> {
    await this.runExclusive(async () => {
      if (this.recordingLifetime.recording === null)
        await this.startRecording();
      const recording = this.recordingLifetime.requireRecording();
      const normalizedName = name.trim();
      const replay = await this.replayRecording(recording);
      if (replay.sessionName === normalizedName) return;
      await this.getCheckpointService().setSessionName(
        recording,
        this.persistenceProjectHash(),
        normalizedName,
        options?.overwrite === true,
      );
    });
  }

  async resumeSession(ref: string): Promise<SessionInfo> {
    return this.runExclusive(async () => {
      const targets = await this.continueTargets();
      const resolved = SessionDiscovery.resolveContinueRef(ref, targets);
      if ('error' in resolved) throw new Error(resolved.error);
      if (resolved.target.kind === 'checkpoint') {
        return this.forkTarget(resolved.target);
      }
      await this.resumeInternal(resolved.target.session.sessionId);
      return this.currentSessionInfo();
    });
  }

  async listSessions(): Promise<readonly SessionInfo[]> {
    return this.runExclusive(async () => {
      const targets = await this.continueTargets();
      return Promise.all(
        targets
          .filter((target) => target.kind === 'session')
          .map((target) => this.sessionInfoFor(target.session)),
      );
    });
  }

  listBrowserTargets = () => this.runExclusive(() => this.continueTargets());
  listBrowserTargetsDetailed = () =>
    this.runExclusive(() => this.discoverContinueTargets());
  async deleteSession(ref: string): Promise<void> {
    await this.runExclusive(async () => {
      await deleteDiscoveredSession(
        ref,
        await this.continueTargets(),
        this.recordingLifetime.recording?.getSessionId(),
        this.chatsDir(),
        this.persistenceProjectHash(),
      );
    });
  }

  async exportSession(ref: string, destination: string): Promise<void> {
    await this.runExclusive(async () =>
      exportRecordedSession(
        ref,
        destination,
        await this.discoverContinueTargets(),
        this.persistenceProjectHash(),
        this.mediaStore,
        this.recordingLifetime.recording,
        this.recordingLifetime.integration,
      ),
    );
  }

  async importSession(packageDirectory: string): Promise<SessionInfo> {
    return this.runExclusive(() =>
      importSessionMediaPackage(
        packageDirectory,
        this.chatsDir(),
        this.persistenceProjectHash(),
        this.mediaStore,
        async (imported) => {
          await this.resumeInternal(imported.sessionId);
          return this.currentSessionInfo();
        },
      ),
    );
  }

  async restoreTurns(turns: number): Promise<{
    readonly remainingHistory: readonly IContent[];
    readonly itemsRemoved: number;
  }> {
    return this.runExclusive(async () => {
      await this.recordingLifetime.ensureSubscribed();
      return restoreOwnerTurns(
        turns,
        this.nativeHistory,
        this.recordingLifetime.requireRecording(),
        this.recordingLifetime.integration,
        this,
        () => this.recordingLifetime.resubscribeIntegration(),
      );
    });
  }
  readonly readHistorySnapshot: AgentSessionControl['readHistorySnapshot'] =
    () => this.nativeHistory.readHistorySnapshot();

  readonly isHistoryInitialized = (): boolean =>
    this.nativeHistory.hasChatInitialized();

  readonly readInitializedHistory = (): readonly IContent[] | null =>
    this.nativeHistory.readInitializedHistory();

  readonly replaceHistory = (history: readonly IContent[]): Promise<void> =>
    this.runExclusive(() =>
      this.nativeHistory.replaceNativeHistory(history, this, () =>
        this.recordingLifetime.ensureSubscribed(),
      ),
    );

  private readonly historyObservers = new Set<() => void>();

  readonly subscribeHistoryTokens = (
    publish: (count: number) => void,
  ): (() => void) => {
    if (this.admissionClosed) throw new Error('Session disposed');
    return this.nativeHistory.subscribeHistoryTokens(
      this.historyObservers,
      publish,
    );
  };

  readonly attachRecordingHistory = (recording: RecordingIntegration): void =>
    this.nativeHistory.attachRecordingHistory(recording);

  readonly connectRecordingHistory = (
    readRecording: () => RecordingIntegration | null,
  ): (() => void) => {
    if (this.admissionClosed) throw new Error('Session disposed');
    return this.nativeHistory.connectRecordingHistory(
      this.historyObservers,
      readRecording,
    );
  };

  getHistory = (): Promise<readonly IContent[]> =>
    this.runExclusive(() => this.nativeHistory.getHistory());

  getSessionId = (): string => this.recordingLifetime.recordingSessionId;

  startNewSession = (): Promise<void> =>
    this.withSessionTransition(() =>
      this.runExclusive(() => this.startNewSessionTransition()),
    );
  private async startNewSessionTransition(): Promise<void> {
    const ownsConfig = this.sessionIdentityOwnership === 'config';
    if (ownsConfig && this.readOwnedSessionId() !== this.getSessionId()) {
      throw new Error('Cannot replace a session owned by another facade');
    }
    const nextSessionId = crypto.randomUUID();
    const candidate = await this.prepareNewSessionClient(nextSessionId);
    let recording: SessionRecordingService | null = null;
    let integration: RecordingIntegration | null = null;
    let retirementStarted = false;
    try {
      if (this.getRecording().enabled) {
        recording = await SessionRecordingService.createLocked({
          sessionId: nextSessionId,
          projectHash: basename(this.paths.projectTempDir),
          chatsDir: this.paths.projectChatsDir,
          workspaceDirs: [...this.directories()],
          cwd: this.paths.projectRoot,
          provider: this.getProvider(),
          model: this.getModel(),
          mediaStore: this.mediaStore,
          maxQueueBytes: this.readRecordingQueueLimit(),
        });
        integration = new RecordingIntegration(
          recording,
          this.persistence.forRecording(nextSessionId),
        );
        candidate.attachRecording(integration, this);
      }
      retirementStarted = true;
      await this.recordingLifetime.teardownActiveSession();
      await candidate.retire();
      candidate.publish();
      if (ownsConfig) this.adoptOwnedSessionId(nextSessionId);
      this.recordingLifetime.recordingSessionId = nextSessionId;
      this.adoptedPath = null;
      this.recordingLifetime.recording = recording;
      this.recordingLifetime.integration = integration;
    } catch (error) {
      if (retirementStarted) {
        this.closeAdmission();
        this.closeSessionAdmission();
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

  async clearHistory(): Promise<void> {
    await this.runExclusive(() =>
      clearOwnerHistory(
        this.nativeHistory,
        this.recordingLifetime.requireRecording(),
        this.recordingLifetime.integration,
        this,
        this.mediaStore,
        () => this.recordingLifetime.resubscribeIntegration(),
      ),
    );
  }

  /**
   * Enables or disables session recording. Enabling starts a fresh
   * SessionRecordingService for this session and seeds it with the current
   * history so the JSONL file is materialized (and getRecording().path is
   * defined). Disabling flushes + disposes the live service and clears it.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async setRecording(state: SessionRecordingState): Promise<void> {
    // FINDING A1: serialize enable/disable through the op-chain mutex so they
    // never interleave with a concurrent resume()/dispose() (crossed
    // recording/lock state).
    await this.runExclusive(async () => {
      if (state.enabled) {
        await this.startRecording();
        return;
      }
      await this.recordingLifetime.teardownActiveSession();
    });
  }

  /**
   * Returns the current recording state. enabled reflects the live service's
   * isActive(); path reflects its materialized file (only included when
   * defined); format is the fixed JSONL recording format.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  getRecording(): SessionRecordingState {
    return readRecordingState(
      this.recordingLifetime.recording,
      RECORDING_FORMAT,
    );
  }

  getRecordingTitle(): string | null | undefined {
    return this.recordingLifetime.recording?.getSessionMetadataTitle();
  }

  async recordRecordingTitle(title: string | null): Promise<void> {
    await this.runExclusive(async () => {
      if (this.recordingLifetime.recording?.isActive() !== true) return;
      this.recordingLifetime.recording.recordSessionMetadata(title);
      await this.recordingLifetime.recording.flush();
    });
  }

  private async replayRecording(
    recording: SessionRecordingService,
  ): Promise<Extract<ReplayResult, { ok: true }>> {
    return replayOwnerRecording(
      recording.getFilePath(),
      this.persistenceProjectHash(),
      this.mediaStore,
    );
  }

  /** Readable continue targets; skipped recordings go to the module logger. */
  private continueTargets = async (): Promise<ContinueTarget[]> =>
    (await this.discoverContinueTargets()).targets;

  /** Targets plus the unreadable recordings discovery skipped. */
  private async discoverContinueTargets() {
    const listing = await SessionDiscovery.listContinueTargetsDetailed(
      this.chatsDir(),
      this.persistenceProjectHash(),
      this.mediaStore,
    );
    warnSkippedRecordings(logger(), listing.unreadableRecordings);
    return listing;
  }

  private async resolveCheckpointTarget(
    ref: string,
  ): Promise<Extract<ContinueTarget, { kind: 'checkpoint' }>> {
    return resolveCheckpointTarget(ref, await this.continueTargets());
  }

  private async forkTarget(
    target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
    startup = false,
    onStartupRestoreFailure?: (sessionId: string, reason: string) => void,
  ): Promise<SessionInfo> {
    if (
      this.recordingLifetime.recording?.getSessionId() ===
      target.source.sessionId
    ) {
      await this.recordingLifetime.recording.flush();
    }
    const activeSource =
      this.recordingLifetime.recording?.getSessionId() ===
      target.source.sessionId
        ? this.recordingLifetime.recording
        : undefined;
    const result = await new SessionTransitionService({
      mediaStore: this.mediaStore,
      maxQueueBytes: this.readRecordingQueueLimit(),
    }).forkFromCheckpoint(
      target,
      this.chatsDir(),
      this.persistenceProjectHash(),
      this.getProvider(),
      this.getModel(),
      this.workspaceDirs(),
      activeSource,
    );
    if (!result.ok) throw new Error(result.error);
    await this.commitPreparedSession(
      result.recording,
      result.lockHandle,
      result.history,
      startup,
      onStartupRestoreFailure,
    );
    return this.currentSessionInfo();
  }

  private async currentSessionInfo(): Promise<SessionInfo> {
    return currentSessionInfo(
      this.recordingLifetime.requireRecording(),
      await this.continueTargets(),
      this.persistenceProjectHash(),
      this.mediaStore,
    );
  }

  private sessionInfoFor = (summary: SessionSummary): Promise<SessionInfo> =>
    readSessionInfo(summary, this.persistenceProjectHash(), this.mediaStore);

  // ─── Recording helpers ───────────────────────────────────────────────────

  /**
   * Starts a fresh recording service for this session, replacing any prior one
   * (the prior service + integration are flushed + disposed first). The current
   * history is recorded as content events so the file materializes and
   * getRecording().path is defined. The freshly built service belongs to this
   * session owner. A RecordingIntegration is subscribed to the client's
   * HistoryService so EVERY subsequent turn's 'contentAdded' event is appended
   * to the JSONL file — this is what makes recording continuous rather than a
   * one-shot snapshot.
   *
   * HistoryService availability: the agents-package client eagerly creates +
   * stores a HistoryService at construction (storeHistoryServiceForReuse) and
   * reuses that SAME instance across turns (createChatSessionSafe reuses the
   * stored service), so getHistoryService() is non-null here and the single
   * subscription established now captures all future turns. If it is
   * nonetheless null at this moment (no client/chat), the integration is still
   * created and this owner retains the service; the subscription is deferred
   * (integrationNeedsSubscribe) and the next startRecording/resume re-attempts
   * it via {@link ensureSubscribed} (FINDING A3).
   *
   * Called only from within {@link runExclusive} (via setRecording), so it is
   * already serialized against resume/dispose.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async startRecording(): Promise<void> {
    // FINDING A3: re-attach any previously-dead integration before replacing it,
    // so a pending-subscribe flag from an earlier null-history enable does not
    // survive across the fresh service swap.
    await this.recordingLifetime.ensureSubscribed();
    await this.recordingLifetime.teardownActiveSession();
    const service = await SessionRecordingService.createLocked({
      sessionId: this.recordingLifetime.recordingSessionId,
      projectHash: this.persistenceProjectHash(),
      chatsDir: this.chatsDir(),
      workspaceDirs: this.workspaceDirs(),
      cwd: this.paths.projectRoot,
      provider: this.getProvider(),
      model: this.getModel(),
      resolveProviderModel: () => ({
        provider: this.getProvider(),
        model: this.getModel(),
      }),
      mediaStore: this.mediaStore,
      maxQueueBytes: this.readRecordingQueueLimit(),
    });
    let integration: RecordingIntegration | null = null;
    try {
      const history = await this.nativeHistory.getHistory();
      await restartRecording(service, this.adoptedPath, this.mediaStore);
      this.nativeHistory.seedRecording(service, history, this);
      await service.flush();
      integration = new RecordingIntegration(
        service,
        this.persistence.forRecording(service.getSessionId()),
      );
      // The seed was just written to the journal. History held outside the
      // HistoryService (set before the chat starts) reaches the service later,
      // when the chat starts; the integration must treat it as recorded then.
      integration.rememberRecordedHistory(history);
      const subscribed = this.recordingLifetime.attachHistory(integration);
      this.recordingLifetime.recording = service;
      this.recordingLifetime.integration = integration;
      this.recordingLifetime.integrationNeedsSubscribe = !subscribed;
    } catch (error: unknown) {
      const cleanupFailures = await cleanupSessionResources(
        integration,
        service,
        null,
      );
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'Recording startup and cleanup failed',
        );
      }
      throw error;
    }
  }

  async persistSemanticMediaPurge(
    history: readonly IContent[],
    frontier: SemanticMediaPurgeFrontier,
  ): Promise<void> {
    return persistPurge(
      this.recordingLifetime.requireRecording(),
      history,
      frontier,
    );
  }

  // ─── Surface teardown ──────────────────────────────────────────────────────

  /**
   * Disposes the active recording service (if any) and releases the held
   * session lock (if any) on agent teardown. Each step is guarded so a single
   * failure does not skip the others; the first collected failure is rethrown
   * after all steps run.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  closeAdmission(): void {
    this.admissionClosed = true;
    for (const stop of this.historyObservers) stop();
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    // FINDING A1: serialize teardown through the op-chain mutex so dispose never
    // races a concurrent resume()/setRecording() adopting resources it is
    // releasing (double-dispose / released-then-adopted lock).
    return (this.disposalPromise ??= this.opChain
      .then(() => this.recordingLifetime.teardownActiveSession())
      .finally(() => this.persistence.close()));
  }

  private persistenceProjectHash(): string {
    return basename(this.paths.projectTempDir);
  }

  // ─── Path derivation ─────────────────────────────────────────────────────

  /**
   * The chats directory (where session recordings live), delegated to
   * Storage.getProjectChatsDir() — the single source of truth every
   * reader/prober shares, so the recording writer and the probes can never
   * drift apart on the location.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private chatsDir(): string {
    return this.paths.projectChatsDir;
  }

  /**
   * Returns the workspace directories from the live workspace context.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private workspaceDirs(): string[] {
    return [...this.directories()];
  }
}
