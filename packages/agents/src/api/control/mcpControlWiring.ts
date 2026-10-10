/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P14
 * @requirement:REQ-006
 */

import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { getMcpServerOAuthStatus } from '@vybestack/llxprt-code-mcp';
import { McpControl, type McpControlDeps } from './mcpControl.js';
import type { AgentMcpOperations } from '../mcpRuntimeAssembly.js';
import {
  projectRegistryTool,
  readOptionalStringProp,
} from '../agentBootstrap.js';

/**
 * Inputs AgentImpl supplies so the MCP wiring can resolve the live
 * Config-backed discovery surface, the per-agent mcpAuth predicate, and the
 * active client (for tool re-publish after restart/authenticate).
 */
export interface McpControlWiringArgs {
  readonly config: Config;
  readonly readServerSettings: AgentMcpOperations['readServerSettings'];
  readonly toolSelection: ToolSelection;
  readonly listPrompts: NonNullable<McpControlDeps['listPrompts']>;
  readonly listResources: NonNullable<McpControlDeps['listResources']>;
  readonly getMcpRuntimeStatus: NonNullable<
    McpControlDeps['getMcpRuntimeStatus']
  >;
  readonly refreshMcpServers: NonNullable<McpControlDeps['refreshMcpServers']>;
  readonly reloadMcpServers: () => Promise<void>;
  readonly performOAuth: AgentMcpOperations['performOAuth'];
  readonly readOAuthCredentials: AgentMcpOperations['readOAuthCredentials'];
  readonly isMcpAuthenticated: (server: string) => boolean;
  readonly markAuthenticated: (server: string) => void;
  readonly resolveClient: () => AgentClientContract;
}

/**
 * Builds the McpControlDeps closure bundle wired to the live Config + client.
 * Binding MCPOAuthProvider HERE (never in mcpControl.ts) keeps the control
 * delegate-only and free of any direct dependency on the OAuth provider
 * implementation. The handshake token is awaited-and-discarded so it is never
 * surfaced through the public surface.
 *
 * @plan:PLAN-20260622-COREAPIGAP.P14
 * @requirement:REQ-006
 * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004 @pseudocode agents-projection.md lines 80-93
 */
export function buildMcpControlDeps(
  args: McpControlWiringArgs,
): McpControlDeps {
  const { isMcpAuthenticated, markAuthenticated, resolveClient } = args;
  // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004 @pseudocode agents-projection.md lines 86-92 — one per-server requires-OAuth predicate feeding BOTH getRequiresAuth and the getOAuthStatus hint so a server that requires auth can never resolve to 'not-required'.
  const requiresOAuth = (server: string): boolean => {
    const status = args.getMcpRuntimeStatus();
    return (
      status?.servers[server]?.oauth?.enabled === true ||
      (status?.serverStates.get(server)?.requiresOAuth ?? false)
    );
  };
  return {
    isMcpAuthenticated,
    markAuthenticated,
    getMcpRuntimeStatus: args.getMcpRuntimeStatus,
    refreshMcpServers: args.refreshMcpServers,
    // @plan:ISSUE-2376 — project the real registry tools (AnyDeclarativeTool)
    // into the McpToolRegistryView element shape by reusing
    // projectRegistryTool (the same helper toolControl.ts list() uses), so
    // displayName/parametersSchema/serverToolName flow through consistently
    // without duplicating the projection or relying on unsafe field casts.
    getToolRegistry: () => {
      const registry = args.toolSelection;
      return {
        getAllTools: () =>
          registry.getAllTools().map((t) =>
            projectRegistryTool({
              name: t.name,
              displayName: t.displayName,
              description: t.description,
              schema: t.schema,
              serverName: readOptionalStringProp(t, 'serverName'),
              serverToolName: readOptionalStringProp(t, 'serverToolName'),
            }),
          ),
        getEnabledTools: () =>
          registry.getEnabledTools().map((t) => ({ name: t.name })),
      };
    },
    getServerConfigs: () => args.readServerSettings().mcpServers,
    getBlockedServers: () => args.readServerSettings().blockedMcpServers,
    listPrompts: args.listPrompts,
    listResources: args.listResources,
    refreshClientTools: () => resolveClient().setTools(),
    reloadMcpServers: args.reloadMcpServers,
    performOAuth: args.performOAuth,
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003 @pseudocode agents-projection.md lines 86-88
    getRequiresAuth: requiresOAuth,
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md lines 89-92
    getOAuthStatus: (server: string) =>
      getMcpServerOAuthStatus(
        server,
        {
          requiresOAuth: requiresOAuth(server),
        },
        args.readOAuthCredentials,
      ),
  };
}

export function buildOwnedMcpControl(
  operations: AgentMcpOperations,
  args: Omit<
    McpControlWiringArgs,
    | 'readServerSettings'
    | 'listPrompts'
    | 'listResources'
    | 'getMcpRuntimeStatus'
    | 'refreshMcpServers'
    | 'reloadMcpServers'
    | 'performOAuth'
    | 'readOAuthCredentials'
  >,
): McpControl {
  return new McpControl({
    ...buildMcpControlDeps({
      ...args,
      readServerSettings: operations.readServerSettings,
      listPrompts: (server) => operations.listPrompts(server),
      listResources: () => operations.listResources(),
      performOAuth: operations.performOAuth,
      readOAuthCredentials: operations.readOAuthCredentials,
      getMcpRuntimeStatus: () => operations.status(),
      refreshMcpServers: (server) => operations.refresh(server),
      reloadMcpServers: () => operations.reload(),
    }),
    subscribeStatus: (listener) => operations.subscribeStatus(listener),
    findResource: (identifier) => operations.findResource(identifier),
    readResource: (server, uri) => operations.readResource(server, uri),
  });
}
