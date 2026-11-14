/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '../../HistoryService.js';
import type { IContent } from '../../IContent.js';

/**
 * Replaces the row at `index` the way a density pass does: the stored row's
 * chronology marker stays with the replacement.
 */
export function replaceRowAt(
  history: Pick<HistoryService, 'applyDensityResult'>,
  index: number,
  replacement: IContent,
): Promise<void> {
  return history.applyDensityResult({
    removals: [],
    replacements: new Map([[index, replacement]]),
    metadata: {
      readWritePairsPruned: 0,
      fileDeduplicationsPruned: 0,
      recencyPruned: 0,
    },
  });
}
