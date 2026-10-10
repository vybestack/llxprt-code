/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ProviderRequestRows,
  ProviderRequestSelection,
  ProviderRequestSnapshot,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export interface SourcePendingSelection {
  /** Normalized output membership must not be mistaken for raw recomposition input. */
  readonly kind: 'provider-output-membership' | 'hook-recovered-input';
  readonly rows: ProviderRequestRows;
}

/** Borrows the snapshot. Returning a reader does not close the enclosing owner. */
export function sourcePendingMembership(
  snapshot: ProviderRequestSnapshot,
): SourcePendingSelection {
  let count = 0;
  for (let index = 0; index < snapshot.count; index++)
    if (snapshot.isPending(index)) count++;
  return Object.freeze({
    kind: 'provider-output-membership',
    rows: Object.freeze({
      count,
      async *openReader(
        signal?: AbortSignal,
      ): AsyncGenerator<IContent, void, unknown> {
        let index = 0;
        for await (const row of snapshot.openReader(signal)) {
          if (snapshot.isPending(index++)) yield row;
        }
      },
    }),
  });
}

/** Neutral request selection plus the pending membership sharing its lifetime. */
export interface PendingAwareRequestSelection extends ProviderRequestSelection {
  readonly pendingSelection: SourcePendingSelection | undefined;
}

/** Pending readers share exactly the full source's lifetime; neither owns rows. */
export function pendingAwareRequestSelection(
  rows: ProviderRequestSelection,
  pendingSelection: SourcePendingSelection | undefined,
): PendingAwareRequestSelection {
  return Object.freeze({
    count: rows.count,
    openReader: (signal?: AbortSignal) => rows.openReader(signal),
    close: () => rows.close(),
    pendingSelection,
  });
}
