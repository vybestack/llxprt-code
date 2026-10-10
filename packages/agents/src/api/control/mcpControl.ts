/**
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 */

// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import type { McpClientManager, McpClient } from '@vybestack/llxprt-code-mcp';
import type { McpServerRuntimeState } from '@vybestack/llxprt-code-mcp';
import type { MCPOAuthConfig } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004 @pseudocode agents-projection.md lines 01-04
import type { McpOAuthStatus } from '@vybestack/llxprt-code-core';
// @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import {
  MCPServerStatus,
  MCPDiscoveryState,
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
import { buildToolInfos } from '../agentBootstrap.js';

/**
 * Read-only view of the tool registry the MCP control needs to project
 * discovered MCP tools grouped by their originating server.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 * @plan:ISSUE-2376 — the element type carries the enriched fields projected
 * onto ToolInfo (displayName, parametersSchema, serverToolName).
 */
export interface McpToolRegistryView {
  getAllTools(): ReadonlyArray<{
    readonly name: string;
    readonly description?: string;
    readonly serverName?: string;
    readonly displayName?: string;
    readonly parametersSchema?: Readonly<Record<string, unknown>>;
    readonly serverToolName?: string;
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
// @plan:ISSUE-2376 — element type carries description (projected onto McpResourceInfo).
export interface McpResourceRegistryView {
  getAllResources(): ReadonlyArray<{
    serverName: string;
    name?: string;
    uri: string;
    description?: string;
  }>;
}

/**
 * Narrow runtime status snapshot Core exposes to agents so listServers /
 * status / discoveryState never reach the concrete McpClientManager. Core owns
 * the manager lifecycle and provides this read-only view.
 */
export interface McpRuntimeStatusView {
  readonly servers: Record<string, MCPServerConfig>;
  readonly discoveryFailures: ReadonlyMap<string, string>;
  readonly discoveryState: MCPDiscoveryState;
  readonly serverStates: ReadonlyMap<string, McpServerRuntimeState>;
}

/**
 * Callback bundle injected by AgentImpl so McpControl reads MCP runtime state
 * through narrow agent-owned callbacks rather than the concrete manager. Core
 * owns the manager lifecycle and supplies the runtime-status snapshot, the
 * refresh/restart capability, and the Core-owned reload callback.
 *
 * @plan:PLAN-20260617-COREAPI.P22
 * @requirement:REQ-013
 * @requirement:REQ-019
 */
export interface McpControlDeps {
  readonly subscribeStatus?: (listener: () => void) => () => void;
  readonly findResource?: AgentMcpControl['findResource'];
  readonly readResource?: (server: string, uri: string) => Promise<unknown>;
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
  /**
   * @requirement:REQ-019
   * Resolves the live MCP runtime-status snapshot (configured servers,
   * discovery failures, discovery state). Optional + undefined-safe: when
   * absent listServers returns [] and discoveryState returns 'idle'.
   */
  readonly getMcpRuntimeStatus?: () => McpRuntimeStatusView | undefined;
  /**
   * @requirement:REQ-019
   * Refreshes one server (when named) or all configured servers via the
   * Core-owned manager capability. Optional + undefined-safe: when absent
   * refresh is a no-op (matches the previous no-manager semantics).
   */
  readonly refreshMcpServers?: (server?: string) => Promise<void>;
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
  readonly listPrompts?: AgentMcpControl['listPrompts'];
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Resource registry view. */
  readonly listResources?: AgentMcpControl['listResources'];
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Re-publishes client tool declarations. */
  readonly refreshClientTools?: () => Promise<void>;
  /**
   * @requirement:REQ-019
   * Core-owned reload callback: awaits fresh config, swaps MCP/blocked state,
   * rebuilds trusted rules, and invokes the live manager reconcile exactly
   * once when initialized. Agents must not call reconcile directly.
   */
  readonly reloadMcpServers?: () => Promise<void>;
  /** @plan:PLAN-20260622-COREAPIGAP.P14 @requirement:REQ-006 Performs the real OAuth handshake. */
  readonly performOAuth?: (
    server: string,
    oauthConfig: MCPOAuthConfig,
    mcpServerUrl: string | undefined,
    signal: AbortSignal,
    onDisplayMessage?: (message: string) => void,
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
  states: ReadonlyMap<string, McpServerRuntimeState>,
): PublicMcpDiscoveryState {
  if (state === MCPDiscoveryState.NOT_STARTED) {
    return 'idle';
  }
  if (state === MCPDiscoveryState.IN_PROGRESS) {
    return 'pending';
  }
  if (failures.size === 0) {
    return 'ready';
  }
  const anyConnected = serverNames.some(
    (name) => states.get(name)?.status === MCPServerStatus.CONNECTED,
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
  states: ReadonlyMap<string, McpServerRuntimeState>,
): McpServerInfo['status'] {
  if (failures.has(name)) {
    return 'error';
  }
  switch (states.get(name)?.status) {
    case MCPServerStatus.CONNECTED:
      return 'connected';
    case MCPServerStatus.CONNECTING:
      return 'connecting';
    case MCPServerStatus.DISCONNECTING:
      return 'disconnecting';
    case MCPServerStatus.DISCONNECTED:
    default:
      return 'disconnected';
  }
}

export class McpControl implements AgentMcpControl {
  private closed = false;
  private readonly statusSubscriptions = new Set<() => void>();

  listBlockedServers(): ReturnType<AgentMcpControl['listBlockedServers']> {
    if (this.closed) throw new Error('MCP control is closed');
    return (this.deps?.getBlockedServers?.() ?? []).map((server) => ({
      ...server,
    }));
  }

  subscribeStatus(listener: () => void): () => void {
    if (this.closed) throw new Error('MCP control is closed');
    const release = this.deps?.subscribeStatus?.(listener);
    const unsubscribe = (): void => {
      release?.();
      this.statusSubscriptions.delete(unsubscribe);
    };
    this.statusSubscriptions.add(unsubscribe);
    return unsubscribe;
  }
  private readonly authentication = new Map<
    string,
    {
      controller: AbortController;
      work: Promise<McpServerAuthStatus>;
    }
  >();

  async cancelAndJoin(): Promise<void> {
    this.closed = true;
    const failures: unknown[] = [];
    for (const release of this.statusSubscriptions) {
      try {
        release();
      } catch (error) {
        failures.push(error);
      }
    }
    this.statusSubscriptions.clear();
    const pending = [...this.authentication.values()];
    for (const { controller } of pending) controller.abort();
    await Promise.allSettled(pending.map(({ work }) => work));
    if (failures.length > 0)
      throw new AggregateError(failures, 'MCP subscription cleanup failed');
  }

  constructor(private readonly deps?: McpControlDeps) {}

  private serverDeclarations(): ReadonlyMap<string, MCPServerConfig> {
    return new Map(Object.entries(this.deps?.getServerConfigs?.() ?? {}));
  }

  listPrompts(server: string): ReturnType<AgentMcpControl['listPrompts']> {
    if (this.closed) throw new Error('MCP control is closed');
    return this.deps?.listPrompts?.(server) ?? [];
  }

  listResources(): ReturnType<AgentMcpControl['listResources']> {
    if (this.closed) throw new Error('MCP control is closed');
    return this.deps?.listResources?.() ?? [];
  }

  findResource(
    identifier: string,
  ): ReturnType<AgentMcpControl['findResource']> {
    if (this.closed) throw new Error('MCP control is closed');
    if (!this.deps?.findResource)
      throw new Error('MCP resource lookup is unavailable');
    return this.deps.findResource(identifier);
  }

  async readResource(server: string, uri: string): Promise<unknown> {
    if (this.closed) throw new Error('MCP control is closed');
    if (!this.deps?.readResource)
      throw new Error('MCP resource reading is unavailable');
    return this.deps.readResource(server, uri);
  }

  /**
   * Reads the configured servers from the live runtime-status snapshot and
   * projects each into the public McpServerInfo (status mapped from the core
   * server status; tools grouped from the registry).
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   * @requirement:REQ-019
   */
  listServers(): readonly McpServerInfo[] {
    const status = this.deps?.getMcpRuntimeStatus?.();
    if (status === undefined) {
      return [];
    }
    const toolsByServer = this.toolsByServer();
    return Object.entries(status.servers).map(([name, config]) => {
      const toolNames = (toolsByServer[name] ?? []).map((t) => t.name);
      const info: McpServerInfo = {
        name,
        config,
        status: mapServerStatus(
          name,
          status.discoveryFailures,
          status.serverStates,
        ),
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
   * serverName) under their originating server name. Projects the enriched
   * displayName/parametersSchema/serverToolName fields (added by #2376)
   * additively — each is included only when the registry view element defines
   * it.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   * @plan:ISSUE-2376
   */
  toolsByServer(): Readonly<Record<string, readonly ToolInfo[]>> {
    const registry = this.deps?.getToolRegistry();
    if (registry === undefined) {
      return {};
    }
    const enabled = new Set(registry.getEnabledTools().map((t) => t.name));
    // Keep only MCP tools (those with a non-empty serverName), then reuse the
    // shared buildToolInfos projection so the additive-field logic lives in
    // exactly one place (see #2376) rather than being re-implemented here.
    const mcpTools = registry
      .getAllTools()
      .filter(
        (tool) => tool.serverName !== undefined && tool.serverName.length > 0,
      );
    const grouped = new Map<string, ToolInfo[]>();
    for (const info of buildToolInfos(mcpTools, enabled)) {
      // buildToolInfos sets `server` from serverName for MCP-sourced tools;
      // the filter above guarantees it is a non-empty string here.
      const server = info.server;
      if (server === undefined) {
        continue;
      }
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
   * @requirement:REQ-019
   */
  discoveryState(): PublicMcpDiscoveryState {
    const status = this.deps?.getMcpRuntimeStatus?.();
    if (status === undefined) {
      return 'idle';
    }
    const serverNames = Object.keys(status.servers);
    return mapDiscoveryState(
      status.discoveryState,
      serverNames,
      status.discoveryFailures,
      status.serverStates,
    );
  }

  /**
   * @plan:PLAN-20260622-COREAPIGAP.P14
   * @requirement:REQ-006
   * @requirement:REQ-019
   * @pseudocode lines 30-41
   *
   * Re-runs discovery for a single server (when named) or all configured
   * servers via the narrow refresh callback, then re-publishes the agent
   * client's tool declarations (R-REFRESH-PARITY). Delegates to the Core-owned
   * manager restart capability — agents never reaches the manager directly.
   */
  async refresh(server?: string): Promise<void> {
    if (this.deps?.getMcpRuntimeStatus?.() === undefined) {
      return;
    }
    const refresh = this.deps.refreshMcpServers;
    if (refresh === undefined) {
      return;
    }
    await refresh(server);
    if (this.deps.refreshClientTools !== undefined) {
      await this.deps.refreshClientTools();
    }
  }

  /**
   * @requirement:REQ-019
   * Delegates to the Core-owned reload callback (which awaits fresh config,
   * swaps MCP/blocked state, rebuilds trusted rules, and invokes the live
   * manager reconcile exactly once when initialized), then re-publishes the
   * agent client's tool declarations. Agents must not call reconcile directly.
   */
  async reload(): Promise<void> {
    const deps = this.deps;
    if (deps === undefined) {
      return;
    }
    await deps.reloadMcpServers?.();
    if (deps.getMcpRuntimeStatus?.() === undefined) {
      return;
    }
    await deps.refreshClientTools?.();
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
  authenticate(
    server: string,
    onDisplayMessage?: (message: string) => void,
  ): Promise<McpServerAuthStatus> {
    if (this.closed) {
      return Promise.reject(
        new DOMException('MCP authentication owner disposed', 'AbortError'),
      );
    }
    const existing = this.authentication.get(server);
    if (existing) return existing.work;
    const controller = new AbortController();
    const work = this.authenticateOperation(
      server,
      controller.signal,
      onDisplayMessage,
    ).finally(() => {
      this.authentication.delete(server);
    });
    this.authentication.set(server, { controller, work });
    return work;
  }

  private async authenticateOperation(
    server: string,
    signal: AbortSignal,
    onDisplayMessage?: (message: string) => void,
  ): Promise<McpServerAuthStatus> {
    const serverConfig = this.serverDeclarations().get(server);
    const performOAuth = this.deps?.performOAuth;
    if (serverConfig === undefined || performOAuth === undefined) {
      const status = await this.buildAuthStatus(server);
      signal.throwIfAborted();
      return status;
    }
    const oauthConfig = serverConfig.oauth ?? { enabled: false };
    const mcpServerUrl = serverConfig.httpUrl ?? serverConfig.url;
    await performOAuth(
      server,
      oauthConfig,
      mcpServerUrl,
      signal,
      onDisplayMessage,
    );
    signal.throwIfAborted();
    const refresh = this.deps?.refreshMcpServers;
    if (refresh !== undefined) {
      await refresh(server);
      signal.throwIfAborted();
    }
    if (this.deps?.refreshClientTools !== undefined) {
      await this.deps.refreshClientTools();
      signal.throwIfAborted();
    }
    const status = await this.buildAuthStatus(server);
    signal.throwIfAborted();
    // @pseudocode agents-projection.md 40-72 — reconcile the per-agent auth marker so a later auth(server)/details() read agrees with this success (undefined-safe when no writer is wired).
    this.deps?.markAuthenticated?.(server);
    return {
      ...status,
      sessionAuthenticated: this.deps?.isMcpAuthenticated(server) ?? false,
    };
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
    // @plan:PLAN-20260622-MCPOAUTHTRUTH.P06 @requirement:REQ-004
    const configs = this.serverDeclarations();
    const toolsByServer = this.toolsByServer();
    const resourcesAll = includeResources
      ? (this.deps?.listResources?.() ?? [])
      : [];
    const names = [...configs.keys()];
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
      description?: string;
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
      const prompts = this.deps?.listPrompts?.(name) ?? [];
      detail.prompts = prompts.map((p) => ({
        name: p.name,
        ...(p.description !== undefined ? { description: p.description } : {}),
      }));
    }
    if (includeResources) {
      detail.resources = resourcesAll
        .filter((r) => r.serverName === name)
        .map((r) => ({
          name: r.name,
          uri: r.uri,
          ...(r.description !== undefined
            ? { description: r.description }
            : {}),
        }));
    }
    return detail;
  }
}

export function readMcpRuntimeStatus(
  manager: McpClientManager,
): McpRuntimeStatusView {
  return {
    servers: manager.getStatusServers(),
    serverStates: manager.getServerStates(),
    discoveryFailures: manager.getDiscoveryFailures(),
    discoveryState: manager.getDiscoveryState(),
  };
}

export function requireMcpResourceClient(
  manager: McpClientManager,
  server: string,
): McpClient {
  const client = manager.getClient(server);
  if (!client)
    throw new Error(
      `MCP client for server '${server}' is not available or not connected.`,
    );
  return client;
}
