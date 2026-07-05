/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260622-COREAPIGAP.P14
 * @requirement:REQ-006
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import {
  MCPOAuthProvider,
  getMcpServerOAuthStatus,
  mcpServerRequiresOAuth,
} from '@vybestack/llxprt-code-core';
import type { McpControlDeps } from './mcpControl.js';

/**
 * Inputs AgentImpl supplies so the MCP wiring can resolve the live
 * Config-backed discovery surface, the per-agent mcpAuth predicate, and the
 * active client (for tool re-publish after restart/authenticate).
 */
export interface McpControlWiringArgs {
  readonly config: Config;
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
  const { config, isMcpAuthenticated, markAuthenticated, resolveClient } = args;
  // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004 @pseudocode agents-projection.md lines 86-92 — one per-server requires-OAuth predicate feeding BOTH getRequiresAuth and the getOAuthStatus hint so a server that requires auth can never resolve to 'not-required'.
  const requiresOAuth = (server: string): boolean =>
    config.getMcpServers()?.[server]?.oauth?.enabled === true ||
    mcpServerRequiresOAuth.has(server);
  return {
    isMcpAuthenticated,
    markAuthenticated,
    getManager: () => config.getMcpClientManager(),
    // @plan:ISSUE-2376 — project the real registry tools (AnyDeclarativeTool)
    // into the McpToolRegistryView element shape so displayName/
    // parametersSchema/serverToolName flow through to the public ToolInfo.
    getToolRegistry: () => {
      const registry = config.getToolRegistry();
      return {
        getAllTools: () =>
          registry.getAllTools().map((t) => {
            const schema = t.schema.parametersJsonSchema;
            return {
              name: t.name,
              description: t.description,
              serverName: (t as { serverName?: string }).serverName,
              displayName: t.displayName,
              ...(schema !== undefined
                ? {
                    parametersSchema: schema as Readonly<
                      Record<string, unknown>
                    >,
                  }
                : {}),
              serverToolName: (t as { serverToolName?: string }).serverToolName,
            };
          }),
        getEnabledTools: () =>
          registry.getEnabledTools().map((t) => ({ name: t.name })),
      };
    },
    getServerConfigs: () => config.getMcpServers(),
    getBlockedServers: () => config.getBlockedMcpServers() ?? [],
    getPromptRegistry: () => ({
      getPromptsByServer: (s: string) =>
        config.getPromptRegistry().getPromptsByServer(s),
    }),
    getResourceRegistry: () => ({
      getAllResources: () => config.getResourceRegistry().getAllResources(),
    }),
    refreshClientTools: () => resolveClient().setTools(),
    performOAuth: async (server, oauthConfig, mcpServerUrl) => {
      await MCPOAuthProvider.authenticate(
        server,
        oauthConfig,
        mcpServerUrl,
        undefined,
      );
    },
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003 @pseudocode agents-projection.md lines 86-88
    getRequiresAuth: (server: string) => requiresOAuth(server),
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md lines 89-92
    getOAuthStatus: (server: string) =>
      getMcpServerOAuthStatus(server, {
        requiresOAuth: requiresOAuth(server),
      }),
  };
}
