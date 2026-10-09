/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { tmpdir } from 'node:os';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeProviderToolset } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import { HookEventName } from '@vybestack/llxprt-code-core/hooks/types.js';
import {
  PendingAwareResponsesDiskTextRows,
  sourcePendingMembership,
} from './source-pending-selection.js';
import { fireBeforeModelSnapshotHook } from './beforeModelHookFire.js';

export interface SourceBeforeModelInput {
  readonly config: AgentRuntimeContext['providerRuntime']['config'];
  readonly snapshot: ProviderRequestSnapshot;
  readonly pending: IContent | IContent[];
  readonly model: string;
  readonly tools: RuntimeProviderToolset | undefined;
  readonly signal?: AbortSignal;
  readonly log: (message: string) => void;
}

/** Takes ownership of the input snapshot, even when a command or boundary fails. */
export async function sourceBeforeModelHook(
  input: SourceBeforeModelInput,
): Promise<PendingAwareResponsesDiskTextRows> {
  const system =
    input.config?.getEnableHooks() === true
      ? input.config.getHookSystem()
      : undefined;
  if (
    system === undefined ||
    system.getRegistry().getHooksForEvent(HookEventName.BeforeModel).length ===
      0
  )
    return new PendingAwareResponsesDiskTextRows(
      input.snapshot,
      sourcePendingMembership(input.snapshot),
    );
  try {
    const pending = Array.isArray(input.pending)
      ? input.pending
      : [input.pending];
    const boundary = await fireBeforeModelSnapshotHook({
      configForHooks: input.config,
      requestContents: input.snapshot,
      rawPending: {
        count: pending.length,
        async *openReader(signal) {
          for (const row of pending) {
            signal?.throwIfAborted();
            yield row;
          }
        },
      },
      model: input.model,
      tools: input.tools ?? [],
      root: tmpdir(),
      signal: input.signal,
      log: input.log,
    });
    return new PendingAwareResponsesDiskTextRows(
      {
        count: boundary.contents.count,
        openReader: (signal) => boundary.contents.openReader(signal),
        close: () => boundary.close(),
      },
      boundary.pendingSelection === undefined
        ? undefined
        : Object.freeze({
            kind: 'hook-recovered-input',
            rows: boundary.pendingSelection,
          }),
    );
  } finally {
    input.snapshot.close();
  }
}
