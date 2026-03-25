/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useRef } from 'react';
import type {
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
} from '@vybestack/llxprt-code-core';
import type { RecordingSwapCallbacks } from '../../../../services/performResume.js';
import type { SessionMetadata } from '@vybestack/llxprt-code-core';

/**
 * @hook useRecordingInfrastructure
 * @description Recording refs and swap callbacks
 * @inputs initialRecordingService, recordingIntegration, initialLockHandle
 * @outputs recordingServiceRef, recordingIntegrationRef, recordingSwapCallbacks
 * @sideEffects Ref synchronization effects
 * @cleanup Clears refs on unmount
 * @strictMode Safe - ref updates are idempotent
 * @subscriptionStrategy Stable (useRef + useMemo)
 */

export interface UseRecordingInfrastructureResult {
  recordingIntegrationRef: React.MutableRefObject<RecordingIntegration | null>;
  recordingSwapCallbacks: RecordingSwapCallbacks;
}

export function useRecordingInfrastructure(
  initialRecordingService?: SessionRecordingService,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
): UseRecordingInfrastructureResult {
  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P23
   * Recording infrastructure refs for session resume (performResume swap callbacks).
   * These refs hold the current recording service, integration, and lock handle,
   * allowing performResume to swap them during session resume.
   */
  const recordingServiceRef = useRef<SessionRecordingService | null>(
    initialRecordingService ?? null,
  );
  const recordingIntegrationRef = useRef<RecordingIntegration | null>(
    recordingIntegration ?? null,
  );
  const lockHandleRef = useRef<LockHandle | null>(initialLockHandle ?? null);

  // Keep recording refs in sync with props
  useEffect(() => {
    recordingServiceRef.current = initialRecordingService ?? null;
  }, [initialRecordingService]);

  useEffect(() => {
    recordingIntegrationRef.current = recordingIntegration ?? null;
  }, [recordingIntegration]);

  useEffect(() => {
    lockHandleRef.current = initialLockHandle ?? null;
  }, [initialLockHandle]);

  /**
   * @plan PLAN-20260214-SESSIONBROWSER.P23
   * RecordingSwapCallbacks for performResume - provides ref-based access to
   * current recording infrastructure and setters for swapping during resume.
   */
  const recordingSwapCallbacks = useMemo(
    (): RecordingSwapCallbacks => ({
      getCurrentRecording: () => recordingServiceRef.current,
      getCurrentIntegration: () => recordingIntegrationRef.current,
      getCurrentLockHandle: () => lockHandleRef.current,
      setRecording: (
        recording: SessionRecordingService,
        integration: RecordingIntegration,
        lock: LockHandle | null,
        _metadata: SessionMetadata,
      ) => {
        recordingServiceRef.current = recording;
        recordingIntegrationRef.current = integration;
        lockHandleRef.current = lock;
      },
    }),
    [],
  );

  return {
    recordingIntegrationRef,
    recordingSwapCallbacks,
  };
}
