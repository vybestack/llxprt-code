/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, type MutableRefObject } from 'react';
import type {
  RecordingIntegration,
  SessionRecordingService,
  LockHandle,
} from '@vybestack/llxprt-code-core';
import type { RecordingSwapCallbacks } from '../../../../services/performResume.js';

export interface UseRecordingInfrastructureResult {
  recordingIntegrationRef?: MutableRefObject<RecordingIntegration | null>;
  recordingSwapCallbacks?: RecordingSwapCallbacks;
}

function createRawResources(
  initialRecordingService?: SessionRecordingService,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
) {
  const recordingServiceRef = { current: initialRecordingService ?? null };
  const recordingIntegrationRef = { current: recordingIntegration ?? null };
  const lockHandleRef = { current: initialLockHandle ?? null };
  const recordingSwapCallbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recordingServiceRef.current,
    getCurrentIntegration: () => recordingIntegrationRef.current,
    getCurrentLockHandle: () => lockHandleRef.current,
    setRecording: (recording, integration, lock) => {
      recordingServiceRef.current = recording;
      recordingIntegrationRef.current = integration;
      lockHandleRef.current = lock;
    },
  };
  return {
    recordingServiceRef,
    recordingIntegrationRef,
    lockHandleRef,
    recordingSwapCallbacks,
  };
}

export function useRecordingInfrastructure(
  initialRecordingService?: SessionRecordingService,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
  recordingOwner?: 'agent' | 'raw',
): UseRecordingInfrastructureResult {
  const rawRef = useRef<ReturnType<typeof createRawResources> | undefined>(
    undefined,
  );
  if (recordingOwner === 'agent') rawRef.current = undefined;
  else
    rawRef.current ??= createRawResources(
      initialRecordingService,
      recordingIntegration,
      initialLockHandle,
    );
  const raw = rawRef.current;

  useEffect(() => {
    if (raw) raw.recordingServiceRef.current = initialRecordingService ?? null;
  }, [raw, initialRecordingService]);
  useEffect(() => {
    if (raw) raw.recordingIntegrationRef.current = recordingIntegration ?? null;
  }, [raw, recordingIntegration]);
  useEffect(() => {
    if (raw) raw.lockHandleRef.current = initialLockHandle ?? null;
  }, [raw, initialLockHandle]);

  return {
    recordingIntegrationRef: raw?.recordingIntegrationRef,
    recordingSwapCallbacks: raw?.recordingSwapCallbacks,
  };
}
