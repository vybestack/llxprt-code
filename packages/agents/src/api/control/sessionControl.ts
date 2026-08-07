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
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
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
  /** The live Config (storage, project root, workspace context). */
  readonly config: Config;
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
  private readonly checkpointService = new CheckpointService();

  constructor(private readonly deps: SessionControlDeps) {}

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
   * is adopted as the live recording (installed on Config as the active
   * recording, same swap semantics as setRecording) and the returned session
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
    };
    const result = await resumeSession(request);
    if (!result.ok) {
      throw new Error(`Failed to resume session: ${result.error}`);
    }
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
    history: IContent[],
  ): Promise<void> {
    const priorRecording = this.recording;
    const priorIntegration = this.integration;
    const priorLockHandle = this.currentLockHandle;
    const priorNeedsSubscribe = this.integrationNeedsSubscribe;
    const client = this.deps.resolveClient();
    const priorHistory = await client.getHistory();
    const integration = new RecordingIntegration(recording);
    let historyReplacementAttempted = false;
    let priorIntegrationUnsubscribed = false;
    try {
      if (priorIntegration !== null && !priorNeedsSubscribe) {
        priorIntegration.unsubscribeFromHistory();
        priorIntegrationUnsubscribed = true;
      }
      historyReplacementAttempted = true;
      await client.setHistory(history);
      const subscribed = this.attachIntegrationToHistory(integration);
      this.deps.config.setSessionRecordingService(recording);
      this.recording = recording;
      this.integration = integration;
      this.integrationNeedsSubscribe = !subscribed;
      this.currentLockHandle = lockHandle;
    } catch (error: unknown) {
      this.disposeIntegrationQuietly(integration);
      this.recording = priorRecording;
      this.integration = priorIntegration;
      this.integrationNeedsSubscribe = priorNeedsSubscribe;
      this.currentLockHandle = priorLockHandle;
      const rollbackFailures: unknown[] = [];
      try {
        this.deps.config.setSessionRecordingService(
          priorRecording ?? undefined,
        );
      } catch (failure: unknown) {
        rollbackFailures.push(failure);
      }
      if (historyReplacementAttempted) {
        try {
          await client.setHistory(priorHistory);
        } catch (failure: unknown) {
          rollbackFailures.push(failure);
        }
      }
      if (priorIntegrationUnsubscribed && priorIntegration !== null) {
        this.integrationNeedsSubscribe = true;
        try {
          this.integrationNeedsSubscribe =
            !this.attachIntegrationToHistory(priorIntegration);
        } catch (failure: unknown) {
          rollbackFailures.push(failure);
        }
      }
      await this.disposeServiceQuietly(recording);
      await this.releaseLockQuietly(lockHandle);
      if (rollbackFailures.length > 0) {
        throw new AggregateError(
          [error, ...rollbackFailures],
          'Session transition and rollback both failed',
        );
      }
      throw error;
    }

    this.disposeIntegrationQuietlyIfPresent(priorIntegration);
    if (priorRecording !== null) {
      await this.disposeServiceQuietly(priorRecording);
    }
    if (priorLockHandle !== null) {
      await this.releaseLockQuietly(priorLockHandle);
    }
  }

  private disposeIntegrationQuietlyIfPresent(
    integration: RecordingIntegration | null,
  ): void {
    if (integration !== null) this.disposeIntegrationQuietly(integration);
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
      integration.subscribeToHistory(historyService);
      this.integrationNeedsSubscribe = false;
    } catch (error) {
      const deadRecording = this.recording;
      const deadLockHandle = this.currentLockHandle;
      this.recording = null;
      this.integration = null;
      this.integrationNeedsSubscribe = false;
      this.currentLockHandle = null;
      this.deps.config.setSessionRecordingService(undefined);
      this.disposeIntegrationQuietly(integration);
      if (deadRecording !== null) {
        await this.disposeServiceQuietly(deadRecording);
      }
      if (deadLockHandle !== null) {
        await this.releaseLockQuietly(deadLockHandle);
      }
      logger.warn(
        () =>
          `ensureSubscribed: re-attach failed for session ${this.deps.sessionId()}; ` +
          `dropped the dead integration so the operation can rebuild it: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
      throw error;
    }
  }

  /** Best-effort integration dispose for failure/rollback paths. */
  private disposeIntegrationQuietly(integration: RecordingIntegration): void {
    try {
      integration.dispose();
    } catch {
      // Best-effort: the triggering error is rethrown by the caller.
    }
  }

  /**
   * Best-effort dispose of a recording service on a resume failure/rollback
   * path, swallowing any dispose error (the original failure is the one to
   * surface). Used only for the freshly acquired resumed service that is NOT yet
   * committed to the instance fields.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async disposeServiceQuietly(
    service: SessionRecordingService,
  ): Promise<void> {
    try {
      await service.dispose();
    } catch {
      // Best-effort: the triggering error is rethrown by the caller.
    }
  }

  /**
   * Best-effort release of a session lock on a resume failure/rollback path,
   * swallowing any release error. Used only for the freshly acquired resumed
   * lock that is NOT yet committed to the instance fields, so the on-disk lock
   * file is removed even when the resume is aborted.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async releaseLockQuietly(handle: LockHandle): Promise<void> {
    try {
      await handle.release();
    } catch {
      // Best-effort: the triggering error is rethrown by the caller.
    }
  }

  async createCheckpoint(name: string): Promise<CheckpointInfo> {
    return this.runExclusive(async () => {
      await this.ensureSubscribed();
      if (this.recording === null) {
        await this.startRecording();
      }
      const recording = this.requireRecording();
      const created = await this.checkpointService.createCheckpoint(
        recording,
        this.persistenceProjectHash(),
        name,
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

  async renameCheckpoint(ref: string, name: string): Promise<void> {
    await this.runExclusive(async () => {
      const target = await this.resolveCheckpointTarget(ref);
      const trimmedName = name.trim();
      if (target.checkpointName === trimmedName) return;
      if (this.recording?.getSessionId() === target.source.sessionId) {
        await this.checkpointService.renameCheckpoint(
          this.recording,
          this.persistenceProjectHash(),
          target.checkpointId,
          trimmedName,
        );
        return;
      }
      const validatedName = await SessionDiscovery.validateAvailableName(
        trimmedName,
        this.chatsDir(),
        this.persistenceProjectHash(),
      );
      await this.checkpointService.renameCheckpointClosed(
        target.source.filePath,
        this.persistenceProjectHash(),
        this.chatsDir(),
        target.source.sessionId,
        target.checkpointId,
        validatedName,
      );
    });
  }

  async deleteCheckpoint(ref: string): Promise<void> {
    await this.runExclusive(async () => {
      const target = await this.resolveCheckpointTarget(ref);
      if (this.recording?.getSessionId() === target.source.sessionId) {
        await this.checkpointService.deleteCheckpoint(
          this.recording,
          this.persistenceProjectHash(),
          target.checkpointId,
        );
        return;
      }
      await this.checkpointService.deleteCheckpointClosed(
        target.source.filePath,
        this.persistenceProjectHash(),
        this.chatsDir(),
        target.source.sessionId,
        target.checkpointId,
      );
    });
  }

  async nameCurrentSession(name: string): Promise<void> {
    await this.runExclusive(async () => {
      if (this.recording === null) await this.startRecording();
      const recording = this.requireRecording();
      const normalizedName = name.trim();
      const replay = await this.replayRecording(recording);
      if (replay.sessionName === normalizedName) return;
      await this.checkpointService.setSessionName(
        recording,
        this.persistenceProjectHash(),
        normalizedName,
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
      const sessions: SessionInfo[] = [];
      for (const target of targets) {
        if (target.kind !== 'session') continue;
        sessions.push(await this.sessionInfoFor(target.session));
      }
      return sessions;
    });
  }

  async deleteSession(ref: string): Promise<void> {
    await this.runExclusive(async () => {
      const chatsDir = this.chatsDir();
      const projectHash = this.persistenceProjectHash();
      const targets = await SessionDiscovery.listContinueTargets(
        chatsDir,
        projectHash,
      );
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

  async clearHistory(): Promise<void> {
    await this.runExclusive(async () => {
      const client = this.deps.resolveClient();
      const history = await client.getHistory();
      const recording = this.requireRecording();
      const result = await new HistoryMutationService().clear(
        history,
        recording,
      );
      if (!result.ok) throw new Error(result.error);
      this.integration?.unsubscribeFromHistory();
      const mutationFailures: unknown[] = [];
      try {
        await client.resetChat();
        await client.restoreHistory(result.remainingHistory);
      } catch (error: unknown) {
        mutationFailures.push(error);
        try {
          await client.setHistory(history);
        } catch (rollbackError: unknown) {
          mutationFailures.push(rollbackError);
        }
        try {
          await this.restoreRecordedHistory(
            recording,
            history.slice(result.remainingHistory.length),
          );
        } catch (rollbackError: unknown) {
          mutationFailures.push(rollbackError);
        }
      }
      const resubscribeError = this.resubscribeIntegration();
      if (resubscribeError !== undefined)
        mutationFailures.push(resubscribeError);
      if (mutationFailures.length > 1) {
        throw new AggregateError(
          mutationFailures,
          'History mutation, rollback, or recording resubscription failed',
        );
      }
      if (mutationFailures.length === 1) throw mutationFailures[0];
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
      await this.stopRecording();
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
    const service = this.recording;
    const enabled = service?.isActive() ?? false;
    const path = service?.getFilePath() ?? null;
    return {
      enabled,
      format: RECORDING_FORMAT,
      ...(path !== null ? { path } : {}),
    };
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
    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('Recording is not materialized');
    const replay = await replaySession(filePath, this.persistenceProjectHash());
    if (!replay.ok) throw new Error(replay.error);
    return replay;
  }

  private continueTargets(): Promise<ContinueTarget[]> {
    return SessionDiscovery.listContinueTargets(
      this.chatsDir(),
      this.persistenceProjectHash(),
    );
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
    const result = await new SessionTransitionService().forkFromCheckpoint(
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
    return this.sessionInfoFromReplay(
      recording.getSessionId(),
      replay,
      new Date().toISOString(),
    );
  }

  private async sessionInfoFor(summary: SessionSummary): Promise<SessionInfo> {
    const replay = await replaySession(
      summary.filePath,
      this.persistenceProjectHash(),
    );
    if (!replay.ok) throw new Error(replay.error);
    return this.sessionInfoFromReplay(
      summary.sessionId,
      replay,
      summary.lastModified.toISOString(),
    );
  }

  private sessionInfoFromReplay(
    id: string,
    replay: Extract<ReplayResult, { ok: true }>,
    modifiedAt: string,
  ): SessionInfo {
    return {
      id,
      name: replay.sessionName ?? null,
      title: replay.metadata.title,
      createdAt: replay.metadata.startTime,
      modifiedAt,
      ...(replay.ancestry === undefined
        ? {}
        : {
            parentSessionId: replay.ancestry.parentSessionId,
            parentSequence: replay.ancestry.parentSequence,
            checkpointId: replay.ancestry.checkpointId,
            checkpointName: replay.ancestry.checkpointName,
          }),
    };
  }

  // ─── Recording helpers ───────────────────────────────────────────────────

  /**
   * Starts a fresh recording service for this session, replacing any prior one
   * (the prior service + integration are flushed + disposed first). The current
   * history is recorded as content events so the file materializes and
   * getRecording().path is defined. The freshly built service is installed on
   * Config via setSessionRecordingService so the rest of the system (which reads
   * the active recording via config.getSessionRecordingService) observes the
   * swap. A RecordingIntegration is then subscribed to the client's
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
   * created and Config still owns the service; the subscription is deferred
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
    await this.stopRecording();
    const service = await SessionRecordingService.createLocked({
      sessionId: this.deps.sessionId(),
      projectHash: this.persistenceProjectHash(),
      chatsDir: this.chatsDir(),
      workspaceDirs: this.workspaceDirs(),
      cwd: this.deps.config.getProjectRoot(),
      provider: this.deps.getProvider(),
      model: this.deps.getModel(),
    });
    const history = await this.deps.resolveClient().getHistory();
    for (const item of history) {
      service.recordContent(item);
    }
    await service.flush();
    // FINDING F8: build + subscribe the integration BEFORE committing
    // this.recording and the Config recording service, so a subscribe failure
    // cannot leave recording PARTIALLY enabled (fields/Config set with no live
    // integration). On failure dispose the integration AND the freshly built
    // service (neither is referenced by any field yet) and rethrow; the instance
    // fields stay untouched so recording remains cleanly disabled.
    const integration = new RecordingIntegration(service);
    let subscribed: boolean;
    try {
      subscribed = this.attachIntegrationToHistory(integration);
    } catch (error) {
      this.disposeIntegrationQuietly(integration);
      await this.disposeServiceQuietly(service);
      throw error;
    }
    this.recording = service;
    this.deps.config.setSessionRecordingService(service);
    this.integration = integration;
    // FINDING A3: when the HistoryService was unavailable the integration is
    // committed but dead; flag it so a later operation re-attaches it rather
    // than leaving continuous recording permanently off.
    this.integrationNeedsSubscribe = !subscribed;
  }

  private async restoreRecordedHistory(
    recording: SessionRecordingService,
    removedHistory: readonly IContent[],
  ): Promise<void> {
    for (const content of removedHistory) recording.recordContent(content);
    await recording.flush();
    if (!recording.isActive()) {
      throw new Error('Recording failed during history rollback');
    }
  }

  private resubscribeIntegration(): Error | undefined {
    const integration = this.integration;
    if (integration === null) return undefined;
    try {
      this.integrationNeedsSubscribe =
        !this.attachIntegrationToHistory(integration);
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
  private attachIntegrationToHistory(
    integration: RecordingIntegration,
  ): boolean {
    const historyService = this.deps.resolveClient().getHistoryService();
    if (historyService !== null) {
      integration.subscribeToHistory(historyService);
      return true;
    }
    // No HistoryService yet: the integration is left unsubscribed, so NO
    // subsequent turn is appended until a later start/resume re-attempts the
    // subscription. Left silent this is an invisible continuous-recording
    // loss; warn so it is diagnosable AND flag it for bounded re-attach.
    logger.warn(
      () =>
        `attachIntegrationToHistory: HistoryService unavailable for session ${this.deps.sessionId()}; ` +
        `recording integration left unsubscribed (subsequent turns will not be recorded until re-subscribed)`,
    );
    return false;
  }

  /**
   * Flushes + disposes the live recording service (if any), clears it from
   * Config (so the system no longer sees an active recording), and releases any
   * session lock held by a prior resume. Each teardown step is guarded so a
   * single failure does not skip the others.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async stopRecording(): Promise<void> {
    await this.teardownActiveSession();
  }

  /**
   * Disposes the live RecordingIntegration (unsubscribing its HistoryService
   * listeners) and the live recording service (if any), clears the private
   * fields, and clears the service from Config. The integration is disposed
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
    this.deps.config.setSessionRecordingService(undefined);
    const errors: unknown[] = [];
    if (integration !== null) {
      this.guardSync(errors, () => integration.dispose());
    }
    await this.guard(errors, async () => {
      if (service !== null) {
        await service.dispose();
      }
    });
    if (errors.length > 0) {
      throw errors[0];
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

  /**
   * Awaits fn and collects any throw/rejection into the errors accumulator so a
   * single failed teardown step does not skip the remaining steps.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private async guard(
    errors: unknown[],
    fn: () => Promise<void>,
  ): Promise<void> {
    try {
      await fn();
    } catch (e) {
      errors.push(e);
    }
  }

  /**
   * Synchronous variant of {@link guard} for non-awaitable teardown/subscription
   * steps (integration dispose/subscribe) so a single failure is collected
   * rather than short-circuiting the remaining steps.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private guardSync(errors: unknown[], fn: () => void): void {
    try {
      fn();
    } catch (e) {
      errors.push(e);
    }
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
  async dispose(): Promise<void> {
    // FINDING A1: serialize teardown through the op-chain mutex so dispose never
    // races a concurrent resume()/setRecording() adopting resources it is
    // releasing (double-dispose / released-then-adopted lock).
    await this.runExclusive(() => this.teardownActiveSession());
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
    await this.guard(errors, () => this.releaseRecording());
    await this.guard(errors, () => this.releaseLockHandle());
    if (errors.length > 0) {
      throw errors[0];
    }
  }

  private persistenceProjectHash(): string {
    return basename(this.deps.config.storage.getProjectTempDir());
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
    return this.deps.config.storage.getProjectChatsDir();
  }

  /**
   * Returns the workspace directories from the live workspace context.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  private workspaceDirs(): string[] {
    return [...this.deps.config.getWorkspaceContext().getDirectories()];
  }
}
