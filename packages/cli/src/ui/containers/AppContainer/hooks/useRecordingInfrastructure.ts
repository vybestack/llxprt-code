/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type {
  RecordingIntegration,
  SessionRecordingPort,
  LockHandle,
  SessionMetadata,
} from '@vybestack/llxprt-code-core';
import type { RecordingSwapCallbacks } from '../../../../services/performResume.js';

export interface UseRecordingInfrastructureResult {
  recordingIntegrationRef?: MutableRefObject<RecordingIntegration | null>;
  recordingSwapCallbacks?: RecordingSwapCallbacks;
}

function createRawResources(
  initialRecordingService?: SessionRecordingPort,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
  onRecordingSwapped?: () => void,
) {
  const recordingServiceRef = { current: initialRecordingService ?? null };
  const recordingIntegrationRef = { current: recordingIntegration ?? null };
  const lockHandleRef = { current: initialLockHandle ?? null };
  const metadataRef: { current: SessionMetadata | null } = { current: null };
  const recordingSwapCallbacks: RecordingSwapCallbacks = {
    getCurrentRecording: () => recordingServiceRef.current,
    getCurrentIntegration: () => recordingIntegrationRef.current,
    getCurrentLockHandle: () => lockHandleRef.current,
    getCurrentMetadata: () => metadataRef.current,
    setRecording: (recording, integration, lock, metadata) => {
      recordingServiceRef.current = recording;
      recordingIntegrationRef.current = integration;
      lockHandleRef.current = lock;
      metadataRef.current = metadata;
      onRecordingSwapped?.();
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
  initialRecordingService?: SessionRecordingPort,
  recordingIntegration?: RecordingIntegration,
  initialLockHandle?: LockHandle | null,
  recordingOwner?: 'agent' | 'raw',
): UseRecordingInfrastructureResult {
  const [, setRevision] = useState(0);
  const rawRef = useRef<ReturnType<typeof createRawResources> | undefined>(
    undefined,
  );
  if (recordingOwner === 'agent') rawRef.current = undefined;
  else
    rawRef.current ??= createRawResources(
      initialRecordingService,
      recordingIntegration,
      initialLockHandle,
      () => setRevision((value) => value + 1),
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
