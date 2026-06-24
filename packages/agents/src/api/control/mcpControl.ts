/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */

import type { McpClientManager } from '@vybestack/llxprt-code-core';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  getMCPServerStatus,
} from '@vybestack/llxprt-code-core';
import type {
  AgentMcpControl,
  McpDiscoveryState as PublicMcpDiscoveryState,
  McpServerAuthStatus,
  McpServerInfo,
  McpStatus,
  ToolInfo,
} from '../agent.js';

/**
 * Read-only view of the tool registry the MCP control needs to project
 * discovered MCP tools grouped by their originating server.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */
export interface McpToolRegistryView {
  getAllTools(): ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly serverName?: string;
  }>;
  getEnabledTools(): ReadonlyArray<{ readonly name: string }>;
}

/**
 * Callback bundle injected by AgentImpl so McpControl can read the per-agent
 * MCP auth state plus the REAL discovery/status/tools surface (the configured
 * McpClientManager + tool registry).
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */
export interface McpControlDeps {
  /** Returns true when the named server was authenticated via mcpLogin. */
  readonly isMcpAuthenticated: (server: string) => boolean;
  /** Resolves the live McpClientManager (undefined before initialize). */
  readonly getManager: () => McpClientManager | undefined;
  /** Resolves the live tool registry view for discovered-tool projection. */
  readonly getToolRegistry: () => McpToolRegistryView | undefined;
}

/**
 * Maps the core MCP discovery state (plus any recorded per-server failures)
 * onto the public union. A recorded failure with no successful server →
 * 'failed'; a failure alongside at least one connected server → 'partial'.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */
function mapDiscoveryState(
  state: MCPDiscoveryState,
  serverNames: readonly string[],
  failures: ReadonlyMap<string, string>,
): PublicMcpDiscoveryState {
  if (state === MCPDiscoveryState.NOT_STARTED) {
    return 'idle';
  }
  if (state === MCPDiscoveryState.IN_PROGRESS) {
    return 'pending';
  }
  // COMPLETED
  if (failures.size === 0) {
    return 'ready';
  }
  const anyConnected = serverNames.some(
    (name) => getMCPServerStatus(name) === MCPServerStatus.CONNECTED,
  );
  return anyConnected ? 'partial' : 'failed';
}

/**
 * Maps a core MCPServerStatus onto the public McpServerInfo status union. A
 * server with a recorded discovery failure is surfaced as 'error'.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */
function mapServerStatus(
  name: string,
  failures: ReadonlyMap<string, string>,
): McpServerInfo['status'] {
  if (failures.has(name)) {
    return 'error';
  }
  switch (getMCPServerStatus(name)) {
    case MCPServerStatus.CONNECTED:
      return 'connected';
    case MCPServerStatus.CONNECTING:
      return 'connecting';
    case MCPServerStatus.DISCONNECTING:
    case MCPServerStatus.DISCONNECTED:
    default:
      return 'disconnected';
  }
}

export class McpControl implements AgentMcpControl {
  constructor(private readonly deps?: McpControlDeps) {}

  /**
   * Reads the configured servers from the live manager and projects each into
   * the public McpServerInfo (status mapped from the core server status; tools
   * grouped from the registry).
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  listServers(): readonly McpServerInfo[] {
    const manager = this.deps?.getManager();
    if (manager === undefined) {
      return [];
    }
    const servers = manager.getMcpServers();
    const failures = manager.getDiscoveryFailures();
    const toolsByServer = this.toolsByServer();
    return Object.entries(servers).map(([name, config]) => {
      const toolNames = (toolsByServer[name] ?? []).map((t) => t.name);
      const info: McpServerInfo = {
        name,
        config,
        status: mapServerStatus(name, failures),
        ...(toolNames.length > 0 ? { tools: toolNames } : {}),
        ...(typeof config.type === 'string' ? { transport: config.type } : {}),
      };
      return info;
    });
  }

  /**
   * Reports the overall discovery state + per-server info. Non-blocking — safe
   * to call while discovery is pending.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  status(): McpStatus {
    return {
      discoveryState: this.discoveryState(),
      servers: this.listServers(),
    };
  }

  /**
   * Groups the discovered MCP tools (registry tools carrying a non-empty
   * serverName) under their originating server name.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  toolsByServer(): Readonly<Record<string, readonly ToolInfo[]>> {
    const registry = this.deps?.getToolRegistry();
    if (registry === undefined) {
      return {};
    }
    const enabled = new Set(registry.getEnabledTools().map((t) => t.name));
    const grouped = new Map<string, ToolInfo[]>();
    for (const tool of registry.getAllTools()) {
      const server = tool.serverName;
      if (server === undefined || server.length === 0) {
        continue;
      }
      const info: ToolInfo = {
        name: tool.name,
        ...(tool.description !== undefined
          ? { description: tool.description }
          : {}),
        source: 'mcp',
        server,
        enabled: enabled.has(tool.name),
      };
      const bucket = grouped.get(server);
      if (bucket === undefined) {
        grouped.set(server, [info]);
      } else {
        bucket.push(info);
      }
    }
    return Object.fromEntries(grouped);
  }

  /**
   * Returns the auth status for a named MCP server. Reads the per-agent mcpAuth
   * set (populated by auth.mcpLogin) to determine `authenticated`.
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-013
   */
  async auth(server: string): Promise<McpServerAuthStatus> {
    const authenticated = this.deps?.isMcpAuthenticated(server) ?? false;
    return {
      server,
      authenticated,
      requiresAuth: true,
    };
  }

  /**
   * Projects the core discovery state (plus recorded failures) onto the public
   * union. Non-blocking.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  discoveryState(): PublicMcpDiscoveryState {
    const manager = this.deps?.getManager();
    if (manager === undefined) {
      return 'idle';
    }
    const serverNames = Object.keys(manager.getMcpServers());
    return mapDiscoveryState(
      manager.getDiscoveryState(),
      serverNames,
      manager.getDiscoveryFailures(),
    );
  }

  /**
   * Re-runs discovery for a single server (when named) or all configured
   * servers. Delegates to the REAL McpClientManager restart paths.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  async refresh(server?: string): Promise<void> {
    const manager = this.deps?.getManager();
    if (manager === undefined) {
      return;
    }
    if (server !== undefined) {
      await manager.restartServer(server);
      return;
    }
    await manager.restart();
  }
}
