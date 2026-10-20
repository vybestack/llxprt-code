/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { BugCommandOperations } from './bugCommand.js';

export function bindBugCommand(
  config: CliUiRuntime | null,
  getConversationHistory: BugCommandOperations['getConversationHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
  getIdeDisplayName: () => string,
): BugCommandOperations {
  return {
    getModel: () => config?.getModel() ?? 'Unknown',
    getReportUrlTemplate: () => config?.getBugCommand()?.urlTemplate,
    getIdeDisplayName,
    getConversationHistory,
    addItem,
  };
}
