/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Config,
  GeminiCLIExtension,
  MCPServerConfig,
} from '../config/config.js';
import type { ToolRegistry } from './tool-registry.js';
import {
  McpClient,
  MCPDiscoveryState,
  populateMcpServerCommand,
} from './mcp-client.js';
import { getErrorMessage, isAuthenticationError } from '../utils/errors.js';
import type { EventEmitter } from 'node:events';
import { coreEvents, CoreEvent } from '../utils/events.js';
import { DebugLogger } from '../debug/index.js';
import { debugLogger } from '../utils/debugLogger.js';

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
        this.blockedMcpServers?.push({
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

    const currentDiscoveryPromise = new Promise<void>((resolve, _reject) => {
      void (async () => {
        try {
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
            // Log the error but don't let a single failed server stop the others
            // Skip emitting feedback for authentication errors (they're handled by connectToMcpServer)
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
        } finally {
          resolve();
        }
      })();
    });

    if (this.discoveryPromise) {
      this.discoveryPromise = this.discoveryPromise.then(
        () => currentDiscoveryPromise,
      );
    } else {
      this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
      this.discoveryPromise = currentDiscoveryPromise;
    }
    this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
      clients: new Map(this.clients),
    });
    const currentPromise = this.discoveryPromise;
    void currentPromise.then((_) => {
      // If we are the last recorded discoveryPromise, then we are done, reset
      // the world.
      if (currentPromise === this.discoveryPromise) {
        this.discoveryPromise = undefined;
        this.discoveryState = MCPDiscoveryState.COMPLETED;
        this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
          clients: new Map(this.clients),
        });
      }
    });
    return currentPromise;
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
