/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionAuditProvenance } from '../../core/compression/types.js';
import type { IContent } from './IContent.js';
import { isCompressionSummary } from './compressionSummaryScratchpad.js';

/**
 * Stamp the summary author onto the compression summary rows a compression
 * publishes (#4101). The provenance travels in the row metadata, so the journal
 * stores it with the summary and a resumed session reads it back. Rows that are
 * not summaries (continuation directives, retained context) are returned as
 * the same object.
 */
export function stampCompressionProvenance(
  rows: readonly IContent[],
  provenance: CompressionAuditProvenance,
): IContent[] {
  return rows.map((row) =>
    isCompressionSummary(row)
      ? {
          ...row,
          metadata: { ...row.metadata, compressionProvenance: provenance },
        }
      : row,
  );
}
