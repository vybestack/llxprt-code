/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  ProviderRequestRows,
  ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

/**
 * Builds the provider-neutral selection tests hand to providers. Rows without
 * a close owner fail visibly if anything tries to close them.
 */
export function requestSelection(
  rows: ProviderRequestRows & { close?: () => void | Promise<void> },
): ProviderRequestSelection {
  return Object.freeze({
    count: rows.count,
    openReader: (signal?: AbortSignal) => rows.openReader(signal),
    close: (): void | Promise<void> => {
      if (rows.close === undefined)
        throw new Error('Test selection has no close owner');
      return rows.close();
    },
  });
}
