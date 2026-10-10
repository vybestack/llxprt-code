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
import type { SessionMediaOwner } from '@vybestack/llxprt-code-core/storage/session-media-owner.js';
import type { OwnershipRecord } from './agentBootstrap.js';

/**
 * Defensively disposes an OAuthManager if it exposes a dispose method. The
 * runtime context cleanup (dispose.md line 55) normally owns this teardown; this
 * guard covers managers that are not torn down there.
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 * @pseudocode dispose.md 90-92
 */
export async function disposeOAuthManager(
  manager: OAuthManager,
): Promise<void> {
  const holder = manager as unknown as {
    dispose?: () => Promise<void> | void;
  };
  if (typeof holder.dispose === 'function') {
    await holder.dispose();
  }
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

export async function cancelAndJoinMcp(
  authentication: { cancelAndJoin(): Promise<void> },
  ownership: Pick<OwnershipRecord, 'disposeMcpRuntime'>,
  errors: unknown[],
): Promise<void> {
  const stopping = collectDisposalError(errors, () =>
    ownership.disposeMcpRuntime?.(),
  );
  const authenticating = collectDisposalError(errors, () =>
    authentication.cancelAndJoin(),
  );
  await Promise.all([stopping, authenticating]);
}

export async function joinAgentWork(
  agent: {
    profiles: { cancelAndJoin(): Promise<void> };
    mcp: { cancelAndJoin(): Promise<void> };
  },
  tasks: { hasPendingWork(): boolean; join(): Promise<void> },
  ownership: Pick<OwnershipRecord, 'disposeMcpRuntime'>,
  errors: unknown[],
): Promise<void> {
  const joinedTasks = collectDisposalError(errors, () => tasks.join());
  const stopMcp = (): Promise<void> =>
    collectDisposalError(errors, () => ownership.disposeMcpRuntime?.());
  const stopping = tasks.hasPendingWork()
    ? joinedTasks.then(stopMcp)
    : stopMcp();
  const authenticating = collectDisposalError(errors, () =>
    agent.mcp.cancelAndJoin(),
  );
  const replacing = collectDisposalError(errors, () =>
    agent.profiles.cancelAndJoin(),
  );
  await Promise.all([joinedTasks, stopping, authenticating, replacing]);
}

export async function disposeConfigInfrastructure(
  ownership: OwnershipRecord,
  mediaOwner: SessionMediaOwner | undefined,
  errors: unknown[],
): Promise<void> {
  if (ownership.configOwnership !== 'caller')
    await collectDisposalError(errors, () => ownership.config.dispose());
  await collectDisposalError(errors, () => mediaOwner?.dispose());
  if (ownership.configOwnership !== 'caller') {
    await collectDisposalError(errors, async () => {
      ownership.lspShutDown = true;
    });
  }
}

export async function disposeAgentObservers(
  ownership: OwnershipRecord,
  hooks: { detach(): void },
  controls: { dispose(): Promise<void> | void },
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
  for (const handle of ownership.injectedSchedulerHandles) {
    await collectDisposalError(errors, () => handle.dispose());
  }

  // @pseudocode dispose.md 50-52: unsubscribe every recorded bus subscription
  // and detach the hooks control's shared-MessageBus subscriptions, driving
  // the bus emitter's listener tally to its post-dispose baseline (zero).
  collectSyncDisposalError(errors, () => {
    hooks.detach();
  });
  await collectDisposalError(errors, () => controls.dispose());
  const subs = subscriptions;
  if (subs !== undefined) {
    for (const unsubscribe of subs) {
      collectSyncDisposalError(errors, () => {
        unsubscribe();
      });
    }
  }
}

export async function releaseAgentFinalResources(
  locks: {
    readonly sessionLocks: ReadonlyArray<{ release(): Promise<void> | void }>;
    sessionLocksReleased?: boolean;
  },
  oauthManager: OAuthManager,
  errors: unknown[],
): Promise<void> {
  for (const lock of locks.sessionLocks)
    await collectDisposalError(errors, () => lock.release());
  locks.sessionLocksReleased = true;
  await collectDisposalError(errors, () => disposeOAuthManager(oauthManager));
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
  hooks: { finishSessionEnd(): Promise<void> },
  client: { disposeHooks(): Promise<void> },
  errors: unknown[],
): Promise<void> {
  await collectDisposalError(errors, () => hooks.finishSessionEnd());
  await collectDisposalError(errors, () => client.disposeHooks());
}
