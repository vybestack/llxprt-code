/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { getMcpServerOAuthStatus } from '@vybestack/llxprt-code-mcp';
import { McpControl } from './mcpControl.js';
import type { McpControlReadPort } from '../mcpRuntimePorts.js';
import {
  projectRegistryTool,
  readOptionalStringProp,
} from '../agentBootstrap.js';

export function buildOwnedMcpControl(
  readServerSettings: McpControlReadPort['readServerSettings'],
  selection: ToolSelection,
  listPrompts: McpControlReadPort['listPrompts'],
  listResources: McpControlReadPort['listResources'],
  readOAuthCredentials: McpControlReadPort['readOAuthCredentials'],
  performOAuth: McpControlReadPort['performOAuth'],
  status: McpControlReadPort['status'],
  refresh: McpControlReadPort['refresh'],
  reload: McpControlReadPort['reload'],
  isMcpAuthenticated: (server: string) => boolean,
  markAuthenticated: (server: string) => void,
  refreshClientTools: () => Promise<void>,
  subscribeStatus?: McpControlReadPort['subscribeStatus'],
  findResource?: McpControlReadPort['findResource'],
  readResource?: McpControlReadPort['readResource'],
): McpControl {
  const requiresOAuth = (server: string): boolean => {
    const current = status();
    return (
      current?.servers[server]?.oauth?.enabled === true ||
      (current?.serverStates.get(server)?.requiresOAuth ?? false)
    );
  };
  return new McpControl({
    isMcpAuthenticated,
    markAuthenticated,
    getMcpRuntimeStatus: status,
    refreshMcpServers: refresh,
    getToolRegistry: () => ({
      getAllTools: () =>
        selection.getAllTools().map((tool) =>
          projectRegistryTool({
            name: tool.name,
            displayName: tool.displayName,
            description: tool.description,
            schema: tool.schema,
            serverName: readOptionalStringProp(tool, 'serverName'),
            serverToolName: readOptionalStringProp(tool, 'serverToolName'),
          }),
        ),
      getEnabledTools: () =>
        selection.getEnabledTools().map((tool) => ({ name: tool.name })),
    }),
    getServerConfigs: () => readServerSettings().mcpServers,
    getBlockedServers: () => readServerSettings().blockedMcpServers,
    listPrompts,
    listResources,
    refreshClientTools,
    reloadMcpServers: reload,
    performOAuth,
    getRequiresAuth: requiresOAuth,
    getOAuthStatus: (server) =>
      getMcpServerOAuthStatus(
        server,
        { requiresOAuth: requiresOAuth(server) },
        readOAuthCredentials,
      ),
    subscribeStatus,
    findResource,
    readResource,
  });
}
