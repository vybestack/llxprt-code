/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { applyCompressionWithAnchor } from './cacheAnchor.js';

export function createCompressionApplyCallback(
  historyService: HistoryService,
  model: string,
  historyOrigin: object | undefined,
  onApplied: (summary: IContent | undefined) => void,
): (
  newHistory: IContent[],
  summary: IContent | undefined,
  topPreserved: number,
) => Promise<void> {
  return async (newHistory, summary, topPreserved) => {
    await applyCompressionWithAnchor(
      historyService,
      newHistory,
      topPreserved,
      model,
      annotateCompressionSpan,
      historyOrigin,
    );
    onApplied(summary);
  };
}
