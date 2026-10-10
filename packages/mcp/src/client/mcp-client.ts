/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  type Prompt,
  type ReadResourceResult,
  type Resource,
  ReadResourceResultSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from '../config/index.js';
import type * as Host from '../host/hostInterfaces.js';
import type { McpToolPublication } from '@vybestack/llxprt-code-tools';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import {
  captureHostFeedback,
  type HostFeedbackSink,
} from '../host/hostServices.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import type { DiscoveredMCPTool } from './mcp-tool.js';

import { MCPServerStatus, MCPDiscoveryState } from './mcp-status.js';
import { MCP_DEFAULT_TIMEOUT_MSEC, createTransport } from './mcp-transport.js';
import {
  discoverTools,
  discoverResources,
  discoverPrompts,
  invokeMcpPrompt,
  registerMcpPrompts,
} from './mcp-discovery.js';
import {
  McpOAuthOperations,
  bindMcpOAuthCapabilities,
} from './mcp-oauth-helpers.js';
import type { McpOAuthBinding } from '../auth/index.js';
import { connectToMcpServer } from './mcp-connection.js';
import { MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE } from './mcp-errors.js';
import {
  hasNetworkTransport,
  isEnabled,
  populateMcpServerCommand,
} from './mcp-discovery-helpers.js';
import { attachMcpConnectionHandlers } from './mcp-client-events.js';
import { closeClientWithTimeout } from './close-client-with-timeout.js';

// Re-export public API symbols to preserve external import paths.
export {
  MCPServerStatus,
  MCPDiscoveryState,
  MCP_DEFAULT_TIMEOUT_MSEC,
  createTransport,
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

export type { DiscoveredMCPPrompt } from '../host/hostInterfaces.js';

/**
 * The `McpClient` class manages a single MCP server connection lifecycle.
 * It connects, discovers tools/prompts/resources, and handles notifications.
 */
export class McpClient {
  private client: Client | undefined;
  private readonly oauthOperations: McpOAuthOperations;
  private connectionWork: Promise<void> | undefined;
  private requiresOAuth = false;
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

  private readonly emitFeedback: HostFeedbackSink;
  constructor(
    oauth: McpOAuthBinding,
    private readonly approvalPolicy: Host.McpApprovalPolicy,
    private readonly serverName: string,
    private readonly serverConfig: MCPServerConfig,
    private readonly toolRegistry: McpToolPublication,
    private readonly promptRegistry: Host.McpPromptRegistry,
    private readonly resourceRegistry: Host.McpResourceRegistry,
    private readonly workspaceContext: Host.McpWorkspaceContext,
    private readonly cliConfig: Host.McpTrustConfig,
    private readonly debugMode: boolean,
    private readonly clientVersion: string,
    private readonly onToolsUpdated?: (signal?: AbortSignal) => Promise<void>,
    feedback?: HostFeedbackSink,
    private readonly onStatus?: (
      status: MCPServerStatus,
      requiresOAuth: boolean,
    ) => void,
  ) {
    this.emitFeedback = captureHostFeedback(feedback);
    this.oauthOperations = new McpOAuthOperations(
      bindMcpOAuthCapabilities(oauth),
    );
  }

  async connect(): Promise<void> {
    if (this.status !== MCPServerStatus.DISCONNECTED || this.connectionWork) {
      throw new Error(
        `Can only connect when the client is disconnected, current state is ${this.status}`,
      );
    }
    this.connectionWork = this.connectOperation().finally(() => {
      this.connectionWork = undefined;
    });
    return this.connectionWork;
  }

  private async connectOperation(): Promise<void> {
    this.requiresOAuth = this.serverConfig.oauth?.enabled === true;
    this.updateStatus(MCPServerStatus.CONNECTING);
    const connectionGeneration = ++this.connectionGeneration;
    const abortController = new AbortController();
    this.connectionAbortController = abortController;
    let connectedClient: Client | undefined;
    try {
      const client = await connectToMcpServer(
        this.clientVersion,
        this.serverName,
        this.serverConfig,
        this.debugMode,
        this.workspaceContext,
        this.oauthOperations,
        abortController.signal,
        this.emitFeedback,
        () => {
          if (
            connectionGeneration !== this.connectionGeneration ||
            abortController.signal.aborted
          )
            return;
          this.requiresOAuth = true;
          this.onStatus?.(this.status, true);
        },
      );
      connectedClient = client;

      if (connectionGeneration !== this.connectionGeneration) {
        await client.close().catch(() => {});
        return;
      }

      this.registerNotificationHandlers(client);
      this.client = client;
      attachMcpConnectionHandlers(
        client,
        this.serverName,
        () =>
          this.client === client && this.status === MCPServerStatus.CONNECTED,
        () => {
          this.removeAllServerArtifacts();
          this.invalidateCapabilities();
          this.client = undefined;
          this.updateStatus(MCPServerStatus.DISCONNECTED);
        },
      );
      this.activeCapabilityGeneration = ++this.capabilityGeneration;
      this.updateStatus(MCPServerStatus.CONNECTED);
    } catch (error) {
      if (connectionGeneration === this.connectionGeneration) {
        this.client = undefined;
        this.updateStatus(MCPServerStatus.DISCONNECTED);
      }
      if (connectedClient !== undefined) {
        await connectedClient.close().catch(() => {});
      }
      if (!abortController.signal.aborted) throw error;
    } finally {
      if (this.connectionAbortController === abortController) {
        this.connectionAbortController = undefined;
      }
    }
  }

  markConnectedForFakeDiscovery(): void {
    if (
      this.client !== undefined ||
      this.status !== MCPServerStatus.DISCONNECTED
    ) {
      throw new Error(
        `Can only mark a disconnected client as fake-connected, current state is ${this.status}`,
      );
    }
    this.status = MCPServerStatus.CONNECTED;
  }

  invalidateCapabilities(): void {
    this.capabilityGeneration++;
    this.activeCapabilityGeneration = undefined;
  }

  abortDiscovery(): void {
    this.invalidateCapabilities();
    this.discoveryAbortController?.abort();
    this.discoveryAbortController = undefined;
  }

  private createCapabilityAuthorization(client: Client): () => boolean {
    const connectionGeneration = this.connectionGeneration;
    const capabilityGeneration = this.activeCapabilityGeneration;
    return () =>
      this.isCapabilityAuthorized(
        client,
        connectionGeneration,
        capabilityGeneration,
      );
  }

  private isCapabilityAuthorized(
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

  async discover(
    cliConfig: Host.McpTrustConfig,
    mayPublish: () => boolean = () => true,
  ): Promise<void> {
    this.assertConnected();
    const connectedClient = this.getConnectedClient();
    const isAuthorized = this.createCapabilityAuthorization(connectedClient);
    const publicationIsAuthorized = (): boolean =>
      mayPublish() && isAuthorized();
    if (!(await this.continueAuthorizedPublication(publicationIsAuthorized))) {
      return;
    }

    const timeoutMs = this.serverConfig.timeout ?? MCP_DEFAULT_TIMEOUT_MSEC;
    const abortController = new AbortController();
    this.discoveryAbortController = abortController;
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
    try {
      const prompts = await this.discoverPrompts({
        timeout: timeoutMs,
        signal: abortController.signal,
      });
      if (
        !(await this.continueAuthorizedPublication(publicationIsAuthorized))
      ) {
        return;
      }
      const tools = await this.discoverTools(cliConfig, {
        timeout: timeoutMs,
        signal: abortController.signal,
      });
      if (
        !(await this.continueAuthorizedPublication(publicationIsAuthorized))
      ) {
        return;
      }
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
      if (
        !(await this.continueAuthorizedPublication(publicationIsAuthorized))
      ) {
        return;
      }

      await this.publishDiscoveredArtifacts(
        prompts,
        tools,
        resources,
        connectedClient,
        publicationIsAuthorized,
      );
    } finally {
      clearTimeout(timeoutId);
      if (this.discoveryAbortController === abortController) {
        this.discoveryAbortController = undefined;
      }
    }
  }

  private async continueAuthorizedPublication(
    isAuthorized: () => boolean,
  ): Promise<boolean> {
    try {
      if (isAuthorized()) {
        return true;
      }
    } catch (error) {
      await this.disconnectAfterPublicationFailure(error);
    }
    try {
      await this.disconnect();
    } catch (cleanupError) {
      debugLogger.error(
        `Capability publication cleanup failed for '${this.serverName}': ${getErrorMessage(cleanupError)}`,
      );
    }
    return false;
  }

  private async disconnectAfterPublicationFailure(
    error: unknown,
  ): Promise<never> {
    try {
      await this.disconnect();
    } catch (cleanupError) {
      debugLogger.error(
        `Capability publication cleanup failed for '${this.serverName}': ${getErrorMessage(cleanupError)}`,
      );
    }
    throw error;
  }

  private async publishDiscoveredArtifacts(
    prompts: readonly Prompt[],
    tools: readonly DiscoveredMCPTool[],
    resources: readonly Resource[],
    connectedClient: Client,
    isAuthorized: () => boolean,
  ): Promise<void> {
    try {
      if (!isAuthorized()) {
        await this.disconnect();
        return;
      }
      if (
        !registerMcpPrompts(
          this.serverName,
          connectedClient,
          this.promptRegistry,
          prompts,
          isAuthorized,
        )
      ) {
        await this.disconnect();
        return;
      }
      if (!(await this.continueAuthorizedPublication(isAuthorized))) {
        return;
      }
      this.updateResourceRegistry([...resources]);
      if (!(await this.continueAuthorizedPublication(isAuthorized))) {
        return;
      }
      for (const tool of tools) {
        if (!(await this.continueAuthorizedPublication(isAuthorized))) {
          return;
        }
        this.toolRegistry.registerTool(tool);
        if (!(await this.continueAuthorizedPublication(isAuthorized))) {
          return;
        }
      }
      if (!(await this.continueAuthorizedPublication(isAuthorized))) {
        return;
      }
      this.toolRegistry.sortTools();
      await this.continueAuthorizedPublication(isAuthorized);
    } catch (error) {
      await this.disconnectAfterPublicationFailure(error);
    }
  }

  async disconnect(): Promise<void> {
    this.connectionAbortController?.abort();
    const authJoined = this.oauthOperations.cancelAndJoin();
    const connectionWork = this.connectionWork;
    this.invalidateCapabilities();
    const wasActive =
      this.status === MCPServerStatus.CONNECTED ||
      this.status === MCPServerStatus.CONNECTING;
    const cleanupErrors: unknown[] = [];
    for (const cleanup of [
      () => this.toolRegistry.removeMcpToolsByServer(this.serverName),
      () => this.promptRegistry.removePromptsByServer(this.serverName),
      () => this.resourceRegistry.removeResourcesByServer(this.serverName),
    ]) {
      try {
        cleanup();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    this.connectionGeneration++;
    if (wasActive) {
      this.updateStatus(MCPServerStatus.DISCONNECTING, cleanupErrors);
    }
    this.connectionAbortController = undefined;
    this.discoveryAbortController?.abort();
    this.discoveryAbortController = undefined;
    for (const controller of this.refreshAbortControllers) {
      controller.abort();
    }
    this.refreshAbortControllers.clear();
    const client = this.client;
    try {
      if (client) {
        await closeClientWithTimeout(client, this.serverName);
        if (this.client === client) {
          this.client = undefined;
        }
      }
    } catch (error) {
      cleanupErrors.push(error);
    } finally {
      await Promise.allSettled([connectionWork, authJoined]);
      if (wasActive) {
        this.updateStatus(MCPServerStatus.DISCONNECTED, cleanupErrors);
      }
    }
    if (cleanupErrors.length === 1) {
      throw cleanupErrors[0];
    }
    if (cleanupErrors.length > 1) {
      throw new AggregateError(
        cleanupErrors,
        `Disconnect cleanup failed for '${this.serverName}'`,
      );
    }
  }

  getStatus(): MCPServerStatus {
    return this.status;
  }

  private updateStatus(status: MCPServerStatus, failures?: unknown[]): void {
    this.status = status;
    try {
      this.onStatus?.(status, this.requiresOAuth);
    } catch (error) {
      if (failures === undefined) throw error;
      failures.push(error);
    }
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
    cliConfig: Host.McpTrustConfig,
    options?: { timeout?: number; signal?: AbortSignal },
  ): Promise<DiscoveredMCPTool[]> {
    const client = this.getConnectedClient();
    const isAuthorized = this.createCapabilityAuthorization(client);
    return discoverTools(
      this.approvalPolicy,
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

  private async discoverPrompts(options?: {
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<Prompt[]> {
    const client = this.getConnectedClient();
    return discoverPrompts(this.serverName, client, {
      ...options,
      isAuthorized: this.createCapabilityAuthorization(client),
    });
  }

  private async discoverResources(options?: {
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<Resource[]> {
    const client = this.getConnectedClient();
    return discoverResources(this.serverName, client, {
      ...options,
      isAuthorized: this.createCapabilityAuthorization(client),
    });
  }

  private updateResourceRegistry(resources: Resource[]): void {
    this.resourceRegistry.setResourcesForServer(this.serverName, resources);
  }

  async readResource(
    uri: string,
    signal?: AbortSignal,
  ): Promise<ReadResourceResult> {
    const client = this.getConnectedClient();
    const isAuthorized = this.createCapabilityAuthorization(client);
    if (!isAuthorized()) {
      throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    }
    const result = await client.request(
      {
        method: 'resources/read',
        params: { uri },
      },
      ReadResourceResultSchema,
      { signal },
    );
    if (!isAuthorized()) {
      throw new Error(MCP_CAPABILITY_NOT_AUTHORIZED_MESSAGE);
    }
    return result;
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

  private removeAllServerArtifacts(): void {
    for (const [label, cleanup] of [
      [
        'tools',
        () => this.toolRegistry.removeMcpToolsByServer(this.serverName),
      ],
      [
        'prompts',
        () => this.promptRegistry.removePromptsByServer(this.serverName),
      ],
      [
        'resources',
        () => this.resourceRegistry.removeResourcesByServer(this.serverName),
      ],
    ] as const) {
      try {
        cleanup();
      } catch (cleanupError) {
        debugLogger.error(
          `Error cleaning up ${label} for '${this.serverName}': ${getErrorMessage(cleanupError)}`,
        );
      }
    }
  }

  private registerNotificationHandlers(client: Client): void {
    const capabilities = client.getServerCapabilities();

    if (capabilities?.tools?.listChanged === true) {
      debugLogger.log(
        `Server '${this.serverName}' supports tool updates. Listening for changes...`,
      );

      client.setNotificationHandler(
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

      client.setNotificationHandler(
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
        keepLooping = ok && this.pendingToolRefresh;
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
    return this.isCapabilityAuthorized(
      client,
      connectionGeneration,
      capabilityGeneration,
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
        if (this.cliConfig.isTrustedFolder() === false) {
          this.toolRegistry.removeMcpToolsByServer(this.serverName);
        }
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

      this.emitFeedback('info', `Tools updated for server: ${this.serverName}`);
      return true;
    } finally {
      clearTimeout(timeoutId);
      this.refreshAbortControllers.delete(abortController);
    }
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
        keepLooping = ok && this.pendingResourceRefresh;
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
        if (this.cliConfig.isTrustedFolder() === false) {
          this.resourceRegistry.removeResourcesByServer(this.serverName);
        }
        return false;
      }
      this.updateResourceRegistry(newResources);
      if (
        !this.isRefreshAuthorized(
          client,
          connectionGeneration,
          capabilityGeneration,
        )
      ) {
        this.resourceRegistry.removeResourcesByServer(this.serverName);
        return false;
      }

      this.emitFeedback(
        'info',
        `Resources updated for server: ${this.serverName}`,
      );
      return true;
    } finally {
      clearTimeout(timeoutId);
      this.refreshAbortControllers.delete(abortController);
    }
  }
}
