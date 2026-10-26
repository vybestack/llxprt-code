/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { UiBugCommandSettings } from '../cliUiRuntime.js';
import type { BugCommandOperations } from './bugCommand.js';

/**
 * The two runtime reads /bug needs: the active model name and the configured
 * bug-report URL template.
 */
export interface BugCommandRuntime {
  getModel(): string;
  getBugCommand(): UiBugCommandSettings | undefined;
}

export function bindBugCommand(
  runtime: BugCommandRuntime | null,
  getConversationHistory: BugCommandOperations['getConversationHistory'],
  addItem: UseHistoryManagerReturn['addItem'],
  getIdeDisplayName: () => string,
): BugCommandOperations {
  return {
    getModel: () => runtime?.getModel() ?? 'Unknown',
    getReportUrlTemplate: () => runtime?.getBugCommand()?.urlTemplate,
    getIdeDisplayName,
    getConversationHistory,
    addItem,
  };
}
