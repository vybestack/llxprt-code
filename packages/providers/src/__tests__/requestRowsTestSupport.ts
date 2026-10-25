/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  inMemoryRequestSelection,
  type ProviderRequestRows,
  type ProviderRequestSelection,
} from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export interface TrackedRequestRows extends ProviderRequestSelection {
  /** Readers opened and not yet finished or returned. */
  readonly openReaders: () => number;
  /** Total readers opened over the selection's life. */
  readonly readersOpened: () => number;
  readonly closeCount: () => number;
}

/** Random access over rows held in a test list; each read is a fresh copy, like a disk read. */
export function readAtOf(
  rows: readonly IContent[],
): ProviderRequestRows['readAt'] {
  const selection = inMemoryRequestSelection(rows);
  return (index, signal) => structuredClone(selection.readAt(index, signal));
}

export function textRow(text: string, speaker: IContent['speaker'] = 'human') {
  return { speaker, blocks: [{ type: 'text' as const, text }] } as IContent;
}

/**
 * A repeatable selection over fresh copies of `rows` that counts its readers,
 * so tests can prove every reader is released and nothing collected the rows.
 */
export function trackedRequestRows(
  rows: readonly IContent[],
): TrackedRequestRows {
  let open = 0;
  let opened = 0;
  let closed = 0;
  return {
    callerOwned: true,
    count: rows.length,
    readAt: readAtOf(rows),
    async *openReader(signal) {
      open++;
      opened++;
      try {
        for (const row of rows) {
          signal?.throwIfAborted();
          yield structuredClone(row);
        }
      } finally {
        open--;
      }
    },
    close: () => {
      closed++;
    },
    openReaders: () => open,
    readersOpened: () => opened,
    closeCount: () => closed,
  };
}
