/**
 * @license
 * Copyright Vybestack LLC, 2026
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FileDiff } from '@vybestack/llxprt-code-tools';

/**
 * Safely extracts the FileDiff object from a tool call's resultDisplay.
 * This helper performs runtime checks to ensure the object conforms to the FileDiff structure.
 * @param resultDisplay The resultDisplay property of a tool call record.
 * @returns The FileDiff object if found and valid, otherwise undefined.
 */
export function getFileDiffFromResultDisplay(
  resultDisplay: unknown,
): FileDiff | undefined {
  if (!isTruthyObjectWithDiffStat(resultDisplay)) {
    return undefined;
  }
  const diffStat = resultDisplay.diffStat as FileDiff['diffStat'];
  if (diffStat) {
    return resultDisplay as FileDiff;
  }
  return undefined;
}

function isTruthyObjectWithDiffStat(
  value: unknown,
): value is { diffStat: unknown } {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }
  if (!('diffStat' in value)) {
    return false;
  }
  const stat = (value as { diffStat: unknown }).diffStat;
  return stat !== null && typeof stat === 'object';
}

export function computeAddedAndRemovedLines(
  stats: FileDiff['diffStat'] | undefined,
): {
  addedLines: number;
  removedLines: number;
} {
  if (!stats) {
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
