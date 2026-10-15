/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { PerformResumeActionReturn } from '../commands/types.js';
import type { HistoryItem } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

export function bindCommandOwnerResume(
  replay: (action: PerformResumeActionReturn) => Promise<{
    readonly uiHistory: readonly HistoryItem[];
    readonly warnings: readonly string[];
  }>,
  loadHistory: UseHistoryManagerReturn['loadHistory'],
): (action: PerformResumeActionReturn) => Promise<readonly string[]> {
  return (action) =>
    replay(action).then((result) => {
      loadHistory([...result.uiHistory]);
      return result.warnings;
    });
}
