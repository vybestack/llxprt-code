/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolResult } from '../tools.js';

/**
 * Every limit this tool applies (match, file and per-file counts, source
 * observation budget, token limit) records `outputTruncation`, so a
 * successful search without it covered everything it was asked for.
 */
export function withSearchCompleteness(result: ToolResult): ToolResult {
  if (result.error !== undefined) return result;
  const truncation: unknown = result.metadata?.['outputTruncation'];
  const truncated =
    typeof truncation === 'object' &&
    truncation !== null &&
    (truncation as { truncated?: unknown }).truncated === true;
  return { ...result, completeness: truncated ? 'partial' : 'complete' };
}
