/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import { getMcpServerOAuthStatus } from '@vybestack/llxprt-code-mcp';
import { McpControl } from './mcpControl.js';
import type { AgentMcpOperations } from '../mcpRuntimeAssembly.js';
import {
  projectRegistryTool,
  readOptionalStringProp,
} from '../agentBootstrap.js';

export function buildOwnedMcpControl(
  readServerSettings: AgentMcpOperations['readServerSettings'],
  selection: ToolSelection,
  listPrompts: AgentMcpOperations['listPrompts'],
  listResources: AgentMcpOperations['listResources'],
  readOAuthCredentials: AgentMcpOperations['readOAuthCredentials'],
  performOAuth: AgentMcpOperations['performOAuth'],
  status: AgentMcpOperations['status'],
  refresh: AgentMcpOperations['refresh'],
  reload: AgentMcpOperations['reload'],
  isMcpAuthenticated: (server: string) => boolean,
  markAuthenticated: (server: string) => void,
  refreshClientTools: () => Promise<void>,
  subscribeStatus?: AgentMcpOperations['subscribeStatus'],
  findResource?: AgentMcpOperations['findResource'],
  readResource?: AgentMcpOperations['readResource'],
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
