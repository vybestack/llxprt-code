/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { rm } from 'node:fs/promises';
import type { IContent } from '../packages/core/src/services/history/IContent.js';
import type { SessionRecordingService } from '../packages/core/src/recording/SessionRecordingService.js';
import type { HistoryService } from '../packages/core/src/services/history/HistoryService.js';
import type { SessionPersistenceService } from '../packages/core/src/storage/SessionPersistenceService.js';
import type { LocalMediaStore } from '../packages/core/src/storage/local-media-store.js';
import type { RequestMediaResolver } from '../packages/core/src/storage/request-media-resolver.js';
import type { ProviderFileLifecycle } from '../packages/providers/src/providerFilePolicy.js';

export interface OperationOutcome {
  readonly success: boolean;
  readonly error?: unknown;
}

export function settleOperation(
  startOperation: () => Promise<void>,
): Promise<OperationOutcome> {
  try {
    return startOperation().then(
      () => ({ success: true }),
      (error: unknown) => ({ success: false, error }),
    );
  } catch (error) {
    return Promise.resolve({ success: false, error });
  }
}

function combineFailure(current: unknown, next: unknown): unknown {
  return current === undefined ? next : new AggregateError([current, next]);
}

export async function completeTurnResources(
  persistenceSave: Promise<OperationOutcome>,
  release: () => Promise<void>,
  currentFailure: unknown,
): Promise<unknown> {
  let failure = currentFailure;
  const persistenceOutcome = await persistenceSave;
  if (!persistenceOutcome.success) {
    failure = combineFailure(failure, persistenceOutcome.error);
  }
  try {
    await release();
  } catch (error) {
    failure = combineFailure(failure, error);
  }
  return failure;
}

/**
 * Content identity of the single admitted media reference produced by one probe turn.
 * Admission rewrites an inline image into a reference block, so the probe reads the
 * content ID back from that block to prove the turn admitted fresh unique bytes.
 */
export function admittedMediaContentId(
  content: IContent,
  turn: number,
): string {
  const block = content.blocks.find((candidate) => candidate.type === 'media');
  if (block?.type !== 'media' || block.encoding !== 'reference') {
    throw new Error(`Media probe turn ${turn} did not admit a media reference`);
  }
  return block.contentId;
}

export async function cleanupAll(
  cleanupSteps: ReadonlyArray<() => void | Promise<void>>,
  currentFailure: unknown,
): Promise<unknown> {
  let failure = currentFailure;
  for (const cleanup of cleanupSteps) {
    try {
      await cleanup();
    } catch (error) {
      failure = combineFailure(failure, error);
    }
  }
  return failure;
}
export interface MediaProbeResources {
  readonly directory: string;
  store?: LocalMediaStore;
  history?: HistoryService;
  resolver?: RequestMediaResolver;
  recording?: SessionRecordingService;
  persistence?: SessionPersistenceService;
  providerRetention?: ProviderFileLifecycle;
}

export async function cleanupMediaProbeResources(
  resources: MediaProbeResources,
  currentFailure: unknown,
): Promise<unknown> {
  const cleanupSteps: Array<() => void | Promise<void>> = [];
  const history = resources.history;
  if (history !== undefined) cleanupSteps.push(() => history.clear());
  const resolver = resources.resolver;
  if (resolver !== undefined) {
    cleanupSteps.push(async () => {
      await resolver.recoverPendingReleases();
    });
  }
  const providerRetention = resources.providerRetention;
  if (providerRetention !== undefined) {
    cleanupSteps.push(async () => {
      await providerRetention.cleanupScope('session', 'media-probe-session');
    });
  }
  const recording = resources.recording;
  if (recording !== undefined) {
    cleanupSteps.push(() => recording.dispose());
  }
  const persistence = resources.persistence;
  if (persistence !== undefined) {
    cleanupSteps.push(() => {
      const pendingBytes = persistence.getPendingByteCount();
      if (pendingBytes !== 0) {
        throw new Error(
          `Media probe cleanup found ${pendingBytes} pending persistence queue bytes`,
        );
      }
    });
  }
  const store = resources.store;
  if (store !== undefined) cleanupSteps.push(() => store.close());
  cleanupSteps.push(() =>
    rm(resources.directory, { recursive: true, force: true }),
  );
  return cleanupAll(cleanupSteps, currentFailure);
}

export function describeProcessFailure(
  runtime: string,
  status: number | null,
  signal: NodeJS.Signals | null,
  stderr: string,
): string {
  const termination =
    signal === null
      ? `exited with status ${String(status)}`
      : `was terminated by signal ${signal}`;
  return `${runtime} media memory target ${termination}: ${stderr}`;
}
