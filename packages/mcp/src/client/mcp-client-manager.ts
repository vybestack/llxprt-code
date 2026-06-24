/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  GeminiCLIExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  McpClient,
  MCPDiscoveryState,
  populateMcpServerCommand,
} from './mcp-client.js';
import {
  applyFakeServerDiscovery,
  isFakeMcpDiscoveryActive,
  loadFakeMcpFixture,
} from '../fake/fakeMcpDiscovery.js';
import {
  getErrorMessage,
  isAuthenticationError,
} from '@vybestack/llxprt-code-core/utils/errors.js';
import type { EventEmitter } from 'node:events';
import {
  coreEvents,
  CoreEvent,
} from '@vybestack/llxprt-code-core/utils/events.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { debugLogger } from '@vybestack/llxprt-code-core/utils/debugLogger.js';

const logger = new DebugLogger('llxprt:mcp-client-manager');

/**
 * Manages the lifecycle of multiple MCP clients, including local child processes.
 * This class is responsible for starting, stopping, and discovering tools from
 * a collection of MCP servers defined in the configuration.
 */
export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  private readonly clientVersion: string;
  private readonly toolRegistry: ToolRegistry;
  private readonly cliConfig: Config;
  // If we have ongoing MCP client discovery, this completes once that is done.
  private discoveryPromise: Promise<void> | undefined;
  private discoveryState: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;
  private readonly eventEmitter?: EventEmitter;
  private pendingRefreshPromise: Promise<void> | null = null;
  private refreshRequestedWhilePending = false;
  private readonly blockedMcpServers: Array<{
    name: string;
    extensionName: string;
  }> = [];
  /**
   * Per-server discovery failure messages, keyed by server name. Populated by
   * the fake discovery seam (and clearable on restart) so callers can detect a
   * failed discovery without inspecting feedback events.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  private readonly discoveryFailures: Map<string, string> = new Map();

  constructor(
    clientVersion: string,
    toolRegistry: ToolRegistry,
    cliConfig: Config,
    eventEmitter?: EventEmitter,
  ) {
    this.clientVersion = clientVersion;
    this.toolRegistry = toolRegistry;
    this.cliConfig = cliConfig;
    this.eventEmitter = eventEmitter;
  }

  getBlockedMcpServers() {
    return this.blockedMcpServers;
  }

  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Disconnects all MCP clients from their servers.
   *    - Updates the Gemini chat configuration to load the new tools.
   */
  async stopExtension(extension: GeminiCLIExtension) {
    logger.log(`Unloading extension: ${extension.name}`);
    await Promise.all(
      Object.keys(extension.mcpServers ?? {}).map((name) =>
        this.disconnectClient(name, true),
      ),
    );
    await this.cliConfig.refreshMcpContext();
  }

  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Connects MCP clients to each server and discovers their tools.
   *    - Updates the Gemini chat configuration to load the new tools.
   */
  async startExtension(extension: GeminiCLIExtension) {
    logger.log(`Loading extension: ${extension.name}`);
    await Promise.all(
      Object.entries(extension.mcpServers ?? {}).map(([name, config]) =>
        this.maybeDiscoverMcpServer(name, {
          ...config,
          extension,
        }),
      ),
    );
    await this.cliConfig.refreshMcpContext();
  }

  private isAllowedMcpServer(name: string) {
    const allowedNames = this.cliConfig.getAllowedMcpServers();
    if (
      allowedNames &&
      allowedNames.length > 0 &&
      allowedNames.indexOf(name) === -1
    ) {
      return false;
    }
    const blockedServers = this.cliConfig.getBlockedMcpServers();
    if (
      blockedServers &&
      blockedServers.length > 0 &&
      blockedServers.some((s) => s.name === name)
    ) {
      return false;
    }
    return true;
  }

  private async disconnectClient(name: string, skipRefresh = false) {
    const existing = this.clients.get(name);
    if (existing) {
      try {
        this.clients.delete(name);
        this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
          clients: new Map(this.clients),
        });
        await existing.disconnect();
      } catch (error) {
        logger.warn(
          `Error stopping client '${name}': ${getErrorMessage(error)}`,
        );
      } finally {
        if (!skipRefresh) {
          // This is required to update the content generator configuration with the
          // new tool configuration and system instructions.
          await this.cliConfig.refreshMcpContext();
        }
      }
    }
  }

  maybeDiscoverMcpServer(
    name: string,
    config: MCPServerConfig,
  ): Promise<void> | void {
    if (!this.isAllowedMcpServer(name)) {
      if (!this.blockedMcpServers.find((s) => s.name === name)) {
        this.blockedMcpServers.push({
          name,
          extensionName: config.extension?.name ?? '',
        });
      }
      return;
    }
    if (!this.cliConfig.isTrustedFolder()) {
      return;
    }
    if (config.extension && !config.extension.isActive) {
      return;
    }
    const existing = this.clients.get(name);
    if (existing && existing.getServerConfig().extension !== config.extension) {
      const extensionText = config.extension
        ? ` from extension "${config.extension.name}"`
        : '';
      logger.warn(
        `Skipping MCP config for server with name "${name}"${extensionText} as it already exists.`,
      );
      return;
    }

    const currentDiscoveryPromise = this.buildDiscoveryPromise(
      name,
      config,
      existing,
    );
    this.enqueueDiscovery(currentDiscoveryPromise);
    return currentDiscoveryPromise;
  }

  private buildDiscoveryPromise(
    name: string,
    config: MCPServerConfig,
    existing: McpClient | undefined,
  ): Promise<void> {
    return new Promise<void>((resolve, _reject) => {
      void (async () => {
        try {
          await this.connectAndDiscover(name, config, existing);
        } finally {
          resolve();
        }
      })();
    });
  }

  private async connectAndDiscover(
    name: string,
    config: MCPServerConfig,
    existing: McpClient | undefined,
  ): Promise<void> {
    if (isFakeMcpDiscoveryActive()) {
      await this.connectAndDiscoverFake(name, config, existing);
      return;
    }

    if (existing) {
      await existing.disconnect();
    }

    const client =
      existing ??
      new McpClient(
        name,
        config,
        this.toolRegistry,
        this.cliConfig.getPromptRegistry(),
        this.cliConfig.getResourceRegistry(),
        this.cliConfig.getWorkspaceContext(),
        this.cliConfig,
        this.cliConfig.getDebugMode(),
        this.clientVersion,
        async () => {
          debugLogger.log('Tools changed, updating Gemini context...');
          await this.scheduleMcpContextRefresh();
        },
      );
    if (!existing) {
      this.clients.set(name, client);
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    }
    try {
      await client.connect();
      await client.discover(this.cliConfig);
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    } catch (error) {
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      if (!isAuthenticationError(error)) {
        coreEvents.emitFeedback(
          'error',
          `Error during discovery for server '${name}': ${getErrorMessage(
            error,
          )}`,
          error,
        );
      }
    }
  }

  /**
   * Drives discovery for a server through the shipped fake MCP seam. Registers
   * a real {@link McpClient} (so getMcpServers/getClient continue to work) but
   * replays the fixture's served tools into the REAL tool registry and the
   * REAL server-status channel instead of performing network/process I/O.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   * @requirement:REQ-017
   */
  private async connectAndDiscoverFake(
    name: string,
    config: MCPServerConfig,
    existing: McpClient | undefined,
  ): Promise<void> {
    const client =
      existing ??
      new McpClient(
        name,
        config,
        this.toolRegistry,
        this.cliConfig.getPromptRegistry(),
        this.cliConfig.getResourceRegistry(),
        this.cliConfig.getWorkspaceContext(),
        this.cliConfig,
        this.cliConfig.getDebugMode(),
        this.clientVersion,
        async () => {
          await this.scheduleMcpContextRefresh();
        },
      );
    if (!existing) {
      this.clients.set(name, client);
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    }
    this.discoveryFailures.delete(name);
    const fixture = loadFakeMcpFixture();
    if (fixture === undefined) {
      return;
    }
    const outcome = await applyFakeServerDiscovery(
      name,
      this.toolRegistry,
      fixture,
    );
    if (outcome.failure !== undefined) {
      this.discoveryFailures.set(name, outcome.failure);
    }
    this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
      clients: new Map(this.clients),
    });
  }

  /**
   * Returns the per-server discovery failure messages recorded during the most
   * recent discovery pass. Empty when discovery succeeded for all servers.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  getDiscoveryFailures(): ReadonlyMap<string, string> {
    return new Map(this.discoveryFailures);
  }

  private enqueueDiscovery(promise: Promise<void>): void {
    if (this.discoveryPromise) {
      this.discoveryPromise = this.discoveryPromise.then(() => promise);
    } else {
      this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
      this.discoveryPromise = promise;
    }
    this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
      clients: new Map(this.clients),
    });
    const currentPromise = this.discoveryPromise;
    void currentPromise.then((_) => {
      if (currentPromise === this.discoveryPromise) {
        this.discoveryPromise = undefined;
        this.discoveryState = MCPDiscoveryState.COMPLETED;
        this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
          clients: new Map(this.clients),
        });
      }
    });
  }

  /**
   * Initiates the tool discovery process for all configured MCP servers (via
   * gemini settings or command line arguments).
   *
   * It connects to each server, discovers its available tools, and registers
   * them with the `ToolRegistry`.
   *
   * For any server which is already connected, it will first be disconnected.
   *
   * This does NOT load extension MCP servers - this happens when the
   * ExtensionLoader explicitly calls `loadExtension`.
   */
  async startConfiguredMcpServers(): Promise<void> {
    if (!this.cliConfig.isTrustedFolder()) {
      return;
    }

    const servers = populateMcpServerCommand(
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional falsy coalescing: default empty object for undefined McpServers
      this.cliConfig.getMcpServers() || {},
      this.cliConfig.getMcpServerCommand(),
    );

    if (Object.keys(servers).length === 0) {
      this.discoveryState = MCPDiscoveryState.COMPLETED;
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      await this.cliConfig.refreshMcpContext();
      return;
    }

    this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
      clients: new Map(this.clients),
    });
    await Promise.all(
      Object.entries(servers).map(([name, config]) =>
        this.maybeDiscoverMcpServer(name, config),
      ),
    );
    await this.cliConfig.refreshMcpContext();
  }

  /**
   * Restarts all active MCP Clients.
   */
  async restart(): Promise<void> {
    await Promise.all(
      Array.from(this.clients.entries()).map(async ([name, client]) => {
        try {
          await this.maybeDiscoverMcpServer(name, client.getServerConfig());
        } catch (error) {
          logger.error(
            `Error restarting client '${name}': ${getErrorMessage(error)}`,
          );
        }
      }),
    );
    await this.cliConfig.refreshMcpContext();
  }

  /**
   * Restart a single MCP server by name.
   */
  async restartServer(name: string) {
    const client = this.clients.get(name);
    if (!client) {
      throw new Error(`No MCP server registered with the name "${name}"`);
    }
    await this.maybeDiscoverMcpServer(name, client.getServerConfig());
    await this.cliConfig.refreshMcpContext();
  }

  /**
   * Stops all running local MCP servers and closes all client connections.
   * This is the cleanup method to be called on application exit.
   */
  async stop(): Promise<void> {
    const disconnectionPromises = Array.from(this.clients.entries()).map(
      async ([name, client]) => {
        try {
          await client.disconnect();
        } catch (error) {
          debugLogger.error(
            `Error stopping client '${name}': ${getErrorMessage(error)}`,
          );
        }
      },
    );

    await Promise.all(disconnectionPromises);
    this.clients.clear();
  }

  getDiscoveryState(): MCPDiscoveryState {
    return this.discoveryState;
  }

  /**
   * Resolves once any in-flight discovery pass has settled. When no discovery
   * is in flight this resolves immediately. Used by the public Agent discovery
   * gate to await MCP readiness before a model turn.
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  async whenDiscoverySettled(): Promise<void> {
    const pending = this.discoveryPromise;
    if (pending !== undefined) {
      await pending;
    }
  }

  /**
   * All of the MCP server configurations currently loaded.
   */
  getMcpServers(): Record<string, MCPServerConfig> {
    const mcpServers: Record<string, MCPServerConfig> = {};
    for (const [name, client] of this.clients.entries()) {
      mcpServers[name] = client.getServerConfig();
    }
    return mcpServers;
  }

  /**
   * Aggregates instructions from all connected MCP servers.
   * Instructions are formatted with server name headers for attribution.
   * Returns empty string if no servers have instructions.
   */
  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  private async scheduleMcpContextRefresh(): Promise<void> {
    if (this.pendingRefreshPromise) {
      this.refreshRequestedWhilePending = true;
      return this.pendingRefreshPromise;
    }

    this.pendingRefreshPromise = (async () => {
      try {
        do {
          this.refreshRequestedWhilePending = false;
          // Debounce to coalesce multiple rapid updates
          await new Promise((resolve) => setTimeout(resolve, 300));
          await this.cliConfig.refreshMcpContext();
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- refresh flag can be set by concurrent MCP discovery callbacks while awaiting
        } while (this.refreshRequestedWhilePending);
      } catch (error) {
        debugLogger.error(
          `Error refreshing MCP context: ${getErrorMessage(error)}`,
        );
      } finally {
        this.pendingRefreshPromise = null;
      }
    })();

    return this.pendingRefreshPromise;
  }

  getMcpServerCount(): number {
    return this.clients.size;
  }

  getMcpInstructions(): string {
    const instructions: string[] = [];
    for (const [name, client] of this.clients) {
      const clientInstructions = client.getInstructions();
      if (clientInstructions) {
        instructions.push(
          `The following are instructions provided by the tool server '${name}':\n---[start of server instructions]---\n${clientInstructions}\n---[end of server instructions]---`,
        );
      }
    }
    return instructions.join('\n\n');
  }
}
