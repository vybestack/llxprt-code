/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ProviderRequestRows,
  ProviderRequestSnapshot,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ResponsesDiskTextRows } from '@vybestack/llxprt-code-providers/openai-responses/responses-disk-text-rows.js';

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

/** Pending readers share exactly the full source's lifetime; neither owns rows. */
export class PendingAwareResponsesDiskTextRows extends ResponsesDiskTextRows {
  readonly #pendingSelection: SourcePendingSelection | undefined;

  constructor(
    rows: ProviderRequestRows & { close: () => void | Promise<void> },
    pendingSelection: SourcePendingSelection | undefined,
  ) {
    super(rows);
    this.#pendingSelection = pendingSelection;
  }

  get pendingSelection(): SourcePendingSelection | undefined {
    return this.#pendingSelection;
  }
}
