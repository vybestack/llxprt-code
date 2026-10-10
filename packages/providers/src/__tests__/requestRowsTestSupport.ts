/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

export interface TrackedRequestRows extends ProviderRequestSelection {
  /** Readers opened and not yet finished or returned. */
  readonly openReaders: () => number;
  /** Total readers opened over the selection's life. */
  readonly readersOpened: () => number;
  readonly closeCount: () => number;
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
    count: rows.length,
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
