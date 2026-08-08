/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MCPServerConfig } from '../configTypes.js';
import type { McpClientManager } from '@vybestack/llxprt-code-mcp';

/**
 * Role interface for MCP server, discovery, and instruction concerns.
 *
 * Transcribed from the checker-based census in
 * `project-plans/issue2615/analysis/role-assignment.json` (P01).
 * Every member signature matches the concrete Config declaration exactly.
 */
export interface McpAccess {
  refreshMcpContext(): Promise<void>;
  getMcpServers(): Record<string, MCPServerConfig> | undefined;
  getMcpInstructions(): string | undefined;
  getMcpServerCommand(): string | undefined;
  getBlockedMcpServers():
    | Array<{ name: string; extensionName: string }>
    | undefined;
  awaitMcpDiscoveryGate(): Promise<ReadonlyMap<string, string>>;
  getMcpRuntimeStatus():
    | {
        readonly servers: Record<string, MCPServerConfig>;
        readonly discoveryFailures: ReadonlyMap<string, string>;
        readonly discoveryState: ReturnType<
          McpClientManager['getDiscoveryState']
        >;
      }
    | undefined;
  refreshMcpServers(server?: string): Promise<void>;
  reloadMcpServers(): Promise<void>;
  getAllowedMcpServers(): string[] | undefined;
}
