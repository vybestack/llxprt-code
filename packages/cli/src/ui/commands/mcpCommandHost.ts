/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Agent } from '@vybestack/llxprt-code-agents';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { McpCommandOperations } from './mcpCommand.js';

export function bindMcpCommand(
  config: CliUiRuntime | null,
  agent: Agent | null,
  addItem: UseHistoryManagerReturn['addItem'],
  reloadCommands: () => void,
): McpCommandOperations {
  return {
    isConfigured: config !== null,
    status:
      agent === null
        ? null
        : {
            listServers: () => agent.mcp.listServers(),
            listBlockedServers: () => agent.mcp.listBlockedServers(),
            discoveryState: () => agent.mcp.discoveryState(),
            readDetails: () =>
              agent.mcp.details({
                includeTools: true,
                includePrompts: true,
                includeResources: true,
              }),
          },
    reload: async () => {
      if (agent === null) throw new Error('Session agent is unavailable');
      await agent.mcp.reload();
    },
    refresh: async () => {
      if (agent === null) throw new Error('Session agent is unavailable');
      await agent.mcp.refresh();
    },
    addItem,
    reloadCommands,
  };
}
