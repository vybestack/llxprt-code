/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fire the BeforeModel hook and resolve the pending-content boundary against
 * the hook's decision. Extracted from StreamProcessor so it stays
 * unit-testable and StreamProcessor stays under its max-lines limit (same
 * precedent as resolvePendingBoundaryFromHook in boundaryRecovery.ts).
 */

import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { RuntimeProviderToolset as ProviderToolset } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  resolvePendingBoundaryFromHook,
  snapshotContents,
} from './boundaryRecovery.js';
import { enforceBeforeModelHookDecision } from './beforeModelHookDecision.js';
import { applyRequestModifications } from './streamRequestHelpers.js';

/** Result of firing the BeforeModel hook (contents + pending-contents resolution). */
export interface BeforeModelHookFireResult {
  contents: IContent[];
  pendingContents: IContent[] | undefined;
}

/** Inputs to fireBeforeModelHook. */
export interface BeforeModelHookFireOptions {
  configForHooks: AgentRuntimeContext['providerRuntime']['config'];
  requestContents: IContent[];
  pendingUserIContents: IContent[];
  tools: ProviderToolset | undefined;
  hookRestrictedAllowedTools: string[] | undefined;
  /** Current model name, used for hook modification translation. */
  model: string;
  /** Receives diagnostic log lines (debug level). */
  log: (message: string) => void;
}

/**
 * Fire BeforeModel hook and resolve the pending boundary against the
 * hook's decision; throws on stop/block. No-op passthrough when hooks are
 * disabled or no hook system is configured.
 */
export async function fireBeforeModelHook(
  options: BeforeModelHookFireOptions,
): Promise<BeforeModelHookFireResult> {
  const {
    configForHooks,
    requestContents,
    pendingUserIContents,
    tools,
    hookRestrictedAllowedTools,
    model,
    log,
  } = options;
  // Hooks disabled / no hook system: no snapshot (differential recovery
  // falls back to reference equality), but the boundary resolver still runs
  // so the caller-boundary diagnostic fires on this path too (parity with
  // the pre-extraction StreamProcessor ordering).
  const passthrough = (): BeforeModelHookFireResult => ({
    contents: requestContents,
    pendingContents: resolvePendingBoundaryFromHook(
      requestContents,
      requestContents,
      pendingUserIContents,
      undefined,
      log,
    ),
  });
  if (
    configForHooks === undefined ||
    typeof configForHooks.getEnableHooks !== 'function' ||
    configForHooks.getEnableHooks() !== true
  ) {
    return passthrough();
  }
  const hookSystem =
    typeof configForHooks.getHookSystem === 'function'
      ? configForHooks.getHookSystem()
      : undefined;
  if (hookSystem === undefined) return passthrough();

  await hookSystem.initialize();
  // Capture a projection snapshot BEFORE firing the hook so in-place
  // mutations (hooks that mutate the live array/elements and return no
  // llm_request) are detected by differential recovery (G1, issue #2306).
  const snapshot = snapshotContents(requestContents);
  const beforeModelResult = await hookSystem.fireBeforeModelEvent({
    contents: requestContents,
    tools,
  });

  enforceBeforeModelHookDecision(beforeModelResult, hookRestrictedAllowedTools);

  const contents = applyRequestModifications(
    beforeModelResult,
    requestContents,
    model,
  );
  const pendingContents = resolvePendingBoundaryFromHook(
    requestContents,
    contents,
    pendingUserIContents,
    beforeModelResult ?? undefined,
    log,
    snapshot,
  );
  return { contents, pendingContents };
}
