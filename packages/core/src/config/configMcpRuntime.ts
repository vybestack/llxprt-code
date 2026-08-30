/**
 * ConfigBaseCore — field declarations and simple single-delegation accessors.
 * ConfigBase extends this and adds abstract methods + complex multi-line logic.
 */

import type { McpClientManager } from '@vybestack/llxprt-code-mcp';
import type { MCPServerConfig } from './configTypes.js';

export interface McpRuntimeStatus {
  readonly servers: Record<string, MCPServerConfig>;
  readonly discoveryFailures: ReadonlyMap<string, string>;
  readonly discoveryState: ReturnType<McpClientManager['getDiscoveryState']>;
}

/** MCP runtime accessors: each reads only the client manager, so they live
 * outside the config class. */
export function mcpRuntimeStatus(
  manager: McpClientManager | undefined,
): McpRuntimeStatus | undefined {
  if (manager === undefined) return undefined;
  return {
    servers: manager.getMcpServers(),
    discoveryFailures: manager.getDiscoveryFailures(),
    discoveryState: manager.getDiscoveryState(),
  };
}

export async function refreshMcpServers(
  manager: McpClientManager | undefined,
  server?: string,
): Promise<void> {
  if (manager === undefined) return;
  if (server === undefined) {
    await manager.restart();
    return;
  }
  await manager.restartServer(server);
}

export async function awaitMcpDiscoveryGate(
  manager: McpClientManager | undefined,
): Promise<ReadonlyMap<string, string>> {
  if (manager === undefined) return new Map();
  await manager.whenDiscoverySettled();
  return manager.getDiscoveryFailures();
}
