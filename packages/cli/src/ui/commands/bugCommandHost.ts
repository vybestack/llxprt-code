/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { BugCommandOperations } from './bugCommand.js';

export function bindBugCommand(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
): BugCommandOperations {
  return {
    getModel: () => config?.getModel() ?? 'Unknown',
    getReportUrlTemplate: () => config?.getBugCommand()?.urlTemplate,
    getIdeDisplayName: () =>
      config?.getIdeMode() === true
        ? (config.getIdeClient()?.getDetectedIdeDisplayName() ?? '')
        : '',
    getConversationHistory: () =>
      agent?.agentClient.hasChatInitialized() === true
        ? agent.agentClient.getChat().getHistory()
        : undefined,
    addItem,
  };
}
