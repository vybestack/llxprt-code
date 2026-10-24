/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fire the BeforeModel hook against the disk-backed request rows and resolve
 * the pending-content boundary against the hook's decision.
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
import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { RuntimeProviderToolset as ProviderToolset } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';

export interface BeforeModelSnapshotHookOptions {
  readonly owner?: HookExecutionOwner;
  readonly model: string;
  readonly tools: ProviderToolset | undefined;
  /** Receives diagnostic log lines (debug level). */
  readonly log: (message: string) => void;
  readonly requestContents: ProviderRequestRows;
  readonly rawPending: ProviderRequestRows;
  readonly root: string | (() => string);
  readonly signal?: AbortSignal;
}

function enforceSnapshotDecision(
  output: HookModelSnapshotOutput | undefined,
): void {
  if (output?.shouldStopExecution() === true) {
    throw new AgentExecutionStoppedError(
      output.getEffectiveReason(),
      output.readSystemMessage(),
    );
  }
  if (output?.isBlockingDecision() === true) {
    const reason = output.getEffectiveReason();
    throw new AgentExecutionBlockedError(reason, {
      content: { speaker: 'ai', blocks: [{ type: 'text', text: reason }] },
      finishReason: 'stop',
      rawStopReason: reason || undefined,
    });
  }
}

/**
 * Returned selections own disk copies independently of the hook command output.
 * Resolves `undefined` when the owner reports that hooks are disabled or no
 * BeforeModel hook is registered, so the caller keeps its unmodified selection
 * without copying the request to disk.
 */
export async function fireBeforeModelSnapshotHook(
  options: BeforeModelSnapshotHookOptions,
): Promise<BoundarySnapshotResult | undefined> {
  options.signal?.throwIfAborted();
  const hook = await options.owner?.beforeModelSnapshot?.(
    {
      model: options.model,
      contents: options.requestContents,
      ...(options.tools !== undefined ? { tools: options.tools } : {}),
    },
    options.signal,
  );
  if (hook === undefined) return undefined;
  let resolved: BoundarySnapshotResult | undefined;
  try {
    options.signal?.throwIfAborted();
    enforceSnapshotDecision(hook.finalOutput);
    // Execution failures are non-blocking, as on the eager route and for
    // AfterModel. The stop/block decision above still applies; otherwise the
    // request goes out unmodified.
    if (!hook.success) {
      options.log(
        `[BeforeModelSnapshot] BeforeModel hook failed (non-blocking): ${hook.errors.map((error) => error.message).join('; ')}`,
      );
      return undefined;
    }
    const target: HookModelRowsInput['llm_request'] = {
      version: 2,
      model: options.model,
      contents: options.requestContents,
      ...(options.tools === undefined ? {} : { tools: options.tools }),
    };
    hook.finalOutput?.assertTextRequest();
    const request = hook.finalOutput?.applyRequestRows(target);
    // The eager caller discards explicit empty contents: an empty array would
    // erase the conversation, so it means "no modification" on both routes.
    const replaced =
      request === undefined || request.contents.count === 0
        ? options.requestContents
        : request.contents;
    if (replaced === options.requestContents) {
      options.log(
        '[BeforeModelSnapshot] Pending boundary classification=unchanged recovered=true',
      );
      return {
        classification: 'unchanged',
        contents: options.requestContents,
        pendingSelection: options.rawPending,
        close: () => undefined,
      };
    }
    resolved = await resolvePendingBoundarySnapshot({
      before: options.requestContents,
      after: replaced,
      rawPending: options.rawPending,
      boundary: hook.finalOutput?.readValue([
        'hookSpecificOutput',
        'llm_request_boundary',
      ]),
      root: typeof options.root === 'function' ? options.root() : options.root,
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
