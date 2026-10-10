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
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { SessionPersistenceService } from '@vybestack/llxprt-code-core/storage/SessionPersistenceService.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

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
  resolveClient: () => AgentClientContract,
): Promise<{
  client: AgentClientContract;
  priorHistory: readonly IContent[];
  integration: RecordingIntegration;
}> {
  try {
    const client = resolveClient();
    const priorHistory = await client.getHistory();
    const integration = new RecordingIntegration(recording, persistence);
    return { client, priorHistory, integration };
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
