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

import { basename } from 'node:path';
import {
  CheckpointService,
  HistoryMutationService,
  RecordingIntegration,
  SessionDiscovery,
  SessionRecordingService,
  SessionTransitionService,
  deleteSession as deleteRecordedSession,
  importSessionMediaPackage,
  replaySession,
  resumeSession,
  CONTINUE_LATEST,
  type ContinueTarget,
  type ReplayResult,
  type ResumeRequest,
  type SessionSummary,
  type LockHandle,
} from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SemanticMediaPurgeFrontier } from '@vybestack/llxprt-code-core/services/history/semantic-media-purge.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { AgentSessionPersistence } from './recordedHistoryPersistence.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  adoptRecordingSessionId,
  captureRollbackFailure,
  cleanupPreviousSession,
  cleanupSessionResources,
  prepareSessionArtifacts,
  restoreConfigSessionId,
  rethrowSessionTransitionFailure,
  rollbackPreparedSessionArtifacts,
} from './sessionControlRollback.js';
import { exportRecordedSession } from './sessionControlExport.js';
import { sessionInfoFromReplay } from './sessionControlInfo.js';
import { recordSessionEvent } from './recordSessionEvent.js';
import type { SessionRecordingEvent } from './recordSessionEvent.js';
import {
  persistSemanticMediaPurge as persistPurge,
  restartRecording,
  replayOwnerRecording,
  seedOwnerRecording,
} from './recordedHistoryPersistence.js';
import {
  commitRecordedHistoryMutation,
  preflightClearHistory,
  restoreOwnerTurns,
} from './sessionControlHistoryMutation.js';
import { warnSkippedRecordings } from './skippedRecordings.js';
import type {
  AgentSessionControl,
  CheckpointInfo,
  SessionInfo,
  SessionRecordingState,
} from '../agent.js';

const RECORDING_FORMAT = 'jsonl';

/**
 * Module logger mirroring the neighboring toolControl.ts precedent
 * (a module-scoped core DebugLogger). Used to surface an otherwise-silent
 * recording-subscription gap so lost continuous recording is diagnosable.
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
const logger = new DebugLogger('llxprt:agents:session-control');

/**
 * Callback bundle injected by AgentImpl so SessionControl can drive the core
 * session machinery without holding a back-reference to the whole AgentImpl.
 * Mirrors the ProfilesControlDeps pattern (lazy accessors / callbacks).
 * @plan:PLAN-20260617-COREAPI.P20
 * @requirement:REQ-010
 */
export interface SessionControlDeps {
  readonly readRecordingQueueLimit: () => number;
  /** The live Config (storage, project root, workspace context). */
  readonly config: Config;
  readonly directories: () => readonly string[];
  readonly mediaStore: LocalMediaStore;
  readonly persistence: AgentSessionPersistence;
  readonly sessionIdentityOwnership: 'config' | 'facade';
  /** The per-agent session id (AgentImpl uses deps.runtimeId). */
  readonly sessionId: () => string;
  /** Resolves the live AgentClient (the same contract restoreHistory uses). */
  readonly resolveClient: () => AgentClientContract;
  /** The per-agent active provider name. */
  readonly getProvider: () => string;
  /** The per-agent active model name. */
  readonly getModel: () => string;
}

export class SessionControl implements AgentSessionControl {
  private recordingSessionId: string;
  /**
   * The live recording service when recording is enabled, or null when it is
   * disabled. getRecording reflects this directly.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private recording: SessionRecordingService | null = null;

  /**
   * The live RecordingIntegration bridging the client's HistoryService
   * 'contentAdded'/compression events onto the active recording service, or
   * null when recording is disabled. This is what makes recording CONTINUOUS
   * (every subsequent turn is appended) rather than a one-shot snapshot. It is
   * created + subscribed by startRecording/resume and disposed (unsubscribed)
   * by releaseRecording so no history-event listener leaks past a stop/resume/
   * dispose.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private integration: RecordingIntegration | null = null;

  /**
   * The on-disk session lock acquired by a successful resume, or null when no
   * resume holds a lock. Released (and cleared) when a new resume replaces it,
   * when recording is stopped, or when the surface is disposed.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private currentLockHandle: LockHandle | null = null;

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

  /**
   * True when {@link integration} is committed as the live integration but its
   * subscription to the client HistoryService could not be established yet (the
   * HistoryService was unavailable at attach time), so continuous recording is
   * currently dead (FINDING A3). The next state-mutating operation re-attempts
   * the subscription via {@link ensureSubscribed}; cleared once subscribed or
   * when the integration is disposed.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private integrationNeedsSubscribe = false;
  private checkpointService: CheckpointService | undefined;
  private adoptedPath: string | null = null;

  constructor(private readonly deps: SessionControlDeps) {
    this.recordingSessionId = deps.sessionId();
  }

  private getCheckpointService(): CheckpointService {
    this.checkpointService ??= new CheckpointService(this.deps.mediaStore);
    return this.checkpointService;
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
    _options?: { readonly prefix?: boolean },
  ): Promise<readonly IContent[]> {
    // FINDING A1: serialize through the op-chain mutex so a concurrent
    // resume/setRecording/dispose cannot interleave their multi-await
    // recording/integration/lock swaps (use-after-free / orphaned lock).
    return this.runExclusive(async () => {
      if (target === 'latest') return this.resumeInternal(target);
      await this.ensureSubscribed();
      const targets = await this.continueTargets();
      const resolved = SessionDiscovery.resolveContinueRef(target, targets);
      if ('error' in resolved) {
        throw new Error(`Failed to resume session: ${resolved.error}`);
      }
      if (resolved.target.kind === 'checkpoint') {
        await this.forkTarget(resolved.target);
        return this.deps.resolveClient().getHistory();
      }
      return this.resumeInternal(resolved.target.session.sessionId);
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
  ): Promise<readonly IContent[]> {
    await this.ensureSubscribed();
    const request: ResumeRequest = {
      continueRef: target === 'latest' ? CONTINUE_LATEST : target,
      projectHash: this.persistenceProjectHash(),
      chatsDir: this.chatsDir(),
      currentProvider: this.deps.getProvider(),
      currentModel: this.deps.getModel(),
      workspaceDirs: this.workspaceDirs(),
      mediaStore: this.deps.mediaStore,
      maxQueueBytes: this.deps.readRecordingQueueLimit(),
    };
    const result = await resumeSession(request);
    if (!result.ok) {
      warnSkippedRecordings(logger, result.skippedRecordings ?? []);
      throw new Error(`Failed to resume session: ${result.error}`);
    }
    warnSkippedRecordings(logger, result.skippedRecordings);
    await this.commitPreparedSession(
      result.recording,
      result.lockHandle,
      result.history,
    );
    return result.history;
  }

  private async commitPreparedSession(
    recording: SessionRecordingService,
    lockHandle: LockHandle,
    history: readonly IContent[],
  ): Promise<void> {
    const priorRecording = this.recording;
    const priorIntegration = this.integration;
    const priorLockHandle = this.currentLockHandle;
    const priorNeedsSubscribe = this.integrationNeedsSubscribe;
    const priorSessionId = this.recordingSessionId;
    const { client, priorHistory, integration } = await prepareSessionArtifacts(
      recording,
      lockHandle,
      this.deps.persistence.forRecording(recording.getSessionId()),
      this.deps.resolveClient,
    );
    let historyReplacementAttempted = false;
    let adoptionAttempted = false;
    let priorIntegrationUnsubscribed = false;
    try {
      if (priorIntegration !== null && !priorNeedsSubscribe) {
        priorIntegration.unsubscribeFromHistory();
        priorIntegrationUnsubscribed = true;
      }
      historyReplacementAttempted = true;
      await client.setHistory(history, { historyOrigin: this });
      integration.rememberRecordedHistory(history);
      this.integrationNeedsSubscribe = !this.attachHistory(integration);
      adoptRecordingSessionId(
        this.deps.config,
        this.deps.sessionIdentityOwnership,
        priorSessionId,
        recording,
        () => {
          adoptionAttempted = true;
        },
      );
      this.recording = recording;
      this.integration = integration;
      this.currentLockHandle = lockHandle;
      this.recordingSessionId = recording.getSessionId();
    } catch (error: unknown) {
      const rollbackFailures = await rollbackPreparedSessionArtifacts({
        integration,
        recording,
        lockHandle,
      });
      await restoreConfigSessionId(
        this.deps.config,
        this.deps.sessionIdentityOwnership,
        priorSessionId,
        adoptionAttempted,
        rollbackFailures,
      );
      this.recording = priorRecording;
      this.integration = priorIntegration;
      this.integrationNeedsSubscribe = priorNeedsSubscribe;
      this.currentLockHandle = priorLockHandle;
      if (historyReplacementAttempted) {
        await captureRollbackFailure(rollbackFailures, () =>
          client.setHistory(priorHistory),
        );
      }
      if (priorIntegrationUnsubscribed && priorIntegration !== null) {
        this.integrationNeedsSubscribe = true;
        await captureRollbackFailure(rollbackFailures, () => {
          this.integrationNeedsSubscribe =
            !this.attachHistory(priorIntegration);
        });
      }
      rethrowSessionTransitionFailure(error, rollbackFailures);
    }

    this.adoptedPath = recording.getFilePath();
    await cleanupPreviousSession(
      priorIntegration,
      priorRecording,
      priorLockHandle,
    );
  }

  /**
   * Re-attempts a previously-deferred integration subscription (FINDING A3).
   * When a prior startRecording/resume committed an integration but could not
   * subscribe it (the client HistoryService was unavailable at attach time,
   * leaving continuous recording dead), the next state-mutating operation calls
   * this at its start (inside {@link runExclusive}) to re-attach it now that the
   * HistoryService may exist. No-op when nothing is pending or the service is
   * still unavailable (the flag is kept for a later attempt). A subscribe throw
   * is self-healing: the dead integration is disposed + cleared and the flag
   * reset so the operation can proceed to build a fresh subscription rather than
   * failing permanently on a poisoned listener.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async ensureSubscribed(): Promise<void> {
    if (!this.integrationNeedsSubscribe) {
      return;
    }
    const integration = this.integration;
    if (integration === null) {
      this.integrationNeedsSubscribe = false;
      return;
    }
    const historyService = this.deps.resolveClient().getHistoryService();
    if (historyService === null) {
      return;
    }
    try {
      integration.subscribeToHistory(historyService, this);
      this.integrationNeedsSubscribe = false;
    } catch (error) {
      const deadRecording = this.recording;
      const deadLockHandle = this.currentLockHandle;
      this.recording = null;
      this.integration = null;
      this.integrationNeedsSubscribe = false;
      this.currentLockHandle = null;
      const cleanupFailures = await cleanupSessionResources(
        integration,
        deadRecording,
        deadLockHandle,
      );
      logger.warn(
        () =>
          `ensureSubscribed: re-attach failed for session ${this.deps.sessionId()}; ` +
          `dropped the dead integration so the operation can rebuild it: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'Session re-subscription and cleanup failed',
        );
      }
      throw error;
    }
  }

  flushRecording = (event?: SessionRecordingEvent): Promise<void> =>
    this.runExclusive(async () => {
      await this.ensureSubscribed();
      recordSessionEvent(this.integration, event);
      await this.integration?.flushAtTurnBoundary();
    });

  recordRecordingEvent = this.flushRecording;

  async createCheckpoint(
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<CheckpointInfo> {
    return this.runExclusive(async () => {
      await this.ensureSubscribed();
      if (this.recording === null) {
        await this.startRecording();
      }
      const recording = this.requireRecording();
      await this.integration?.flushAtTurnBoundary();
      const created = await this.getCheckpointService().createCheckpoint(
        recording,
        this.persistenceProjectHash(),
        name,
        options?.overwrite === true,
      );
      const replay = await this.replayRecording(recording);
      const checkpoint = replay.checkpoints?.find(
        (candidate) => candidate.checkpointId === created.checkpointId,
      );
      if (checkpoint === undefined) {
        throw new Error('Created checkpoint was not durable');
      }
      return {
        checkpointId: checkpoint.checkpointId,
        name: checkpoint.name,
        sessionId: recording.getSessionId(),
        sequence: checkpoint.sequence,
        createdAt: checkpoint.createdAt,
      };
    });
  }

  async forkFromCheckpoint(ref: string): Promise<SessionInfo> {
    return this.runExclusive(async () => {
      await this.ensureSubscribed();
      const target = await this.resolveCheckpointTarget(ref);
      return this.forkTarget(target);
    });
  }

  async listCheckpoints(): Promise<readonly CheckpointInfo[]> {
    return this.runExclusive(async () => {
      const targets = await this.continueTargets();
      const checkpoints: CheckpointInfo[] = [];
      const replayByFilePath = new Map<string, ReplayResult>();
      for (const target of targets) {
        if (target.kind !== 'checkpoint') continue;
        let replay = replayByFilePath.get(target.source.filePath);
        if (replay === undefined) {
          replay = await replaySession(
            target.source.filePath,
            this.persistenceProjectHash(),
            { mediaStore: this.deps.mediaStore },
          );
          replayByFilePath.set(target.source.filePath, replay);
        }
        const checkpoint = replay.ok
          ? replay.checkpoints?.find(
              (candidate) => candidate.checkpointId === target.checkpointId,
            )
          : undefined;
        if (checkpoint !== undefined && !checkpoint.deleted) {
          checkpoints.push({
            checkpointId: checkpoint.checkpointId,
            name: checkpoint.name,
            sessionId: target.source.sessionId,
            sequence: checkpoint.sequence,
            createdAt: checkpoint.createdAt,
          });
        }
      }
      return checkpoints;
    });
  }

  async renameCheckpoint(
    ref: string,
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<void> {
    await this.runExclusive(async () => {
      const target = await this.resolveCheckpointTarget(ref);
      const trimmedName = name.trim();
      if (target.checkpointName === trimmedName) return;
      if (this.recording?.getSessionId() === target.source.sessionId) {
        await this.getCheckpointService().renameCheckpoint(
          this.recording,
          this.persistenceProjectHash(),
          target.checkpointId,
          trimmedName,
          options?.overwrite === true,
        );
        return;
      }
      const validatedName =
        options?.overwrite === true
          ? trimmedName
          : await SessionDiscovery.validateAvailableName(
              trimmedName,
              this.chatsDir(),
              this.persistenceProjectHash(),
            );
      await this.getCheckpointService().renameCheckpointClosed(
        target.source.filePath,
        this.persistenceProjectHash(),
        this.chatsDir(),
        target.source.sessionId,
        target.checkpointId,
        validatedName,
        options?.overwrite === true,
      );
    });
  }

  async deleteCheckpoint(ref: string): Promise<void> {
    await this.runExclusive(async () => {
      const target = await this.resolveCheckpointTarget(ref);
      if (this.recording?.getSessionId() === target.source.sessionId) {
        await this.getCheckpointService().deleteCheckpoint(
          this.recording,
          this.persistenceProjectHash(),
          target.checkpointId,
        );
        return;
      }
      await this.getCheckpointService().deleteCheckpointClosed(
        target.source.filePath,
        this.persistenceProjectHash(),
        this.chatsDir(),
        target.source.sessionId,
        target.checkpointId,
      );
    });
  }

  async nameCurrentSession(
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<void> {
    await this.runExclusive(async () => {
      if (this.recording === null) await this.startRecording();
      const recording = this.requireRecording();
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
      const chatsDir = this.chatsDir();
      const projectHash = this.persistenceProjectHash();
      const targets = await this.continueTargets();
      const resolved = SessionDiscovery.resolveContinueRef(ref, targets);
      if ('error' in resolved) throw new Error(resolved.error);
      if (resolved.target.kind !== 'session') {
        throw new Error(`Continue target '${ref}' is not a session`);
      }
      if (
        this.recording?.getSessionId() === resolved.target.session.sessionId
      ) {
        throw new Error('Cannot delete the active session');
      }
      const result = await deleteRecordedSession(
        resolved.target.session.sessionId,
        chatsDir,
        projectHash,
      );

      if (!result.ok) throw new Error(result.error);
    });
  }

  async exportSession(ref: string, destination: string): Promise<void> {
    await this.runExclusive(async () =>
      exportRecordedSession(
        ref,
        destination,
        await this.discoverContinueTargets(),
        this.persistenceProjectHash(),
        this.deps.mediaStore,
        this.recording,
        this.integration,
      ),
    );
  }

  async importSession(packageDirectory: string): Promise<SessionInfo> {
    return this.runExclusive(() =>
      importSessionMediaPackage(
        packageDirectory,
        this.chatsDir(),
        this.persistenceProjectHash(),
        this.deps.mediaStore,
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
      await this.ensureSubscribed();
      return restoreOwnerTurns(
        turns,
        this.deps.resolveClient(),
        this.requireRecording(),
        this.integration,
        this,
        () => this.resubscribeIntegration(),
      );
    });
  }
  getHistory = (): Promise<readonly IContent[]> =>
    this.runExclusive(() => this.deps.resolveClient().getHistory());

  async clearHistory(): Promise<void> {
    await this.runExclusive(async () => {
      const client = this.deps.resolveClient();
      const history = await client.getHistory();
      const recording = this.requireRecording();
      const result = await new HistoryMutationService().clear(
        history,
        recording,
        (remainingHistory) =>
          preflightClearHistory(remainingHistory, this.deps.mediaStore),
      );
      if (!result.ok) throw new Error(result.error);
      await commitRecordedHistoryMutation({
        result,
        history,
        client,
        recording,
        integration: this.integration,
        owner: this,
        resubscribe: () => this.resubscribeIntegration(),
      });
    });
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
      await this.teardownActiveSession();
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
    const path = this.recording?.getFilePath() ?? null;
    return {
      enabled: this.recording?.isActive() ?? false,
      format: RECORDING_FORMAT,
      ...(path !== null ? { path } : {}),
    };
  }

  getRecordingTitle(): string | null | undefined {
    return this.recording?.getSessionMetadataTitle();
  }

  async recordRecordingTitle(title: string | null): Promise<void> {
    await this.runExclusive(async () => {
      if (this.recording?.isActive() !== true) return;
      this.recording.recordSessionMetadata(title);
      await this.recording.flush();
    });
  }

  private requireRecording(): SessionRecordingService {
    if (this.recording?.isActive() !== true) {
      throw new Error('No active recording');
    }
    return this.recording;
  }

  private async replayRecording(
    recording: SessionRecordingService,
  ): Promise<Extract<ReplayResult, { ok: true }>> {
    return replayOwnerRecording(
      recording.getFilePath(),
      this.persistenceProjectHash(),
      this.deps.mediaStore,
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
      this.deps.mediaStore,
    );
    warnSkippedRecordings(logger, listing.unreadableRecordings);
    return listing;
  }

  private async resolveCheckpointTarget(
    ref: string,
  ): Promise<Extract<ContinueTarget, { kind: 'checkpoint' }>> {
    const targets = await this.continueTargets();
    const exact = targets.filter(
      (target): target is Extract<ContinueTarget, { kind: 'checkpoint' }> =>
        target.kind === 'checkpoint' &&
        (target.checkpointId === ref || target.checkpointName === ref),
    );
    if (exact.length === 1) return exact[0];
    if (exact.length > 1)
      throw new Error(`Ambiguous checkpoint reference '${ref}'`);
    throw new Error(`Checkpoint '${ref}' not found`);
  }

  private async forkTarget(
    target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
  ): Promise<SessionInfo> {
    if (this.recording?.getSessionId() === target.source.sessionId) {
      await this.recording.flush();
    }
    const activeSource =
      this.recording?.getSessionId() === target.source.sessionId
        ? this.recording
        : undefined;
    const result = await new SessionTransitionService({
      mediaStore: this.deps.mediaStore,
      maxQueueBytes: this.deps.readRecordingQueueLimit(),
    }).forkFromCheckpoint(
      target,
      this.chatsDir(),
      this.persistenceProjectHash(),
      this.deps.getProvider(),
      this.deps.getModel(),
      this.workspaceDirs(),
      activeSource,
    );
    if (!result.ok) throw new Error(result.error);
    await this.commitPreparedSession(
      result.recording,
      result.lockHandle,
      result.history,
    );
    return this.currentSessionInfo();
  }

  private async currentSessionInfo(): Promise<SessionInfo> {
    const recording = this.requireRecording();
    const targets = await this.continueTargets();
    const target = targets.find(
      (candidate) =>
        candidate.kind === 'session' &&
        candidate.session.sessionId === recording.getSessionId(),
    );
    if (target?.kind === 'session') return this.sessionInfoFor(target.session);
    const replay = await this.replayRecording(recording);
    return sessionInfoFromReplay(
      recording.getSessionId(),
      replay,
      new Date().toISOString(),
    );
  }

  private async sessionInfoFor(summary: SessionSummary): Promise<SessionInfo> {
    const replay = await replaySession(
      summary.filePath,
      this.persistenceProjectHash(),
      { mediaStore: this.deps.mediaStore },
    );
    if (!replay.ok) throw new Error(replay.error);
    return sessionInfoFromReplay(
      summary.sessionId,
      replay,
      summary.lastModified.toISOString(),
    );
  }

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
    await this.ensureSubscribed();
    await this.teardownActiveSession();
    const service = await SessionRecordingService.createLocked({
      sessionId: this.recordingSessionId,
      projectHash: this.persistenceProjectHash(),
      chatsDir: this.chatsDir(),
      workspaceDirs: this.workspaceDirs(),
      cwd: this.deps.config.getProjectRoot(),
      provider: this.deps.getProvider(),
      model: this.deps.getModel(),
      mediaStore: this.deps.mediaStore,
      maxQueueBytes: this.deps.readRecordingQueueLimit(),
    });
    let integration: RecordingIntegration | null = null;
    try {
      const client = this.deps.resolveClient();
      const history = await client.getHistory();
      await restartRecording(service, this.adoptedPath, this.deps.mediaStore);
      seedOwnerRecording(service, history, client.getHistoryService(), this);
      await service.flush();
      integration = new RecordingIntegration(
        service,
        this.deps.persistence.forRecording(service.getSessionId()),
      );
      const subscribed = this.attachHistory(integration);
      this.recording = service;
      this.integration = integration;
      this.integrationNeedsSubscribe = !subscribed;
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
    return persistPurge(this.requireRecording(), history, frontier);
  }

  private resubscribeIntegration(): Error | undefined {
    const integration = this.integration;
    if (integration === null) return undefined;
    try {
      this.integrationNeedsSubscribe = !this.attachHistory(integration);
      return undefined;
    } catch (error: unknown) {
      this.integrationNeedsSubscribe = true;
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Subscribes `integration` to the client's HistoryService so future
   * 'contentAdded'/compression events are appended continuously; when no
   * HistoryService is available yet the integration is left unsubscribed and a
   * warning is logged (a later start/resume re-attempts the subscription via
   * {@link ensureSubscribed}, FINDING A3). Pure attach step shared by
   * startRecording and resumeInternal; it commits NO instance state so callers
   * control ownership/rollback. Returns true when the subscription was
   * established, false when it was deferred (no HistoryService yet) so the
   * caller can set integrationNeedsSubscribe.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private attachHistory(integration: RecordingIntegration): boolean {
    const historyService = this.deps.resolveClient().getHistoryService();
    if (historyService !== null) {
      integration.subscribeToHistory(historyService, this);
      return true;
    }
    // No HistoryService yet: the integration is left unsubscribed, so NO
    // subsequent turn is appended until a later start/resume re-attempts the
    // subscription. Left silent this is an invisible continuous-recording
    // loss; warn so it is diagnosable AND flag it for bounded re-attach.
    logger.warn(
      () =>
        `attachHistory: HistoryService unavailable for session ${this.deps.sessionId()}; ` +
        `recording integration left unsubscribed (subsequent turns will not be recorded until re-subscribed)`,
    );
    return false;
  }

  /**
   * Disposes the live RecordingIntegration (unsubscribing its HistoryService
   * listeners) and the live recording service (if any), clearing the private
   * fields. The integration is disposed
   * FIRST so no 'contentAdded' event can reach a service mid-disposal. No-op
   * when no recording is active.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async releaseRecording(): Promise<void> {
    const integration = this.integration;
    const service = this.recording;
    this.integration = null;
    this.integrationNeedsSubscribe = false;
    this.recording = null;
    const errors: unknown[] = [];
    if (integration !== null) {
      await captureRollbackFailure(errors, () => integration.dispose());
    }
    await captureRollbackFailure(errors, async () => {
      if (service !== null) await service.dispose();
    });
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Recording cleanup failed');
    }
  }

  /**
   * Releases the on-disk session lock held by a prior resume (if any) and clears
   * the field. No-op when no lock is held.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async releaseLockHandle(): Promise<void> {
    const handle = this.currentLockHandle;
    if (handle === null) {
      return;
    }
    this.currentLockHandle = null;
    await handle.release();
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
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    // FINDING A1: serialize teardown through the op-chain mutex so dispose never
    // races a concurrent resume()/setRecording() adopting resources it is
    // releasing (double-dispose / released-then-adopted lock).
    return (this.disposalPromise ??= this.opChain
      .then(() => this.teardownActiveSession())
      .finally(() => this.deps.persistence.close()));
  }

  /**
   * Releases the active recording service and the held session lock, guarding
   * each step so a single failure does not skip the others and rethrowing the
   * first collected failure after all steps run. Shared by stopRecording (the
   * setRecording(false) / pre-resume path) and dispose (agent teardown).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async teardownActiveSession(): Promise<void> {
    const errors: unknown[] = [];
    await captureRollbackFailure(errors, () => this.releaseRecording());
    await captureRollbackFailure(errors, () => this.releaseLockHandle());
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Session teardown failed');
    }
  }

  private persistenceProjectHash(): string {
    return basename(this.deps.config.projectTempDir);
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
    return this.deps.config.projectChatsDir;
  }

  /**
   * Returns the workspace directories from the live workspace context.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private workspaceDirs(): string[] {
    return [...this.deps.directories()];
  }
}
