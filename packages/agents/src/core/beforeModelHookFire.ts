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

import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { HookModelSnapshotOutput } from '@vybestack/llxprt-code-core/hooks/hookSnapshotAggregator.js';
import type { HookModelRowsInput } from '@vybestack/llxprt-code-core/hooks/hookModelInputStream.js';
import {
  resolvePendingBoundarySnapshot,
  type BoundarySnapshotResult,
} from './boundary-recovery-snapshot.js';
import {
  AgentExecutionStoppedError,
  AgentExecutionBlockedError,
} from './chatSession.js';
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
    model,
    contents: requestContents,
    ...(tools !== undefined ? { tools } : {}),
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

export interface BeforeModelSnapshotHookOptions
  extends Pick<
    BeforeModelHookFireOptions,
    'configForHooks' | 'model' | 'tools' | 'log'
  > {
  readonly requestContents: ProviderRequestRows;
  readonly rawPending: ProviderRequestRows;
  readonly root: string;
  readonly signal?: AbortSignal;
}

function enforceSnapshotDecision(
  output: HookModelSnapshotOutput | undefined,
): void {
  if (output?.shouldStopExecution() === true)
    throw new AgentExecutionStoppedError(output.getEffectiveReason());
  if (output?.isBlockingDecision() === true) {
    const reason = output.getEffectiveReason();
    throw new AgentExecutionBlockedError(reason, {
      content: { speaker: 'ai', blocks: [{ type: 'text', text: reason }] },
      finishReason: 'stop',
      rawStopReason: reason || undefined,
    });
  }
}

/** Returned selections own disk copies independently of the hook command output. */
export async function fireBeforeModelSnapshotHook(
  options: BeforeModelSnapshotHookOptions,
): Promise<BoundarySnapshotResult> {
  options.signal?.throwIfAborted();
  const config = options.configForHooks;
  const system =
    config?.getEnableHooks() === true ? config.getHookSystem() : undefined;
  if (system === undefined) {
    return resolvePendingBoundarySnapshot({
      before: options.requestContents,
      after: options.requestContents,
      rawPending: options.rawPending,
      root: options.root,
      signal: options.signal,
    });
  }
  await system.initialize(options.signal);
  const hook = await system.fireBeforeModelSnapshotEvent(
    {
      model: options.model,
      contents: options.requestContents,
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
    },
    options.signal,
  );
  let resolved: BoundarySnapshotResult | undefined;
  try {
    enforceSnapshotDecision(hook.finalOutput);
    if (!hook.success)
      throw new AggregateError(
        hook.errors,
        `Source BeforeModel hook execution failed: ${hook.errors.map((error) => error.message).join('; ')}`,
      );
    const target: HookModelRowsInput['llm_request'] = {
      version: 2,
      model: options.model,
      contents: options.requestContents,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    };
    hook.finalOutput?.assertTextRequest(target);
    const request = hook.finalOutput?.applyRequestRows(target);
    // The eager caller discards explicit empty contents despite the documented
    // replacement contract. Reject that incompatible override before transport.
    if (request?.contents.count === 0 && request.contents !== target.contents)
      throw new Error(
        'Unsupported source BeforeModel hook output: empty contents replacement conflicts with eager request semantics',
      );
    resolved = await resolvePendingBoundarySnapshot({
      before: options.requestContents,
      after: request?.contents ?? options.requestContents,
      rawPending: options.rawPending,
      boundary: hook.finalOutput?.readValue([
        'hookSpecificOutput',
        'llm_request_boundary',
      ]),
      root: options.root,
      signal: options.signal,
    });
    options.log(
      `[BeforeModelSnapshot] Pending boundary classification=${resolved.classification} recovered=${resolved.pendingSelection !== undefined}`,
    );
    return resolved;
  } catch (error) {
    resolved?.close();
    throw error;
  } finally {
    hook.close();
  }
}
