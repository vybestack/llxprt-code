/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import type { HookExecutionOwner } from '@vybestack/llxprt-code-core/hooks/hookEventHandler.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSnapshot } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { RuntimeProviderToolset } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProviderChat.js';
import {
  pendingAwareRequestSelection,
  type PendingAwareRequestSelection,
  sourcePendingMembership,
} from './source-pending-selection.js';
import { fireBeforeModelSnapshotHook } from './beforeModelHookFire.js';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

export interface SourceBeforeModelInput {
  readonly owner: HookExecutionOwner | undefined;
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
): Promise<PendingAwareRequestSelection> {
  const unmodified = (): PendingAwareRequestSelection =>
    pendingAwareRequestSelection(
      input.snapshot,
      sourcePendingMembership(input.snapshot),
    );
  if (input.owner?.beforeModelSnapshot === undefined) return unmodified();
  let snapshotKept = false;
  try {
    const pending = Array.isArray(input.pending)
      ? input.pending
      : [input.pending];
    const boundary = await fireBeforeModelSnapshotHook({
      owner: input.owner,
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
      root: getScratchRoot(),
      signal: input.signal,
      log: input.log,
    });
    if (boundary === undefined) {
      snapshotKept = true;
      return unmodified();
    }
    return pendingAwareRequestSelection(
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
    if (!snapshotKept) input.snapshot.close();
  }
}
