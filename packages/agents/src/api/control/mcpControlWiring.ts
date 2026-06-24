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
import { MCPOAuthProvider } from '@vybestack/llxprt-code-core';
import type { McpControlDeps } from './mcpControl.js';

/**
 * Inputs AgentImpl supplies so the MCP wiring can resolve the live
 * Config-backed discovery surface, the per-agent mcpAuth predicate, and the
 * active client (for tool re-publish after restart/authenticate).
 */
export interface McpControlWiringArgs {
  readonly config: Config;
  readonly isMcpAuthenticated: (server: string) => boolean;
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
 */
export function buildMcpControlDeps(
  args: McpControlWiringArgs,
): McpControlDeps {
  const { config, isMcpAuthenticated, resolveClient } = args;
  return {
    isMcpAuthenticated,
    getManager: () => config.getMcpClientManager(),
    getToolRegistry: () => config.getToolRegistry(),
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
  };
}
