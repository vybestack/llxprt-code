/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AggregateDisposeError } from './disposeErrors.js';

export type SessionCleanupAction = () => void | Promise<void>;

export interface SessionLifecyclePlan {
  readonly stopAdmissions: readonly SessionCleanupAction[];
  readonly abortActiveAndPending: readonly SessionCleanupAction[];
  readonly cancelAndJoinOwnedWork: readonly SessionCleanupAction[];
  readonly flushRecording: readonly SessionCleanupAction[];
  readonly releaseResources: readonly SessionCleanupAction[];
}

const SHUTDOWN_STAGES: ReadonlyArray<keyof SessionLifecyclePlan> = [
  'stopAdmissions',
  'abortActiveAndPending',
  'cancelAndJoinOwnedWork',
  'flushRecording',
  'releaseResources',
];

function appendFailure(failures: unknown[], failure: unknown): void {
  if (failure instanceof AggregateError) {
    for (const nested of failure.errors) {
      appendFailure(failures, nested);
    }
    return;
  }
  failures.push(failure);
}

async function runStage(
  actions: readonly SessionCleanupAction[],
  failures: unknown[],
): Promise<void> {
  const pending = actions.map((action) => {
    try {
      return Promise.resolve(action());
    } catch (error) {
      return Promise.reject(error);
    }
  });
  const results = await Promise.allSettled(pending);
  for (const result of results) {
    if (result.status === 'rejected') {
      appendFailure(failures, result.reason);
    }
  }
}

/** Coordinates one session's ordered, best-effort shutdown. */
export class SessionLifecycle {
  private disposal: Promise<void> | undefined;
  private closing = false;

  constructor(private readonly plan: SessionLifecyclePlan) {}

  assertAccepting(): void {
    if (this.closing) {
      throw new Error('Session is disposing or disposed');
    }
  }

  dispose(): Promise<void> {
    if (this.disposal !== undefined) {
      return this.disposal;
    }
    this.closing = true;
    let resolveDisposal: (() => void) | undefined;
    let rejectDisposal: ((reason: unknown) => void) | undefined;
    const disposal = new Promise<void>((resolve, reject) => {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });
    this.disposal = disposal;
    void this.runCleanup().then(
      () => resolveDisposal?.(),
      (reason: unknown) => rejectDisposal?.(reason),
    );
    return disposal;
  }

  private async runCleanup(): Promise<void> {
    const failures: unknown[] = [];
    for (const stage of SHUTDOWN_STAGES) {
      await runStage(this.plan[stage], failures);
    }
    if (failures.length > 0) {
      throw new AggregateDisposeError(failures);
    }
  }
}
