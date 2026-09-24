/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dispose-time teardown helpers extracted from agentImpl.ts to keep that module
 * under the project's max-lines limit. Config owns extension teardown; adopting
 * sessions release only their own resources.
 *
 * @plan:PLAN-20260617-COREAPI.P24
 * @requirement:REQ-016
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { OAuthManager } from '@vybestack/llxprt-code-providers/auth.js';
import type { OwnershipRecord } from './agentBootstrap.js';
import type { SessionSchedulerOwner } from './agentRuntimeAssembly.js';
import type { NewControls } from './control/newControls.js';
import type { HookControl } from './control/hooks.js';
import type { LoopHolder } from './loop/rebuildLoop.js';
import { AggregateDisposeError } from './disposeErrors.js';

type CleanupAction = () => void | Promise<void>;

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

async function captureFailure(
  errors: unknown[],
  action: CleanupAction,
): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    errors.push(error);
  }
}

function captureSynchronousFailure(
  errors: unknown[],
  action: () => void,
): void {
  try {
    action();
  } catch (error: unknown) {
    errors.push(error);
  }
}

export interface AgentOwnedResourceReleaseInput {
  readonly ownership: OwnershipRecord;
  readonly loopHolder: LoopHolder;
  readonly hooks: Pick<HookControl, 'detach'>;
  readonly controls: Pick<NewControls, 'dispose'>;
  readonly schedulerOwner: SessionSchedulerOwner;
  readonly runtimeHandle: { cleanup: CleanupAction };
  readonly config: Config;
  readonly oauthManager: OAuthManager;
}

/** Releases every facade-owned resource without allowing one failure to skip another. */
export async function releaseAgentOwnedResources(
  input: AgentOwnedResourceReleaseInput,
): Promise<void> {
  const errors: unknown[] = [];
  const { ownership } = input;

  for (const handle of ownership.injectedSchedulerHandles) {
    await captureFailure(errors, () => handle.dispose());
  }
  captureSynchronousFailure(errors, () => input.hooks.detach());
  captureSynchronousFailure(errors, () => input.controls.dispose());
  for (const unsubscribe of input.loopHolder.subscriptions ?? []) {
    captureSynchronousFailure(errors, unsubscribe);
  }

  await captureFailure(errors, () => input.schedulerOwner.dispose());
  captureSynchronousFailure(errors, () => ownership.approvalBus.dispose());
  await captureFailure(errors, () => input.runtimeHandle.cleanup());

  if (ownership.configOwnership !== 'caller') {
    await captureFailure(errors, () => input.config.dispose());
    await captureFailure(errors, async () => {
      await input.config.shutdownLspService();
      ownership.lspShutDown = true;
    });

    ownership.extensionsDisposed = true;
  }

  for (const lock of ownership.sessionLocks) {
    await captureFailure(errors, () => lock.release());
  }
  ownership.sessionLocksReleased = true;
  await captureFailure(errors, () => disposeOAuthManager(input.oauthManager));

  if (errors.length > 0) {
    throw new AggregateDisposeError(errors);
  }
}
