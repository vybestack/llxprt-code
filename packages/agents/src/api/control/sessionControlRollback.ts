/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  withRecordingFailureReport,
  type LockHandle,
  type RecordingIntegration,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import type { SessionNativeHistory } from './session-history-observation.js';
import { requireActiveRecording } from './journalRecordingLifecycle.js';
import {
  recordSessionEvent,
  type SessionRecordingEvent,
} from './recordSessionEvent.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
function logger(): DebugLogger {
  return new DebugLogger('llxprt:agents:session-control');
}

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
  recording: SessionRecordingPort | null,
  lockHandle: LockHandle | null,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  if (integration !== null) {
    await captureRollbackFailure(failures, () =>
      withRecordingFailureReport(integration.dispose()),
    );
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
  readonly recording: SessionRecordingPort;
  readonly lockHandle: LockHandle;
}): Promise<unknown[]> {
  return cleanupSessionResources(
    input.integration,
    input.recording,
    input.lockHandle,
  );
}

export async function cleanupPreviousSession(
  integration: RecordingIntegration | null,
  recording: SessionRecordingPort | null,
  lock: LockHandle | null,
): Promise<void> {
  const failures = await cleanupSessionResources(integration, recording, lock);
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Previous session cleanup failed after adoption',
    );
}

export function adoptRecordingSessionId(
  readSessionId: () => string,
  adoptSessionId: (sessionId: string) => void,
  sessionIdentityOwnership: 'config' | 'facade',
  priorSessionId: string,
  recording: SessionRecordingPort,
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

export class SessionRecordingLifetime {
  recordingHistoryVersion = -1;
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
  recording: SessionRecordingPort | null = null;

  async flush(): Promise<void> {
    await this.ensureSubscribed();
    await this.integration?.flushAtTurnBoundary();
  }

  async recordEvent(event: SessionRecordingEvent): Promise<void> {
    await this.ensureSubscribed();
    await recordSessionEvent(this.integration, event, (descriptor, message) => {
      const history = this.nativeHistory.getHistoryService();
      if (history === null) throw new Error('Session history unavailable');
      return history.appendDisplay(descriptor, message, this.origin);
    });
    await this.integration?.flushAtTurnBoundary();
  }

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
    const historyService = this.nativeHistory.getHistoryService();
    if (historyService === null) {
      return;
    }
    try {
      await integration.subscribeToJournal(historyService, this.origin);
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
      logger().warn(
        () =>
          `ensureSubscribed: re-attach failed for session ${this.recordingSessionId}; ` +
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

  requireRecording(): SessionRecordingPort {
    return requireActiveRecording(this.recording);
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
  async attachHistory(integration: RecordingIntegration): Promise<boolean> {
    const historyService = this.nativeHistory.getHistoryService();
    if (historyService !== null) {
      await integration.subscribeToJournal(historyService, this.origin);
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
}
