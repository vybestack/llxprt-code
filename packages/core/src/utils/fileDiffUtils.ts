/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileDiff } from '../tools/tools.js';

/**
 * Safely extracts the FileDiff object from a tool call's resultDisplay.
 * This helper performs runtime checks to ensure the object conforms to the FileDiff structure.
 * @param resultDisplay The resultDisplay property of a tool call record.
 * @returns The FileDiff object if found and valid, otherwise undefined.
 */
export function getFileDiffFromResultDisplay(
  resultDisplay: unknown,
): FileDiff | undefined {
  if (
    resultDisplay &&
    typeof resultDisplay === 'object' &&
    'diffStat' in resultDisplay &&
    typeof resultDisplay.diffStat === 'object' &&
    resultDisplay.diffStat !== null
  ) {
    const diffStat = resultDisplay.diffStat as FileDiff['diffStat'];
    if (diffStat != null) {
      return resultDisplay as FileDiff;
    }
  }
  return undefined;
}

export function computeAddedAndRemovedLines(
  stats: FileDiff['diffStat'] | undefined,
): {
  addedLines: number;
  removedLines: number;
} {
  if (stats == null) {
    return {
      addedLines: 0,
      removedLines: 0,
    };
  }
  return {
    addedLines: stats.ai_added_lines + stats.user_added_lines,
    removedLines: stats.ai_removed_lines + stats.user_removed_lines,
  };
}
