/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type {
  GetPromptResult,
  Prompt,
  ReadResourceResult,
  Resource,
} from '@modelcontextprotocol/sdk/types.js';
import {
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import type { WorkspaceContext } from '@vybestack/llxprt-code-core/utils/workspaceContext.js';
import { getErrorMessage } from '@vybestack/llxprt-code-core/utils/errors.js';
import { coreEvents } from '@vybestack/llxprt-code-core/utils/events.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { DiscoveredMCPTool } from './mcp-tool.js';

import {
  MCPServerStatus,
  MCPDiscoveryState,
  mcpServerRequiresOAuth,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
  updateMCPServerStatus,
  getMCPServerStatus,
  getAllMCPServerStatuses,
  getMCPDiscoveryState,
} from './mcp-status.js';
import { MCP_DEFAULT_TIMEOUT_MSEC, createTransport } from './mcp-transport.js';
import {
  discoverMcpTools,
  connectAndDiscover,
  discoverTools,
  discoverResources,
  discoverPrompts,
  invokeMcpPrompt,
} from './mcp-discovery.js';
import { connectToMcpServer } from './mcp-connection.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';
import {
  hasNetworkTransport,
  isEnabled,
  populateMcpServerCommand,
} from './mcp-discovery-helpers.js';

// Re-export public API symbols to preserve external import paths.
export {
  MCPServerStatus,
  MCPDiscoveryState,
  mcpServerRequiresOAuth,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
  updateMCPServerStatus,
  getMCPServerStatus,
  getAllMCPServerStatuses,
  getMCPDiscoveryState,
  MCP_DEFAULT_TIMEOUT_MSEC,
  createTransport,
  discoverMcpTools,
  connectAndDiscover,
  discoverTools,
  discoverResources,
  discoverPrompts,
  invokeMcpPrompt,
  connectToMcpServer,
  hasNetworkTransport,
  isEnabled,
  populateMcpServerCommand,
};

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

export type DiscoveredMCPPrompt = Prompt & {
  serverName: string;
  invoke: (params: Record<string, unknown>) => Promise<GetPromptResult>;
};

/**
 * The `McpClient` class manages a single MCP server connection lifecycle.
 * It connects, discovers tools/prompts/resources, and handles notifications.
 */
export class McpClient {
  private client: Client | undefined;
  private transport: Transport | undefined;
  private status: MCPServerStatus = MCPServerStatus.DISCONNECTED;
  private isRefreshingTools: boolean = false;
  private pendingToolRefresh: boolean = false;
  private isRefreshingResources: boolean = false;
  private pendingResourceRefresh: boolean = false;
  private connectionGeneration = 0;
  private connectionAbortController: AbortController | undefined;
  private discoveryAbortController: AbortController | undefined;
  private readonly refreshAbortControllers = new Set<AbortController>();
  private capabilityGeneration = 0;
  private activeCapabilityGeneration: number | undefined;

  constructor(
    private readonly serverName: string,
    private readonly serverConfig: MCPServerConfig,
    private readonly toolRegistry: ToolRegistry,
    private readonly promptRegistry: PromptRegistry,
    private readonly resourceRegistry: ResourceRegistry,
    private readonly workspaceContext: WorkspaceContext,
    private readonly cliConfig: Config,
    private readonly debugMode: boolean,
    private readonly clientVersion: string,
    private readonly onToolsUpdated?: (signal?: AbortSignal) => Promise<void>,
  ) {}

  async connect(): Promise<void> {
    if (this.status !== MCPServerStatus.DISCONNECTED) {
      throw new Error(
        `Can only connect when the client is disconnected, current state is ${this.status}`,
      );
    }
    this.updateStatus(MCPServerStatus.CONNECTING);
    const connectionGeneration = ++this.connectionGeneration;
    const abortController = new AbortController();
    this.connectionAbortController = abortController;
    try {
      const client = await connectToMcpServer(
        this.clientVersion,
        this.serverName,
        this.serverConfig,
        this.debugMode,
        this.workspaceContext,
        abortController.signal,
      );

      if (connectionGeneration !== this.connectionGeneration) {
        await client.close().catch(() => {});
        return;
      }

      this.client = client;
      this.registerNotificationHandlers();
      const originalOnError = this.client.onerror;
      this.client.onerror = (error) => {
        if (this.status !== MCPServerStatus.CONNECTED) {
          return;
        }
        if (originalOnError) originalOnError(error);
        debugLogger.error(`MCP ERROR (${this.serverName}):`, error.toString());
        this.toolRegistry.removeMcpToolsByServer(this.serverName);
        this.promptRegistry.removePromptsByServer(this.serverName);
        this.resourceRegistry.removeResourcesByServer(this.serverName);
        const client = this.client;
        this.invalidateCapabilities();
        this.client = undefined;
        this.updateStatus(MCPServerStatus.DISCONNECTED);
        if (client) {
          client.close().catch(() => {});
        }
      };
      this.activeCapabilityGeneration = ++this.capabilityGeneration;
      this.updateStatus(MCPServerStatus.CONNECTED);
    } catch (error) {
      if (connectionGeneration === this.connectionGeneration) {
        this.updateStatus(MCPServerStatus.DISCONNECTED);
      }
      if (abortController.signal.aborted) {
        return;
      }
      throw error;
    } finally {
      if (this.connectionAbortController === abortController) {
        this.connectionAbortController = undefined;
      }
    }
  }

  invalidateCapabilities(): void {
    this.capabilityGeneration++;
    this.activeCapabilityGeneration = undefined;
  }

  private createCapabilityAuthorization(client: Client): () => boolean {
    // Capturing both generations prevents late discovery and refresh callbacks
    // from publishing capabilities after disconnect or trust revocation.
    const generation = this.activeCapabilityGeneration;
    return () => {
      const capabilityIsCurrent =
        generation !== undefined &&
        this.activeCapabilityGeneration === generation &&
        this.client === client;
      return (
        capabilityIsCurrent &&
        this.status === MCPServerStatus.CONNECTED &&
        this.cliConfig.isTrustedFolder()
      );
    };
  }

  async discover(
    cliConfig: Config,
    mayPublish: () => boolean = () => true,
  ): Promise<void> {
    this.assertConnected();

    const timeoutMs = this.serverConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;
    const abortController = new AbortController();
    this.discoveryAbortController = abortController;
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const prompts = await this.discoverPrompts();
      const tools = await this.discoverTools(cliConfig, {
        timeout: timeoutMs,
        signal: abortController.signal,
      });
      const resources = await this.discoverResources({
        timeout: timeoutMs,
        signal: abortController.signal,
      });

      if (
        prompts.length === 0 &&
        tools.length === 0 &&
        resources.length === 0
      ) {
        throw new Error('No prompts, tools, or resources found on the server.');
      }
      if (!mayPublish()) {
        return;
      }

      const connectedClient = this.client!;
      const isAuthorized = this.createCapabilityAuthorization(connectedClient);
      for (const prompt of prompts) {
        this.promptRegistry.registerPrompt({
          ...prompt,
          serverName: this.serverName,
          invoke: (params: Record<string, unknown>) =>
            invokeMcpPrompt(
              this.serverName,
              connectedClient,
              prompt.name,
              params,
              isAuthorized,
            ),
        });
      }
      this.updateResourceRegistry(resources);
      for (const tool of tools) {
        this.toolRegistry.registerTool(tool);
      }
      this.toolRegistry.sortTools();
    } finally {
      clearTimeout(timeoutId);
      if (this.discoveryAbortController === abortController) {
        this.discoveryAbortController = undefined;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.invalidateCapabilities();
    if (
      this.status !== MCPServerStatus.CONNECTED &&
      this.status !== MCPServerStatus.CONNECTING
    ) {
      return;
    }
    this.toolRegistry.removeMcpToolsByServer(this.serverName);
    this.promptRegistry.removePromptsByServer(this.serverName);
    this.resourceRegistry.removeResourcesByServer(this.serverName);
    this.connectionGeneration++;
    this.updateStatus(MCPServerStatus.DISCONNECTING);
    this.connectionAbortController?.abort();
    this.connectionAbortController = undefined;
    this.discoveryAbortController?.abort();
    this.discoveryAbortController = undefined;
    for (const controller of this.refreshAbortControllers) {
      controller.abort();
    }
    this.refreshAbortControllers.clear();
    const client = this.client;
    this.client = undefined;
    const transport = this.transport;
    this.transport = undefined;
    let closeError: unknown;
    try {
      if (transport) {
        await transport.close();
      }
    } catch (error) {
      closeError = error;
    }
    try {
      if (client) {
        await client.close();
      }
    } catch (error) {
      closeError ??= error;
    } finally {
      this.updateStatus(MCPServerStatus.DISCONNECTED);
    }
    if (closeError !== undefined) {
      throw closeError;
    }
  }

  getStatus(): MCPServerStatus {
    return this.status;
  }

  private updateStatus(status: MCPServerStatus): void {
    this.status = status;
    updateMCPServerStatus(this.serverName, status);
  }

  private assertConnected(): void {
    if (this.status !== MCPServerStatus.CONNECTED) {
      throw new Error(
        `Client is not connected, must connect before interacting with the server. Current state is ${this.status}`,
      );
    }
  }

  private getConnectedClient(): Client {
    this.assertConnected();
    if (!this.client) {
      throw new Error(
        `Client '${this.serverName}' is connected without an active SDK client.`,
      );
    }
    return this.client;
  }

  private async discoverTools(
    cliConfig: Config,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<DiscoveredMCPTool[]> {
    const client = this.getConnectedClient();
    const isAuthorized = this.createCapabilityAuthorization(client);
    return discoverTools(
      this.serverName,
      this.serverConfig,
      client,
      cliConfig,
      undefined,
      {
        ...(options ?? {
          timeout: this.serverConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC,
        }),
        isAuthorized,
      },
    );
  }

  private async discoverPrompts(): Promise<Prompt[]> {
    return discoverPrompts(this.serverName, this.getConnectedClient());
  }

  private async discoverResources(options?: {
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<Resource[]> {
    return discoverResources(
      this.serverName,
      this.getConnectedClient(),
      options,
    );
  }

  private updateResourceRegistry(resources: Resource[]): void {
    this.resourceRegistry.setResourcesForServer(this.serverName, resources);
  }

  async readResource(uri: string): Promise<ReadResourceResult> {
    this.assertConnected();
    const client = this.client!;
    if (!this.createCapabilityAuthorization(client)()) {
      throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    }
    return client.request(
      {
        method: 'resources/read',
        params: { uri },
      },
      ReadResourceResultSchema,
    );
  }

  getServerConfig(): MCPServerConfig {
    return this.serverConfig;
  }

  getInstructions(): string {
    if (!this.client) {
      return '';
    }
    return this.client.getInstructions() ?? '';
  }

  private registerNotificationHandlers(): void {
    if (!this.client) {
      return;
    }

    const capabilities = this.client.getServerCapabilities();

    if (capabilities?.tools?.listChanged === true) {
      debugLogger.log(
        `Server '${this.serverName}' supports tool updates. Listening for changes...`,
      );

      this.client.setNotificationHandler(
        ToolListChangedNotificationSchema,
        async () => {
          debugLogger.log(
            ` Received tool update notification from '${this.serverName}'`,
          );
          await this.refreshTools();
        },
      );
    }

    if (capabilities?.resources?.listChanged === true) {
      debugLogger.log(
        `Server '${this.serverName}' supports resource updates. Listening for changes...`,
      );

      this.client.setNotificationHandler(
        ResourceListChangedNotificationSchema,
        async () => {
          debugLogger.log(
            ` Received resource update notification from '${this.serverName}'`,
          );
          await this.refreshResources();
        },
      );
    }
  }

  private async refreshTools(): Promise<void> {
    if (this.isRefreshingTools) {
      debugLogger.log(
        `Tool refresh for '${this.serverName}' is already in progress. Pending update.`,
      );
      this.pendingToolRefresh = true;
      return;
    }

    this.isRefreshingTools = true;

    try {
      let keepLooping = true;
      while (keepLooping) {
        this.pendingToolRefresh = false;
        const ok = await this.refreshToolsOnce();
        keepLooping = ok && this.consumePendingRefresh();
      }
    } catch (error) {
      debugLogger.error(
        `Critical error in refresh loop for ${this.serverName}: ${getErrorMessage(error)}`,
      );
    } finally {
      this.isRefreshingTools = false;
      this.pendingToolRefresh = false;
    }
  }

  private isRefreshGenerationCurrent(
    client: Client,
    connectionGeneration: number,
    capabilityGeneration: number | undefined,
  ): boolean {
    return (
      this.client === client &&
      this.connectionGeneration === connectionGeneration &&
      this.activeCapabilityGeneration === capabilityGeneration
    );
  }

  private isRefreshAuthorized(
    client: Client,
    connectionGeneration: number,
    capabilityGeneration: number | undefined,
  ): boolean {
    const hasActiveConnection =
      this.client === client &&
      this.connectionGeneration === connectionGeneration &&
      this.status === MCPServerStatus.CONNECTED;
    const hasActiveCapability =
      capabilityGeneration !== undefined &&
      this.activeCapabilityGeneration === capabilityGeneration;
    return (
      hasActiveConnection &&
      hasActiveCapability &&
      this.cliConfig.isTrustedFolder()
    );
  }

  private removeToolsForCurrentRefresh(
    client: Client,
    connectionGeneration: number,
    capabilityGeneration: number | undefined,
  ): void {
    if (
      this.isRefreshGenerationCurrent(
        client,
        connectionGeneration,
        capabilityGeneration,
      )
    ) {
      this.toolRegistry.removeMcpToolsByServer(this.serverName);
    }
  }

  private async refreshToolsOnce(): Promise<boolean> {
    const client = this.client;
    if (this.status !== MCPServerStatus.CONNECTED || !client) {
      return false;
    }
    const connectionGeneration = this.connectionGeneration;
    const capabilityGeneration = this.activeCapabilityGeneration;

    const timeoutMs = this.serverConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;
    const abortController = new AbortController();
    this.refreshAbortControllers.add(abortController);
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      let newTools;
      try {
        newTools = await this.discoverTools(this.cliConfig, {
          signal: abortController.signal,
        });
      } catch (err) {
        debugLogger.error(
          `Discovery failed during refresh: ${getErrorMessage(err)}`,
        );
        return false;
      }

      if (
        !this.isRefreshAuthorized(
          client,
          connectionGeneration,
          capabilityGeneration,
        )
      ) {
        return false;
      }
      this.toolRegistry.removeMcpToolsByServer(this.serverName);

      for (const tool of newTools) {
        this.toolRegistry.registerTool(tool);
      }
      this.toolRegistry.sortTools();

      if (this.onToolsUpdated) {
        try {
          await this.onToolsUpdated(abortController.signal);
        } catch (error) {
          this.removeToolsForCurrentRefresh(
            client,
            connectionGeneration,
            capabilityGeneration,
          );
          throw error;
        }
        if (
          !this.isRefreshAuthorized(
            client,
            connectionGeneration,
            capabilityGeneration,
          )
        ) {
          this.toolRegistry.removeMcpToolsByServer(this.serverName);
          return false;
        }
      }

      coreEvents.emitFeedback(
        'info',
        `Tools updated for server: ${this.serverName}`,
      );
      return true;
    } finally {
      clearTimeout(timeoutId);
      this.refreshAbortControllers.delete(abortController);
    }
  }

  private consumePendingRefresh(): boolean {
    return this.pendingToolRefresh;
  }

  private async refreshResources(): Promise<void> {
    if (this.isRefreshingResources) {
      debugLogger.log(
        `Resource refresh for '${this.serverName}' is already in progress. Pending update.`,
      );
      this.pendingResourceRefresh = true;
      return;
    }

    this.isRefreshingResources = true;

    try {
      let keepLooping = true;
      while (keepLooping) {
        this.pendingResourceRefresh = false;
        const ok = await this.refreshResourcesOnce();
        keepLooping = ok && this.consumePendingResourceRefresh();
      }
    } catch (error) {
      debugLogger.error(
        `Critical error in resource refresh loop for ${this.serverName}: ${getErrorMessage(error)}`,
      );
    } finally {
      this.isRefreshingResources = false;
      this.pendingResourceRefresh = false;
    }
  }

  private async refreshResourcesOnce(): Promise<boolean> {
    const client = this.client;
    if (this.status !== MCPServerStatus.CONNECTED || !client) {
      return false;
    }
    const connectionGeneration = this.connectionGeneration;
    const capabilityGeneration = this.activeCapabilityGeneration;

    const timeoutMs = this.serverConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;
    const abortController = new AbortController();
    this.refreshAbortControllers.add(abortController);
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      let newResources;
      try {
        newResources = await this.discoverResources({
          timeout: timeoutMs,
          signal: abortController.signal,
        });
      } catch (err) {
        debugLogger.error(
          `Resource discovery failed during refresh: ${getErrorMessage(err)}`,
        );
        return false;
      }

      if (
        !this.isRefreshAuthorized(
          client,
          connectionGeneration,
          capabilityGeneration,
        )
      ) {
        return false;
      }
      this.updateResourceRegistry(newResources);

      coreEvents.emitFeedback(
        'info',
        `Resources updated for server: ${this.serverName}`,
      );
      return true;
    } finally {
      clearTimeout(timeoutId);
      this.refreshAbortControllers.delete(abortController);
    }
  }

  private consumePendingResourceRefresh(): boolean {
    return this.pendingResourceRefresh;
  }
}
