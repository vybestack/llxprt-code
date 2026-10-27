import {
  SessionLifecycle,
  type SessionCleanupAction,
} from './sessionLifecycle.js';
import { AggregateDisposeError } from './disposeErrors.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dispose-time teardown helpers extracted from agentImpl.ts to keep that module
 * under the project's max-lines limit. These are pure structural guards over
 * the OAuthManager; they hold no state.
 *
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */

import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';

/**
 * Disposes the required OAuth manager.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 90-92
 */
export async function disposeOAuthManager(
  manager: OAuthManager,
): Promise<void> {
  await manager.dispose();
}

/**
 * Awaits fn and pushes any throw/rejection into the errors accumulator so the
 * teardown continues. Never rethrows mid-teardown.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 110-113
 */
export async function collectDisposalError(
  errors: unknown[],
  fn: () => Promise<void> | void,
): Promise<void> {
  try {
    await fn();
  } catch (e: unknown) {
    errors.push(e);
  }
}

/**
 * Synchronous variant of {@link safe} for non-awaitable teardown steps
 * (unsubscribe / detach). Pushes any throw into the errors accumulator.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 110-113
 */
export function collectSyncDisposalError(
  errors: unknown[],
  fn: () => void,
): void {
  try {
    fn();
  } catch (e: unknown) {
    errors.push(e);
  }
}

export async function joinAgentWork(
  cancelAndJoinProfiles: () => Promise<void>,
  cancelAndJoinMcpAuth: () => Promise<void>,
  joinTasks: () => Promise<void>,
  errors: unknown[],
): Promise<void> {
  await Promise.all([
    collectDisposalError(errors, joinTasks),
    collectDisposalError(errors, cancelAndJoinMcpAuth),
    collectDisposalError(errors, cancelAndJoinProfiles),
  ]);
}

export async function disposeConfigInfrastructure(
  disposeConfig: (() => Promise<void>) | undefined,
  disposeMedia: (() => Promise<void>) | undefined,
  errors: unknown[],
): Promise<void> {
  await collectDisposalError(errors, () => disposeConfig?.());
  await collectDisposalError(errors, () => disposeMedia?.());
}

export async function disposeAgentObservers(
  schedulers: ReadonlyArray<{ dispose(): Promise<void> | void }>,
  detachHooks: () => void,
  disposeControls: () => Promise<void> | void,
  subscriptions: ReadonlyArray<() => void> | undefined,
  errors: unknown[],
): Promise<void> {
  // @pseudocode dispose.md 40-47: CONDITIONAL T19 teardown. Dispose every
  // scheduler handle created via the caller-injected toolSchedulerFactory and
  // retained by the facade. Each handle backs BOTH the conceptual scheduler
  // (40-42) and coordinator (45-47) rows — the injected recording fake exposes
  // a single handle whose `disposed` flag covers both — so each is disposed
  // exactly ONCE here (no double-dispose). The caller-owned factory FUNCTION is
  // never disposed. Per-turn loop schedulers stay owned + disposed by
  // AgenticLoop scheduler owner — dispose() does NOT touch them. A
  // failing handle's rejection is collected into errors → AggregateDisposeError.
  for (const handle of schedulers) {
    await collectDisposalError(errors, () => handle.dispose());
  }

  // @pseudocode dispose.md 50-52: unsubscribe every recorded bus subscription
  // and detach the hooks control's shared-MessageBus subscriptions, driving
  // the bus emitter's listener tally to its post-dispose baseline (zero).
  collectSyncDisposalError(errors, () => {
    detachHooks();
  });
  await collectDisposalError(errors, disposeControls);
  const subs = subscriptions;
  if (subs !== undefined) {
    for (const unsubscribe of subs) {
      collectSyncDisposalError(errors, () => {
        unsubscribe();
      });
    }
  }
}

export async function joinCapturedRun(
  run: { close(): Promise<void>; readonly finished: Promise<void> } | undefined,
  errors: unknown[],
): Promise<void> {
  if (run === undefined) return;
  await collectDisposalError(errors, () => run.close());
  await collectDisposalError(errors, () => run.finished);
}

export async function finishOwnedHooks(
  finishSessionEnd: () => Promise<void>,
  disposeHooks: () => Promise<void>,
  errors: unknown[],
): Promise<void> {
  await collectDisposalError(errors, finishSessionEnd);
  await collectDisposalError(errors, disposeHooks);
}

export function assembleAgentShutdown(
  stopAdmissions: readonly SessionCleanupAction[],
  beginAdmissionJoins: readonly SessionCleanupAction[],
  abortActiveAndPending: readonly SessionCleanupAction[],
  beginAbortJoins: readonly SessionCleanupAction[],
  joinOwnedWork: (errors: unknown[]) => Promise<void>,
  joinRun: (errors: unknown[]) => Promise<void>,
  joinProfiles: () => Promise<void>,
  flushRecording: (errors: unknown[]) => Promise<void>,
  releaseResources: (errors: unknown[]) => Promise<void>,
): SessionLifecycle {
  const errors: unknown[] = [];
  const pending: Array<Promise<void>> = [];
  const start = (action: SessionCleanupAction): void => {
    pending.push(collectDisposalError(errors, action));
  };
  return new SessionLifecycle({
    stopAdmissions: [
      ...stopAdmissions,
      ...beginAdmissionJoins.map((action) => () => start(action)),
    ],
    abortActiveAndPending: [
      ...abortActiveAndPending,
      ...beginAbortJoins.map((action) => () => start(action)),
    ],
    cancelAndJoinOwnedWork: [
      () => joinOwnedWork(errors),
      () => joinRun(errors),
      () => collectDisposalError(errors, joinProfiles),
      async () => {
        await Promise.all(pending);
      },
    ],
    flushRecording: [() => flushRecording(errors)],
    releaseResources: [
      async () => {
        await releaseResources(errors);
        if (errors.length > 0) throw new AggregateDisposeError(errors);
      },
    ],
  });
}

export async function disposeWorkspaceFacades(
  disposeSkills: () => Promise<void>,
  disposeWorkspace: () => Promise<void>,
): Promise<void> {
  const results = await Promise.allSettled([
    disposeSkills(),
    disposeWorkspace(),
  ]);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'Workspace facade cleanup failed');
}
