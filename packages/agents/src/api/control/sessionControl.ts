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
 * - Recording uses the journal recorder factory; setRecording(true) starts a
 *   recorder and seeds it with the current history so a file is materialized,
 *   then subscribes a RecordingIntegration to the client's HistoryService so
 *   subsequent turns are appended to the journal. setRecording(false) disposes the
 *   integration + service.
 * - resume is backed by resumeSession (CONTINUE_LATEST for 'latest'); a success
 *   feeds the reconstructed IContent history through the client restore path,
 *   adopts the returned recording service, subscribes a fresh RecordingIntegration
 *   so post-resume turns keep appending to the resumed file, and returns the
 *   restored IContent[] so callers (e.g. the Zed loadSession path) can replay it.
 */

import type { LocalMediaStore } from '@vybestack/llxprt-code-core';
import {
  RecordingIntegration,
  SessionDiscovery,
  SessionTransitionService,
  createCheckpointService,
  deleteSession as deleteRecordedSession,
  importSessionMediaPackage,
  withRecordingFailureReport,
  type CheckpointServicePort,
  type ContinueTarget,
  type ResumeBootHandle,
  type ResumeResult,
  type SessionRecordingPort,
  type SessionSummary,
} from '@vybestack/llxprt-code-core';
import type { SessionNativeHistory } from './session-history-observation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { HistoryAttachmentError } from '@vybestack/llxprt-code-core/services/history/attachHistoryJournal.js';
import { basename } from 'node:path';
import type { PreparedRecordingSession } from '../../session/session-new-client.js';
import type {
  AgentSessionControl,
  CheckpointInfo,
  SessionInfo,
  SessionRecordingState,
} from '../agent.js';
import { collectAsync } from './collectAsync.js';
import { startNewSessionTransition } from './new-session-transition.js';
import type { SessionRecordingEvent } from './recordSessionEvent.js';
import {
  persistSemanticMediaPurge as persistPurge,
  restartRecording,
} from './journalRecordingLifecycle.js';
import { exportRecordedSession } from './sessionControlExport.js';
import { restoreOwnerTurns } from './sessionControlHistoryMutation.js';
import {
  readSessionInfo,
  sessionInfoFromReplay,
} from './sessionControlInfo.js';
import {
  SessionRecordingLifetime,
  cleanupSessionResources,
} from './sessionControlRollback.js';
import {
  clearClientHistory,
  type HistoryMutationOptions,
} from './sessionHistoryClear.js';
import {
  adoptSessionResume,
  openSessionResume,
} from './sessionResumeAdoption.js';
import { warnSkippedRecordings } from './skippedRecordings.js';

import {
  readRecordingMetadata,
  type RecordingMetadata,
} from './recordingMetadata.js';

/**
 * Module logger mirroring the neighboring toolControl.ts precedent
 * (a module-scoped core DebugLogger). Used to surface an otherwise-silent
 * recording-subscription gap so lost continuous recording is diagnosable.
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
export interface SessionControlDeps {
  readonly paths: SessionRecordingPaths;
  readonly mediaStore: LocalMediaStore;
  readonly readRecordingQueueLimit: () => number;
  readonly directories: () => readonly string[];
  readonly sessionIdentityOwnership: 'config' | 'facade';
  readonly sessionId: () => string;
  readonly nativeHistory: SessionNativeHistory;
  readonly withSessionTransition: (
    operation: () => Promise<void>,
  ) => Promise<void>;
  readonly closeSessionAdmission: () => void;
  readonly prepareNewSessionClient: (
    sessionId: string,
  ) => Promise<PreparedRecordingSession>;
  readonly getProvider: () => string;
  readonly getModel: () => string;
  readonly readOwnedSessionId: () => string;
  readonly adoptOwnedSessionId: (sessionId: string) => void;
}
export class SessionControl implements AgentSessionControl {
  private readonly recordingLifetime: SessionRecordingLifetime;
  private readonly deps: SessionControlDeps;
  constructor(
    paths: SessionRecordingPaths,
    mediaStore: LocalMediaStore,
    readRecordingQueueLimit: () => number,
    directories: () => readonly string[],
    sessionIdentityOwnership: 'config' | 'facade',
    sessionId: () => string,
    nativeHistory: SessionNativeHistory,
    withSessionTransition: (operation: () => Promise<void>) => Promise<void>,
    closeSessionAdmission: () => void,
    prepareNewSessionClient: (
      sessionId: string,
    ) => Promise<PreparedRecordingSession>,
    getProvider: () => string,
    getModel: () => string,
    readOwnedSessionId: () => string,
    adoptOwnedSessionId: (sessionId: string) => void,
  ) {
    this.deps = {
      paths,
      mediaStore,
      readRecordingQueueLimit,
      directories,
      sessionIdentityOwnership,
      sessionId,
      nativeHistory,
      withSessionTransition,
      closeSessionAdmission,
      prepareNewSessionClient,
      getProvider,
      getModel,
      readOwnedSessionId,
      adoptOwnedSessionId,
    };
    this.recordingLifetime = new SessionRecordingLifetime(
      nativeHistory,
      sessionId(),
      this,
    );
  }
  private readonly ensureSubscribed = () =>
    this.recordingLifetime.ensureSubscribed();
  private readonly attachHistory = (integration: RecordingIntegration) =>
    this.recordingLifetime.attachHistory(integration);
  private readonly requireRecording = () =>
    this.recordingLifetime.requireRecording();
  private readonly teardownActiveSession = () =>
    this.recordingLifetime.teardownActiveSession();
  private readonly historyObservers = new Set<() => void | Promise<void>>();
  private readonly historyShutdown: Array<PromiseSettledResult<void>> = [];
  private historyShutdownPending: Promise<void> = Promise.resolve();
  private requireHistory() {
    const history = this.deps.nativeHistory.getHistoryService();
    if (history === null) throw new Error('Session history unavailable');
    return history;
  }
  readonly appendDisplay: AgentSessionControl['appendDisplay'] = (
    descriptor,
    source,
    origin = this,
  ) =>
    this.runExclusive(() =>
      this.requireHistory().appendDisplay(descriptor, source, origin),
    );
  readonly getJournalLength = (): number => this.requireHistory().length();
  readonly getContextRange = () => this.requireHistory().getContextRange();
  readonly subscribeContextRange: AgentSessionControl['subscribeContextRange'] =
    (publish) => {
      if (this.admissionClosed) throw new Error('Session disposed');
      return this.deps.nativeHistory.subscribeContextRange(
        this.historyObservers,
        publish,
      );
    };
  readonly openDumpSnapshot: AgentSessionControl['openDumpSnapshot'] = () =>
    this.runExclusive(
      async () =>
        this.deps.nativeHistory.getHistoryService()?.openDumpSnapshot() ?? null,
    );
  readonly replaceHistoryFromSource: AgentSessionControl['replaceHistoryFromSource'] =
    (rows, signal) =>
      this.runExclusive(async () => {
        await this.ensureSubscribed();
        await this.deps.nativeHistory.setHistoryFromSource(rows, {
          signal,
        });
      });
  readonly adoptResumeBoot: AgentSessionControl['adoptResumeBoot'] = (
    ...args
  ) => this.runExclusive(() => this.requireHistory().adoptResumeBoot(...args));
  readonly attachRecording: AgentSessionControl['attachRecording'] = (
    recording,
  ) => this.deps.nativeHistory.attachRecordingHistory(recording);
  readonly readHistorySnapshot: AgentSessionControl['readHistorySnapshot'] =
    () => this.deps.nativeHistory.readHistorySnapshot();
  readonly isHistoryInitialized = () =>
    this.deps.nativeHistory.hasChatInitialized();
  readonly readInitializedHistory = () =>
    this.deps.nativeHistory.readInitializedHistory();
  readonly replaceHistory = (history: readonly IContent[]) =>
    this.runExclusive(() =>
      this.deps.nativeHistory.replaceNativeHistory(
        history,
        this,
        this.ensureSubscribed,
      ),
    );
  readonly subscribeHistoryTokens = (publish: (count: number) => void) => {
    if (this.admissionClosed) throw new Error('Session disposed');
    return this.deps.nativeHistory.subscribeHistoryTokens(
      this.historyObservers,
      publish,
    );
  };
  readonly attachRecordingHistory = (recording: RecordingIntegration) =>
    this.deps.nativeHistory.attachRecordingHistory(recording);
  readonly connectRecordingHistory = (
    readRecording: () => RecordingIntegration | null,
  ) => {
    if (this.admissionClosed) throw new Error('Session disposed');
    return this.deps.nativeHistory.connectRecordingHistory(
      this.historyObservers,
      readRecording,
    );
  };

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
   * File of the last adopted (resumed) recording. Re-enabling recording after
   * a resume continues that file instead of starting a second one for the same
   * session; a new session clears it.
   */
  private adoptedPath: string | null = null;
  private checkpointService: CheckpointServicePort | undefined;

  private getCheckpointService(): CheckpointServicePort {
    this.checkpointService ??= createCheckpointService();
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
    options?: Parameters<AgentSessionControl['resume']>[1],
  ): Promise<AsyncIterable<IContent>> {
    // FINDING A1: serialize through the op-chain mutex so a concurrent
    // resume/setRecording/dispose cannot interleave their multi-await
    // recording/integration/lock swaps (use-after-free / orphaned lock).
    return this.runExclusive(async () => {
      if (target === 'latest') return this.resumeInternal(target, options);
      await this.ensureSubscribed();
      const targets = await this.continueTargets();
      const resolved = SessionDiscovery.resolveContinueRef(target, targets);
      if ('error' in resolved) {
        throw new Error(`Failed to resume session: ${resolved.error}`);
      }
      if (resolved.target.kind === 'checkpoint') {
        const boot = await this.forkTarget(resolved.target, options);
        return boot.streamRows();
      }
      return this.resumeInternal(resolved.target.session.sessionId, options);
    });
  }

  /** Adopts a locked journal inside the session-operation queue. */
  private async resumeInternal(
    target: 'latest' | string,
    options?: Parameters<AgentSessionControl['resume']>[1],
  ): Promise<AsyncIterable<IContent>> {
    await this.ensureSubscribed();
    const result = await openSessionResume(
      this.deps,
      target,
      this.persistenceProjectHash(),
      logger(),
    );
    await adoptSessionResume(
      this.deps,
      result,
      {
        recording: this.recordingLifetime.recording,
        integration: this.recordingLifetime.integration,
        lock: this.recordingLifetime.currentLockHandle,
        sessionId: this.recordingLifetime.recordingSessionId,
      },
      (integration) => this.publishAdopted(result, integration),
      this,
      false,
      options,
    );
    return result.boot.streamRows();
  }

  private publishAdopted(
    result: Pick<ResumeResult, 'recording' | 'lockHandle'>,
    integration: RecordingIntegration,
  ): () => void {
    const previous = {
      recording: this.recordingLifetime.recording,
      integration: this.recordingLifetime.integration,
      integrationNeedsSubscribe:
        this.recordingLifetime.integrationNeedsSubscribe,
      currentLockHandle: this.recordingLifetime.currentLockHandle,
      recordingSessionId: this.recordingLifetime.recordingSessionId,
      adoptedPath: this.adoptedPath,
    };
    this.recordingLifetime.recording = result.recording;
    this.recordingLifetime.integration = integration;
    this.recordingLifetime.integrationNeedsSubscribe = false;
    this.recordingLifetime.currentLockHandle = result.lockHandle;
    this.recordingLifetime.recordingSessionId = result.recording.getSessionId();
    this.adoptedPath = result.recording.getFilePath();
    return () => {
      this.recordingLifetime.recording = previous.recording;
      this.recordingLifetime.integration = previous.integration;
      this.recordingLifetime.integrationNeedsSubscribe =
        previous.integrationNeedsSubscribe;
      this.recordingLifetime.currentLockHandle = previous.currentLockHandle;
      this.recordingLifetime.recordingSessionId = previous.recordingSessionId;
      this.adoptedPath = previous.adoptedPath;
    };
  }

  flushRecording = (): Promise<void> =>
    this.runExclusive(() => this.recordingLifetime.flush());

  recordRecordingEvent = (event: SessionRecordingEvent): Promise<void> =>
    this.runExclusive(() => this.recordingLifetime.recordEvent(event));

  rebindRecording = (): Promise<void> =>
    this.runExclusive(async () => {
      if (this.recordingLifetime.integration !== null)
        await this.attachHistory(this.recordingLifetime.integration);
    });

  async createCheckpoint(
    name: string,
    options?: { readonly overwrite?: boolean },
  ): Promise<CheckpointInfo> {
    return this.runExclusive(async () => {
      await this.ensureSubscribed();
      if (this.recordingLifetime.recording === null) {
        await this.startRecording();
      }
      const recording = this.requireRecording();
      await withRecordingFailureReport(
        this.recordingLifetime.integration?.flushAtTurnBoundary(),
      );
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
      await this.forkTarget(target);
      return this.currentSessionInfo();
    });
  }

  async listCheckpoints(): Promise<readonly CheckpointInfo[]> {
    return this.runExclusive(async () => {
      const targets = await this.continueTargets();
      const checkpoints: CheckpointInfo[] = [];
      const replayByFilePath = new Map<string, RecordingMetadata>();
      for (const target of targets) {
        if (target.kind !== 'checkpoint') continue;
        let replay = replayByFilePath.get(target.source.filePath);
        if (replay === undefined) {
          replay = await readRecordingMetadata(
            target.source.filePath,
            this.persistenceProjectHash(),
          );
          replayByFilePath.set(target.source.filePath, replay);
        }
        const checkpoint = replay.checkpoints?.find(
          (candidate) => candidate.checkpointId === target.checkpointId,
        );
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
      if (
        this.recordingLifetime.recording?.getSessionId() ===
        target.source.sessionId
      ) {
        await this.getCheckpointService().renameCheckpoint(
          this.recordingLifetime.recording,
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
      if (
        this.recordingLifetime.recording?.getSessionId() ===
        target.source.sessionId
      ) {
        await this.getCheckpointService().deleteCheckpoint(
          this.recordingLifetime.recording,
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
      if (this.recordingLifetime.recording === null)
        await this.startRecording();
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
        await this.forkTarget(resolved.target);
        return this.currentSessionInfo();
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
        this.recordingLifetime.recording?.getSessionId() ===
        resolved.target.session.sessionId
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
        this.deps.mediaStore,
        async (imported) => {
          await this.resumeInternal(imported.sessionId);
          return this.currentSessionInfo();
        },
      ),
    );
  }

  async restoreTurns(
    turns: number,
    options?: HistoryMutationOptions,
  ): ReturnType<typeof restoreOwnerTurns> {
    return this.runExclusive(async () => {
      await this.ensureSubscribed();
      this.requireRecording();
      return restoreOwnerTurns(
        turns,
        this.deps.nativeHistory,
        this.deps.mediaStore,
        options,
      );
    });
  }

  async clearHistory(options?: HistoryMutationOptions): Promise<void> {
    await this.runExclusive(async () => {
      this.requireRecording();
      await clearClientHistory(
        this.deps.nativeHistory,
        this.deps.mediaStore,
        options,
      );
    });
  }

  // Caller-requested materialization: the public contract returns an array.
  getHistory = (): Promise<readonly IContent[]> =>
    this.runExclusive(() => collectAsync(this.deps.nativeHistory.getHistory()));

  getSessionId = (): string => this.recordingLifetime.recordingSessionId;

  startNewSession = (): Promise<void> =>
    this.deps.withSessionTransition(() =>
      this.runExclusive(() =>
        startNewSessionTransition(this.deps, {
          owner: this,
          retire: () => this.teardownActiveSession(),
          publish: (id, recording, integration) => {
            this.recordingLifetime.recordingSessionId = id;
            this.adoptedPath = null;
            this.recordingLifetime.recording = recording;
            this.recordingLifetime.integration = integration;
          },
        }),
      ),
    );

  /**
   * Enables or disables session recording. Enabling starts a fresh
   * journal recorder for this session and seeds it with the current
   * history so the native file is materialized (and getRecording().path is
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
    const path = this.recordingLifetime.recording?.getFilePath() ?? null;
    return {
      enabled: this.recordingLifetime.recording?.isActive() ?? false,
      format: 'journal',
      ...(path !== null ? { path } : {}),
    };
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
    recording: SessionRecordingPort,
  ): Promise<RecordingMetadata> {
    const filePath = recording.getFilePath();
    if (filePath === null) throw new Error('Recording is not materialized');
    return readRecordingMetadata(filePath, this.persistenceProjectHash());
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
    warnSkippedRecordings(logger(), listing.unreadableRecordings);
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
    options?: Parameters<AgentSessionControl['resume']>[1],
  ): Promise<ResumeBootHandle> {
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
    await adoptSessionResume(
      this.deps,
      { ...result, warnings: [], skippedRecordings: [] },
      {
        recording: this.recordingLifetime.recording,
        integration: this.recordingLifetime.integration,
        lock: this.recordingLifetime.currentLockHandle,
        sessionId: this.recordingLifetime.recordingSessionId,
      },
      (integration) => this.publishAdopted(result, integration),
      this,
      true,
      options,
    );
    return result.boot;
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

  private sessionInfoFor = (summary: SessionSummary): Promise<SessionInfo> =>
    readSessionInfo(summary, this.persistenceProjectHash());

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
    const service = await restartRecording(
      {
        sessionId: this.recordingLifetime.recordingSessionId,
        projectHash: this.persistenceProjectHash(),
        chatsDir: this.chatsDir(),
        workspaceDirs: this.workspaceDirs(),
        cwd: this.deps.paths.projectRoot,
        provider: this.deps.getProvider(),
        model: this.deps.getModel(),
        resolveProviderModel: () => ({
          provider: this.deps.getProvider(),
          model: this.deps.getModel(),
        }),
        mediaStore: this.deps.mediaStore,
        maxQueueBytes: this.deps.readRecordingQueueLimit(),
      },
      this.adoptedPath,
    );
    // The integration attaches to the journal, which seeds the new recording
    // from the durable history rows; no history array is read here.
    const integration = new RecordingIntegration(service);
    try {
      const subscribed = await this.attachHistory(integration);
      await service.flush();
      this.recordingLifetime.recording = service;
      this.recordingLifetime.integration = integration;
      this.recordingLifetime.integrationNeedsSubscribe = !subscribed;
    } catch (attachError: unknown) {
      // The new recorder is discarded, so the attachment's partial-commit
      // accounting is moot; the caller needs the underlying startup failure.
      // The integration re-reports the same attachment failure on dispose,
      // which is the startup failure itself and not a cleanup failure.
      const error =
        attachError instanceof HistoryAttachmentError
          ? attachError.cause
          : attachError;
      const cleanupFailures = (
        await cleanupSessionResources(integration, service, null)
      ).filter((failure) => failure !== attachError);
      if (cleanupFailures.length > 0) {
        throw new AggregateError(
          [error, ...cleanupFailures],
          'Recording startup and cleanup failed',
        );
      }
      throw error;
    }
  }

  async persistSemanticMediaPurge(): Promise<void> {
    return persistPurge(this.requireRecording());
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
    if (this.admissionClosed) return;
    this.admissionClosed = true;
    this.historyShutdownPending = Promise.allSettled(
      [...this.historyObservers].map((stop) => Promise.resolve().then(stop)),
    ).then((results) => {
      this.historyShutdown.push(...results);
    });
  }

  dispose(): Promise<void> {
    this.closeAdmission();
    // Join observer attachments before retiring the recorder they attach.
    return (this.disposalPromise ??= this.opChain.then(async () => {
      await this.historyShutdownPending;
      const teardown = await Promise.allSettled([this.teardownActiveSession()]);
      const failures = [...this.historyShutdown, ...teardown].flatMap(
        (result) => (result.status === 'rejected' ? [result.reason] : []),
      );
      if (failures.length > 0)
        throw new AggregateError(failures, 'Session teardown failed');
    }));
  }

  private persistenceProjectHash(): string {
    return basename(this.deps.paths.projectTempDir);
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
    return this.deps.paths.projectChatsDir;
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
