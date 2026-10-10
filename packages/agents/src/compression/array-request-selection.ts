/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

/**
 * The array whole-request path hands a compression result to the provider as a
 * selection over its resident rows. Removed with the array path (WP16).
 */
export function arrayRequestSelection(
  rows: readonly IContent[],
): ProviderRequestSelection {
  return {
    count: rows.length,
    async *openReader(signal) {
      for (const row of rows) {
        signal?.throwIfAborted();
        yield row;
      }
    },
    close: () => undefined,
  };
}
