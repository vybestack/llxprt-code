/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */

import type { McpClientManager } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import type { MCPOAuthConfig } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md lines 01-04
import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
  getMCPServerStatus,
} from '@vybestack/llxprt-code-core';
import type {
  AgentMcpControl,
  McpDetailStatus,
  McpDetailsOptions,
  McpDiscoveryState as PublicMcpDiscoveryState,
  McpPromptInfo,
  McpResourceInfo,
  McpServerAuthStatus,
  McpServerDetail,
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

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpPromptRegistryView {
  getPromptsByServer(server: string): ReadonlyArray<{
    name: string;
    description?: string;
  }>;
}

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
export interface McpResourceRegistryView {
  getAllResources(): ReadonlyArray<{
    serverName: string;
    name?: string;
    uri: string;
  }>;
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
  /**
   * @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
   * Records the named server as authenticated in the SAME per-agent auth marker
   * `isMcpAuthenticated` reads (the one `auth.mcpLogin` populates), so a
   * successful `authenticate(server)` reconciles with a later
   * `auth(server)` / `details()` read. Optional + undefined-safe: when absent
   * (or the manager path is a no-op) the control simply does not record.
   */
  readonly markAuthenticated?: (server: string) => void;
  /** Resolves the live McpClientManager (undefined before initialize). */
  readonly getManager: () => McpClientManager | undefined;
  /** Resolves the live tool registry view for discovered-tool projection. */
  readonly getToolRegistry: () => McpToolRegistryView | undefined;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Raw configured MCP servers. */
  readonly getServerConfigs?: () => Record<string, MCPServerConfig> | undefined;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Blocked servers. */
  readonly getBlockedServers?: () => ReadonlyArray<{
    name: string;
    extensionName: string;
  }>;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Prompt registry view. */
  readonly getPromptRegistry?: () => McpPromptRegistryView | undefined;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Resource registry view. */
  readonly getResourceRegistry?: () => McpResourceRegistryView | undefined;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Re-publishes client tool declarations. */
  readonly refreshClientTools?: () => Promise<void>;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Performs the real OAuth handshake. */
  readonly performOAuth?: (
    server: string,
    oauthConfig: MCPOAuthConfig,
    mcpServerUrl: string | undefined,
  ) => Promise<void>;
  /**
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md line 02
   * Resolves the REAL persisted OAuth quad-state for a server. Optional +
   * undefined-safe: when absent the projection yields 'not-required'.
   */
  readonly getOAuthStatus?: (server: string) => Promise<McpOAuthStatus>;
  /**
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003 @pseudocode agents-projection.md line 03
   * Resolves whether the server really requires OAuth. Optional + undefined-safe:
   * when absent the projection yields false.
   */
  readonly getRequiresAuth?: (server: string) => boolean;
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
   * Returns the auth status for a named MCP server. `authenticated` is now
   * DERIVED from the resolved persisted OAuth quad-state (oauthStatus ===
   * 'authenticated'), NOT from the in-session marker Set. The in-session signal
   * is projected independently as `sessionAuthenticated`.
   *
   * @plan:PLAN-20260617-COREAPI.P18
   * @requirement:REQ-013
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-002 @pseudocode agents-projection.md lines 10-19
   */
  async auth(server: string): Promise<McpServerAuthStatus> {
    return this.buildAuthStatus(server);
  }

  /**
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-002 @pseudocode agents-projection.md lines 10-19
   *
   * Single shared projection used by `auth()` and both `authenticate()` exits.
   * Derives `authenticated` from the resolved persisted OAuth status; preserves
   * the in-session marker as the independent `sessionAuthenticated` field.
   * Never throws: absent closures yield 'not-required' / false.
   */
  private async buildAuthStatus(server: string): Promise<McpServerAuthStatus> {
    const sessionAuthenticated = this.deps?.isMcpAuthenticated(server) ?? false;
    const oauthStatus: McpOAuthStatus = this.deps?.getOAuthStatus
      ? await this.deps.getOAuthStatus(server)
      : 'not-required';
    const requiresAuth = this.deps?.getRequiresAuth
      ? this.deps.getRequiresAuth(server)
      : false;
    const authenticated = oauthStatus === 'authenticated';
    return {
      server,
      authenticated,
      requiresAuth,
      oauthStatus,
      sessionAuthenticated,
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
   * @plan:PLAN-20260622-COREAPIGAP.P14
   * @requirement:REQ-006
   * @pseudocode lines 30-41
   *
   * Re-runs discovery for a single server (when named) or all configured
   * servers, then re-publishes the agent client's tool declarations
   * (R-REFRESH-PARITY). Delegates to the REAL McpClientManager restart paths.
   */
  async refresh(server?: string): Promise<void> {
    const manager = this.deps?.getManager();
    if (manager === undefined) {
      return;
    }
    if (server !== undefined) {
      await manager.restartServer(server);
    } else {
      await manager.restart();
    }
    if (this.deps?.refreshClientTools !== undefined) {
      await this.deps.refreshClientTools();
    }
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P14
   * @requirement:REQ-006
   * @pseudocode lines 1-16
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-002 @pseudocode agents-projection.md lines 20-36
   *
   * Real OAuth flow: orchestrates performOAuth -> restartServer ->
   * refreshClientTools. An unknown server or unwired performOAuth is a no-op
   * returning the REAL persisted status (no fabricated requiresAuth). A
   * performOAuth rejection PROPAGATES (no restart, no setTools) — the control
   * does NOT catch. Both exits re-read the REAL status via buildAuthStatus.
   */
  async authenticate(server: string): Promise<McpServerAuthStatus> {
    const configs = this.deps?.getServerConfigs?.();
    const serverConfig = configs ? configs[server] : undefined;
    const performOAuth = this.deps?.performOAuth;
    if (serverConfig === undefined || performOAuth === undefined) {
      return this.buildAuthStatus(server);
    }
    const oauthConfig = serverConfig.oauth ?? { enabled: false };
    const mcpServerUrl = serverConfig.httpUrl ?? serverConfig.url;
    await performOAuth(server, oauthConfig, mcpServerUrl);
    const manager = this.deps?.getManager();
    if (manager !== undefined) {
      await manager.restartServer(server);
    }
    if (this.deps?.refreshClientTools !== undefined) {
      await this.deps.refreshClientTools();
    }
    // Reconcile the per-agent auth marker so a later auth(server) / details()
    // read agrees with this success (undefined-safe when no writer is wired).
    this.deps?.markAuthenticated?.(server);
    return this.buildAuthStatus(server);
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P14
   * @requirement:REQ-006
   * @pseudocode lines 50-78
   * @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003 @pseudocode agents-projection.md lines 40-72
   *
   * Deep per-server projection. includeTools defaults true;
   * includePrompts/includeResources default false. Projects prompts/resources
   * to named-field-only public types. Undefined-safe via ?. + ?? []/?? {}.
   * OAuth statuses are resolved UP FRONT via Promise.all so buildServerDetail
   * stays synchronous (R-ASYNC-DETAIL).
   */
  async details(opts?: McpDetailsOptions): Promise<McpDetailStatus> {
    const includeTools = opts?.includeTools ?? true;
    const includePrompts = opts?.includePrompts ?? false;
    const includeResources = opts?.includeResources ?? false;
    // details() projects the CONFIGURED server set (getServerConfigs ->
    // config.getMcpServers()), mirroring the CLI `/mcp list` which lists
    // configured + blocked servers. This intentionally differs from
    // listServers(), which projects the LIVE discovered set
    // (manager.getMcpServers()); a configured server absent from the live
    // manager still appears here.
    const configs = this.deps?.getServerConfigs?.() ?? {};
    const toolsByServer = this.toolsByServer();
    const resourcesAll = includeResources
      ? (this.deps?.getResourceRegistry?.()?.getAllResources() ?? [])
      : [];
    const names = Object.keys(configs);
    const statusEntries = await Promise.all(
      names.map(
        async (name): Promise<[string, McpOAuthStatus]> => [
          name,
          this.deps?.getOAuthStatus
            ? await this.deps.getOAuthStatus(name)
            : 'not-required',
        ],
      ),
    );
    const oauthStatusByServer: Record<string, McpOAuthStatus> =
      Object.fromEntries(statusEntries);
    const servers: McpServerDetail[] = [];
    for (const name of names) {
      servers.push(
        this.buildServerDetail(
          name,
          includeTools,
          includePrompts,
          includeResources,
          toolsByServer,
          resourcesAll,
          oauthStatusByServer[name],
        ),
      );
    }
    const blockedServers = (this.deps?.getBlockedServers?.() ?? []).map(
      (b) => ({ name: b.name, extensionName: b.extensionName }),
    );
    return { servers, blockedServers };
  }

  // @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 @pseudocode lines 60-74
  // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-003,REQ-004 @pseudocode agents-projection.md lines 63-72
  private buildServerDetail(
    name: string,
    includeTools: boolean,
    includePrompts: boolean,
    includeResources: boolean,
    toolsByServer: Readonly<Record<string, readonly ToolInfo[]>>,
    resourcesAll: ReadonlyArray<{
      serverName: string;
      name?: string;
      uri: string;
    }>,
    oauthStatus: McpOAuthStatus,
  ): McpServerDetail {
    const detail: {
      name: string;
      authenticated: boolean;
      requiresAuth: boolean;
      oauthStatus: McpOAuthStatus;
      sessionAuthenticated: boolean;
      tools?: readonly ToolInfo[];
      prompts?: readonly McpPromptInfo[];
      resources?: readonly McpResourceInfo[];
    } = {
      name,
      authenticated: oauthStatus === 'authenticated',
      requiresAuth: this.deps?.getRequiresAuth
        ? this.deps.getRequiresAuth(name)
        : false,
      oauthStatus,
      sessionAuthenticated: this.deps?.isMcpAuthenticated(name) ?? false,
    };
    if (includeTools) {
      detail.tools = toolsByServer[name] ?? [];
    }
    if (includePrompts) {
      const prompts =
        this.deps?.getPromptRegistry?.()?.getPromptsByServer(name) ?? [];
      detail.prompts = prompts.map((p) => ({
        name: p.name,
        ...(p.description !== undefined ? { description: p.description } : {}),
      }));
    }
    if (includeResources) {
      detail.resources = resourcesAll
        .filter((r) => r.serverName === name)
        .map((r) => ({ name: r.name, uri: r.uri }));
    }
    return detail;
  }
}
