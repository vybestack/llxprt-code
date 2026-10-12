/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  RecordingIntegration,
  withRecordingFailureReport,
  type LockHandle,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';

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
  readonly recording: SessionRecordingService;
  readonly lockHandle: LockHandle;
}): Promise<unknown[]> {
  return cleanupSessionResources(
    input.integration,
    input.recording,
    input.lockHandle,
  );
}

export function adoptRecordingSessionId(
  config: Config,
  sessionIdentityOwnership: 'config' | 'facade',
  priorSessionId: string,
  recording: SessionRecordingService,
  beforeAdoption: () => void,
): void {
  if (sessionIdentityOwnership === 'facade') return;
  const configId = config.getSessionId();
  if (configId !== priorSessionId) {
    throw new Error(
      `Cannot adopt recording session ${recording.getSessionId()}: shared Config session ${configId} does not belong to facade recording session ${priorSessionId}`,
    );
  }
  beforeAdoption();
  config.adoptSessionId(recording.getSessionId());
}

export async function restoreConfigSessionId(
  config: Config,
  sessionIdentityOwnership: 'config' | 'facade',
  priorSessionId: string,
  adoptionAttempted: boolean,
  failures: unknown[],
): Promise<void> {
  if (sessionIdentityOwnership === 'facade') return;
  if (adoptionAttempted && config.getSessionId() !== priorSessionId) {
    await captureRollbackFailure(failures, () =>
      config.adoptSessionId(priorSessionId),
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
