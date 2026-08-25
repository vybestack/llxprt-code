/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type LockHandle,
  type RecordingIntegration,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';

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
