import type { SessionNativeHistory } from './session-history-observation.js';
import { requireActiveRecording } from './recordedHistoryPersistence.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RecordingIntegration,
  type LockHandle,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { SessionPersistenceService } from '@vybestack/llxprt-code-core/storage/SessionPersistenceService.js';

export async function captureRollbackFailure(
  failures: unknown[],
  operation: () => void | Promise<void>,
): Promise<void> {
  try {
    await operation();
  } catch (error: unknown) {
    failures.push(error);
  }
}

export async function cleanupSessionResources(
  integration: RecordingIntegration | null,
  recording: SessionRecordingService | null,
  lockHandle: LockHandle | null,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  if (integration !== null) {
    await captureRollbackFailure(failures, () => integration.dispose());
  }
  if (recording !== null) {
    await captureRollbackFailure(failures, () => recording.dispose());
  }
  if (lockHandle !== null) {
    await captureRollbackFailure(failures, () => lockHandle.release());
  }
  return failures;
}

export function rollbackPreparedSessionArtifacts(input: {
  readonly integration: RecordingIntegration;
  readonly recording: SessionRecordingService;
  readonly lockHandle: LockHandle;
}): Promise<unknown[]> {
  return cleanupSessionResources(
    input.integration,
    input.recording,
    input.lockHandle,
  );
}

export async function prepareSessionArtifacts(
  recording: SessionRecordingService,
  lockHandle: LockHandle,
  persistence: SessionPersistenceService,
  readHistory: () => Promise<readonly IContent[]>,
): Promise<{
  priorHistory: readonly IContent[];
  integration: RecordingIntegration;
}> {
  try {
    const priorHistory = await readHistory();
    const integration = new RecordingIntegration(recording, persistence);
    return { priorHistory, integration };
  } catch (error: unknown) {
    const cleanupFailures = await cleanupSessionResources(
      null,
      recording,
      lockHandle,
    );
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        [error, ...cleanupFailures],
        'Session preparation and cleanup failed',
      );
    }
    throw error;
  }
}

export async function cleanupPreviousSession(
  integration: RecordingIntegration | null,
  recording: SessionRecordingService | null,
  lockHandle: LockHandle | null,
): Promise<void> {
  const failures = await cleanupSessionResources(
    integration,
    recording,
    lockHandle,
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Previous session cleanup failed after transition',
    );
  }
}

export function adoptRecordingSessionId(
  readSessionId: () => string,
  adoptSessionId: (sessionId: string) => void,
  sessionIdentityOwnership: 'config' | 'facade',
  priorSessionId: string,
  recording: SessionRecordingService,
  beforeAdoption: () => void,
): void {
  if (sessionIdentityOwnership === 'facade') return;
  const configId = readSessionId();
  if (configId !== priorSessionId) {
    throw new Error(
      `Cannot adopt recording session ${recording.getSessionId()}: shared Config session ${configId} does not belong to facade recording session ${priorSessionId}`,
    );
  }
  beforeAdoption();
  adoptSessionId(recording.getSessionId());
}

export async function restoreConfigSessionId(
  readSessionId: () => string,
  adoptSessionId: (sessionId: string) => void,
  sessionIdentityOwnership: 'config' | 'facade',
  priorSessionId: string,
  adoptionAttempted: boolean,
  failures: unknown[],
): Promise<void> {
  if (sessionIdentityOwnership === 'facade') return;
  if (adoptionAttempted && readSessionId() !== priorSessionId) {
    await captureRollbackFailure(failures, () =>
      adoptSessionId(priorSessionId),
    );
  }
}

export function rethrowSessionTransitionFailure(
  error: unknown,
  failures: unknown[],
): never {
  if (failures.length > 0) {
    throw new AggregateError(
      [error, ...failures],
      'Session transition and rollback both failed',
    );
  }
  throw error;
}

export function rejectHistorySubscription(
  error: unknown,
  cleanupFailures: readonly unknown[],
  sessionId: string,
  logger: DebugLogger,
): never {
  logger.warn(
    () =>
      `ensureSubscribed: re-attach failed for session ${sessionId}; ` +
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

/**
 * Logger for recording lifecycle diagnostics. Built per call rather than kept
 * at module scope, matching the other lazy logger helpers in this package.
 */
function logger(): DebugLogger {
  return new DebugLogger('llxprt:agents:session-control');
}

export class SessionRecordingLifetime {
  constructor(
    private readonly nativeHistory: SessionNativeHistory,
    public recordingSessionId: string,
    private readonly origin: object,
  ) {}
  /**
   * The live recording service when recording is enabled, or null when it is
   * disabled. getRecording reflects this directly.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  recording: SessionRecordingService | null = null;

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
  integration: RecordingIntegration | null = null;

  /**
   * The on-disk session lock acquired by a successful resume, or null when no
   * resume holds a lock. Released (and cleared) when a new resume replaces it,
   * when recording is stopped, or when the surface is disposed.
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  currentLockHandle: LockHandle | null = null;

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
  integrationNeedsSubscribe = false;

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
  recordingHistoryVersion = -1;

  async ensureSubscribed(): Promise<void> {
    if (
      !this.integrationNeedsSubscribe &&
      this.recordingHistoryVersion === this.nativeHistory.historyRevision()
    ) {
      return;
    }
    const integration = this.integration;
    if (integration === null) {
      this.integrationNeedsSubscribe = false;
      return;
    }
    if (!this.nativeHistory.hasHistory()) {
      return;
    }
    try {
      this.nativeHistory.subscribeRecording(integration, this.origin);
      this.recordingHistoryVersion = this.nativeHistory.historyRevision();
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
      rejectHistorySubscription(
        error,
        cleanupFailures,
        this.recordingSessionId,
        logger(),
      );
    }
  }

  requireRecording(): SessionRecordingService {
    return requireActiveRecording(this.recording);
  }

  resubscribeIntegration(): Error | undefined {
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
  attachHistory(integration: RecordingIntegration): boolean {
    if (this.nativeHistory.subscribeRecording(integration, this.origin)) {
      this.recordingHistoryVersion = this.nativeHistory.historyRevision();
      return true;
    }
    // No HistoryService yet: the integration is left unsubscribed, so NO
    // subsequent turn is appended until a later start/resume re-attempts the
    // subscription. Left silent this is an invisible continuous-recording
    // loss; warn so it is diagnosable AND flag it for bounded re-attach.
    logger().warn(
      () =>
        `attachHistory: HistoryService unavailable for session ${this.recordingSessionId}; ` +
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
  async releaseRecording(): Promise<void> {
    this.recordingHistoryVersion = -1;
    const integration = this.integration;
    const service = this.recording;
    this.integration = null;
    this.integrationNeedsSubscribe = false;
    this.recording = null;
    const errors = await cleanupSessionResources(integration, service, null);
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
  async releaseLockHandle(): Promise<void> {
    const handle = this.currentLockHandle;
    if (handle === null) {
      return;
    }
    this.currentLockHandle = null;
    await handle.release();
  }

  /**
   * Releases the active recording service and the held session lock, guarding
   * each step so a single failure does not skip the others and rethrowing the
   * first collected failure after all steps run. Shared by stopRecording (the
   * setRecording(false) / pre-resume path) and dispose (agent teardown).
   * @plan:PLAN-20260617-COREAPI.P20
   * @requirement:REQ-010
   */
  async teardownActiveSession(): Promise<void> {
    const errors: unknown[] = [];
    await captureRollbackFailure(errors, () => this.releaseRecording());
    await captureRollbackFailure(errors, () => this.releaseLockHandle());
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Session teardown failed');
    }
  }
  async restoreRecordingHistory(
    priorHistory: readonly IContent[],
    startup: boolean,
    replacementAttempted: boolean,
    priorIntegrationUnsubscribed: boolean,
    failures: unknown[],
  ): Promise<void> {
    if (startup && replacementAttempted) {
      await captureRollbackFailure(failures, () =>
        this.nativeHistory.resetChat(),
      );
    }
    if (replacementAttempted) {
      await captureRollbackFailure(failures, () =>
        this.nativeHistory.setHistory(priorHistory),
      );
    }
    if (priorIntegrationUnsubscribed && this.integration !== null) {
      const integration = this.integration;
      this.integrationNeedsSubscribe = true;
      await captureRollbackFailure(failures, () => {
        this.integrationNeedsSubscribe = !this.attachHistory(integration);
      });
    }
  }
}
