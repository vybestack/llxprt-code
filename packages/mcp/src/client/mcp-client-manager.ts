/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  LlxprtExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import {
  McpClient,
  MCPDiscoveryState,
  populateMcpServerCommand,
} from './mcp-client.js';
import { MCPServerStatus, updateMCPServerStatus } from './mcp-status.js';
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
import {
  appendFailures,
  throwTrustRevocationFailures,
} from './trust-revocation-errors.js';
import { RetryableClientDisconnections } from './retryable-client-disconnections.js';
import { collectMcpInstructions } from './mcp-instructions.js';
import {
  collectMcpServers,
  consumeMcpContextRefreshes,
  getConfiguredMcpReconciliation,
  isAllowedMcpServer,
  recordPendingDiscoveryTimeouts,
  reconcileConfiguredMcpClients,
  removeAndDisconnectMcpClient,
  removeMcpServerArtifacts,
  restartMcpClients,
  startConfiguredMcpClients,
  removeMcpServerState,
  stopMcpExtension,
  waitForMcpRefreshDebounce,
} from './mcp-client-manager-helpers.js';

const logger = new DebugLogger('llxprt:mcp-client-manager');

/**
 * Maximum time {@link McpClientManager.whenDiscoverySettled} will wait for MCP
 * discovery before resolving anyway. This bounds the agent discovery gate so a
 * server that never connects/disconnects cannot hang an interactive turn
 * forever (issue #2516). Any server still pending when this bound is hit is
 * recorded as a discovery failure. Used as the default settle timeout; callers
 * can override per-instance via the constructor.
 */
export const DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS = 10_000;

/**
 * Manages the lifecycle of multiple MCP clients, including local child processes.
 * This class is responsible for starting, stopping, and discovering tools from
 * a collection of MCP servers defined in the configuration.
 */
export class McpClientManager {
  private clients: Map<string, McpClient> = new Map();
  // If we have ongoing MCP client discovery, this completes once that is done.
  private discoveryPromise: Promise<void> | undefined;
  private discoveryState: MCPDiscoveryState = MCPDiscoveryState.NOT_STARTED;
  private pendingRefreshPromise: Promise<void> | null = null;
  private pendingRefreshTimer: ReturnType<typeof setTimeout> | undefined;
  private pendingRefreshTimerResolve: (() => void) | undefined;
  private refreshRequestedWhilePending = false;
  private readonly blockedMcpServers: Array<{
    name: string;
    extensionName: string;
  }> = [];
  private readonly discoveryFailures: Map<string, string> = new Map();
  private trustGeneration = 0;
  private readonly discoveringServers = new Map<string, Promise<void>>();
  private readonly queuedDiscoveryConfigs = new Map<string, MCPServerConfig>();
  private readonly connectingClients = new Map<string, McpClient>();
  private readonly quarantinedClients = new Map<string, McpClient>();
  private readonly clientDisconnections = new RetryableClientDisconnections();
  private stopped = false;
  private readonly pendingDiscoveryServers: Set<string> = new Set();
  private readonly fakeDiscoveryControllers = new Map<
    string,
    AbortController
  >();
  constructor(
    private readonly clientVersion: string,
    private readonly toolRegistry: ToolRegistry,
    private readonly cliConfig: Config,
    private readonly eventEmitter?: EventEmitter,
    private readonly settleTimeoutMs: number = DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS,
  ) {}
  getBlockedMcpServers() {
    return this.blockedMcpServers;
  }
  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Disconnects all MCP clients from their servers.
   *    - Updates the agent chat configuration to load the new tools.
   */
  async stopExtension(extension: LlxprtExtension) {
    logger.log(`Unloading extension: ${extension.name}`);
    await stopMcpExtension({
      extension,
      disconnect: (name) => this.disconnectClient(name, true),
      refresh: () => this.cliConfig.refreshMcpContext(),
    });
  }

  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Connects MCP clients to each server and discovers their tools.
   *    - Updates the agent chat configuration to load the new tools.
   */
  async startExtension(extension: LlxprtExtension) {
    logger.log(`Loading extension: ${extension.name}`);
    // Issue #2325: Fire MCP discovery without blocking — discovery completes
    // in the background and is tracked by whenDiscoverySettled().
    for (const [name, config] of Object.entries(extension.mcpServers ?? {})) {
      try {
        void this.maybeDiscoverMcpServer(name, { ...config, extension });
      } catch (error) {
        logger.warn(
          `Error dispatching MCP discovery for server '${name}': ${getErrorMessage(error)}`,
        );
      }
    }
    // refreshMcpContext here sees pre-discovery tool state, but connectAndDiscover
    // emits McpClientUpdate + calls scheduleMcpContextRefresh once each server
    // connects, so the context converges as servers come online.
    await this.cliConfig.refreshMcpContext();
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
    if (
      !isAllowedMcpServer(
        name,
        this.cliConfig.getAllowedMcpServers(),
        this.cliConfig.getBlockedMcpServers(),
      )
    ) {
      if (!this.blockedMcpServers.find((s) => s.name === name)) {
        this.blockedMcpServers.push({
          name,
          extensionName: config.extension?.name ?? '',
        });
      }
      return;
    }
    if (!this.cliConfig.isTrustedFolder() || this.stopped) {
      return;
    }
    if (config.extension && !config.extension.isActive) {
      return;
    }
    if (
      config.extension &&
      Object.prototype.hasOwnProperty.call(
        this.cliConfig.getMcpServers() ?? {},
        name,
      )
    ) {
      logger.warn(
        `Skipping MCP config for server with name "${name}" from extension "${config.extension.name}" because configured server names are reserved.`,
      );
      return;
    }
    const pendingDiscovery = this.discoveringServers.get(name);
    if (pendingDiscovery) {
      this.queuedDiscoveryConfigs.set(name, config);
      return pendingDiscovery;
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

    const currentDiscoveryPromise: Promise<void> = this.buildDiscoveryPromise(
      name,
      config,
      existing,
    ).then(() => this.finishDiscovery(name, currentDiscoveryPromise));
    this.discoveringServers.set(name, currentDiscoveryPromise);
    this.enqueueDiscovery(currentDiscoveryPromise);
    return currentDiscoveryPromise;
  }

  private async finishDiscovery(
    name: string,
    completedDiscovery: Promise<void>,
  ): Promise<void> {
    if (this.discoveringServers.get(name) !== completedDiscovery) {
      return;
    }
    this.discoveringServers.delete(name);
    const queuedConfig = this.queuedDiscoveryConfigs.get(name);
    this.queuedDiscoveryConfigs.delete(name);
    if (
      queuedConfig !== undefined &&
      this.cliConfig.isTrustedFolder() &&
      !this.stopped
    ) {
      await this.maybeDiscoverMcpServer(name, queuedConfig);
    }
  }

  private buildDiscoveryPromise(
    name: string,
    config: MCPServerConfig,
    existing: McpClient | undefined,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      void (async () => {
        this.pendingDiscoveryServers.add(name);
        try {
          await this.connectAndDiscover(name, config, existing);
        } catch (error) {
          this.pendingDiscoveryServers.delete(name);
          if (!isAuthenticationError(error)) {
            this.discoveryFailures.set(name, getErrorMessage(error));
            coreEvents.emitFeedback(
              'error',
              `Error during discovery for server '${name}': ${getErrorMessage(
                error,
              )}`,
              error,
            );
          }
          resolve();
          return;
        }
        this.pendingDiscoveryServers.delete(name);
        resolve();
      })();
    });
  }

  private removeServerArtifacts(name: string): void {
    removeMcpServerArtifacts(
      name,
      this.toolRegistry,
      this.cliConfig.getPromptRegistry(),
      this.cliConfig.getResourceRegistry(),
    );
  }

  private createClient(name: string, config: MCPServerConfig): McpClient {
    const client = new McpClient(
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
        debugLogger.log('Tools changed, updating agent context...');
        await this.scheduleMcpContextRefresh();
      },
    );
    this.clientDisconnections.activate(client);
    return client;
  }

  private isDiscoveryInvalid(generation: number): boolean {
    return (
      !this.cliConfig.isTrustedFolder() ||
      this.trustGeneration !== generation ||
      this.stopped
    );
  }

  private async removeAndDisconnectClient(
    name: string,
    client: McpClient,
  ): Promise<void> {
    await removeAndDisconnectMcpClient({
      name,
      client,
      isCurrent: () => this.clients.get(name) === client,
      removeCurrent: () => this.clients.delete(name),
      removeArtifacts: () => this.removeServerArtifacts(name),
      emitCleanup: () =>
        this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
          clients: new Map(this.clients),
        }),
      disconnect: (currentClient) =>
        this.clientDisconnections.disconnect(currentClient),
      reportError: (message, error) =>
        logger.warn(`${message}: ${getErrorMessage(error)}`),
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

    const generationBeforeConnect = this.trustGeneration;

    if (existing) {
      await this.removeAndDisconnectClient(name, existing);
    }

    if (this.isDiscoveryInvalid(generationBeforeConnect)) {
      return;
    }

    const client = this.createClient(name, config);
    this.connectingClients.set(name, client);
    try {
      await client.connect();
      this.connectingClients.delete(name);

      // Re-check trust after connect — trust may have been revoked during
      // the (potentially slow) connect handshake. If so, disconnect and
      // do NOT register the client.
      if (this.isDiscoveryInvalid(generationBeforeConnect)) {
        await this.removeAndDisconnectClient(name, client);
        return;
      }

      this.clients.set(name, client);
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      await client.discover(
        this.cliConfig,
        () => !this.isDiscoveryInvalid(generationBeforeConnect),
      );

      // Re-check trust after discover — trust may have been revoked during
      // the (potentially slow) discovery handshake. If so, remove the
      // client and disconnect it.
      if (this.isDiscoveryInvalid(generationBeforeConnect)) {
        await this.removeAndDisconnectClient(name, client);
        return;
      }

      this.discoveryFailures.delete(name);
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    } catch (error) {
      this.connectingClients.delete(name);
      if (this.clients.get(name) === client) {
        this.clients.delete(name);
      }
      try {
        this.removeServerArtifacts(name);
      } catch (cleanupError) {
        logger.warn(
          `Error removing artifacts for failed MCP client '${name}': ${getErrorMessage(cleanupError)}`,
        );
      }
      try {
        await this.clientDisconnections.disconnect(client);
      } catch (cleanupError) {
        logger.warn(
          `Error cleaning up failed MCP client '${name}': ${getErrorMessage(cleanupError)}`,
        );
      }
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      // Record the per-server failure so the discovery gate can surface a
      // warning without aborting the whole turn (issue #2516). Auth errors
      // are excluded so an interactive OAuth flow is not treated as a failure;
      // clear any stale timeout entry too, so a server that was awaiting auth
      // when the settle timeout fired is not left with a bogus "Timed out".
      if (!isAuthenticationError(error)) {
        this.discoveryFailures.set(name, getErrorMessage(error));
        coreEvents.emitFeedback(
          'error',
          `Error during discovery for server '${name}': ${getErrorMessage(
            error,
          )}`,
          error,
        );
      } else {
        // Interactive auth is not a failure — clear any stale timeout entry
        // recorded by recordPendingDiscoveryTimeouts while auth was pending.
        this.discoveryFailures.delete(name);
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
    const generationBeforeConnect = this.trustGeneration;
    const isAuthorized = (): boolean =>
      !this.isDiscoveryInvalid(generationBeforeConnect);

    if (existing) {
      await this.removeAndDisconnectClient(name, existing);
    }
    if (!isAuthorized()) {
      return;
    }

    const fixture = loadFakeMcpFixture();
    if (fixture === undefined || !isAuthorized()) {
      return;
    }

    const client = this.createClient(name, config);
    const discoveryController = new AbortController();
    this.fakeDiscoveryControllers.set(name, discoveryController);
    this.clients.set(name, client);
    try {
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      if (!isAuthorized()) {
        await this.removeAndDisconnectClient(name, client);
        return;
      }

      this.discoveryFailures.delete(name);
      const outcome = await applyFakeServerDiscovery(
        name,
        this.toolRegistry,
        fixture,
        isAuthorized,
        discoveryController.signal,
      );
      if (!isAuthorized()) {
        await this.removeAndDisconnectClient(name, client);
        return;
      }
      if (
        outcome.status !== MCPServerStatus.CONNECTED ||
        outcome.failure !== undefined
      ) {
        if (outcome.failure !== undefined) {
          this.discoveryFailures.set(name, outcome.failure);
        }
        await this.removeAndDisconnectClient(name, client);
        return;
      }

      client.markConnectedForFakeDiscovery();
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      if (!isAuthorized()) {
        await this.removeAndDisconnectClient(name, client);
      }
    } catch (error) {
      try {
        updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED);
      } finally {
        await this.removeAndDisconnectClient(name, client);
      }
      throw error;
    } finally {
      if (this.fakeDiscoveryControllers.get(name) === discoveryController) {
        this.fakeDiscoveryControllers.delete(name);
      }
    }
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
   * settings or command line arguments).
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
    const emitUpdate = () =>
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    await startConfiguredMcpClients({
      trusted: this.cliConfig.isTrustedFolder(),
      resolveServers: () =>
        populateMcpServerCommand(
          this.cliConfig.getMcpServers() ?? {},
          this.cliConfig.getMcpServerCommand(),
        ),
      completeEmpty: () => {
        this.discoveryState = MCPDiscoveryState.COMPLETED;
      },
      emitUpdate,
      discover: (name, config) => this.maybeDiscoverMcpServer(name, config),
      refresh: () => this.cliConfig.refreshMcpContext(),
    });
  }

  /**
   * Called when folder trust transitions to trusted during the active
   * session. Discovers all configured MCP servers that were previously
   * suppressed because the folder was untrusted.
   */
  async onFolderTrustGained(): Promise<void> {
    if (this.stopped) {
      return;
    }
    const servers = populateMcpServerCommand(
      this.cliConfig.getMcpServers() ?? {},
      this.cliConfig.getMcpServerCommand(),
    );
    const discoverPromises: Array<Promise<void>> = [];
    for (const [name, config] of Object.entries(servers)) {
      discoverPromises.push(
        (async () => {
          try {
            await this.maybeDiscoverMcpServer(name, config);
          } catch (error) {
            logger.warn(
              `Error discovering server '${name}' on trust gain: ${getErrorMessage(error)}`,
            );
          }
        })(),
      );
    }

    await Promise.all(discoverPromises);
    discoverPromises.length = 0;

    // Configured servers have precedence. Extension servers retry only after
    // configured discovery has either succeeded or released its reservation.
    for (const extension of this.cliConfig.getExtensions()) {
      if (!extension.isActive) {
        continue;
      }
      for (const [name, config] of Object.entries(extension.mcpServers ?? {})) {
        discoverPromises.push(
          (async () => {
            try {
              await this.maybeDiscoverMcpServer(name, {
                ...config,
                extension,
              });
            } catch (error) {
              logger.warn(
                `Error discovering extension server '${name}' on trust gain: ${getErrorMessage(error)}`,
              );
            }
          })(),
        );
      }
    }

    if (discoverPromises.length === 0) {
      this.discoveryState = MCPDiscoveryState.COMPLETED;
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
      await this.cliConfig.refreshMcpContext();
      return;
    }

    await Promise.all(discoverPromises);
    await this.cliConfig.refreshMcpContext();
  }

  /**
   * Called when folder trust transitions to untrusted during the active
   * session. Securely disconnects all running MCP servers and removes their
   * tools from the registry so no untrusted MCP server remains reachable.
   */
  quarantineForTrustRevocation(): void {
    this.trustGeneration++;
    for (const controller of this.fakeDiscoveryControllers.values()) {
      controller.abort();
    }
    const failures: unknown[] = [];
    const serverNames = new Set([
      ...this.clients.keys(),
      ...this.discoveringServers.keys(),
      ...this.connectingClients.keys(),
    ]);
    const clientsToQuarantine = new Map([
      ...this.clients.entries(),
      ...this.connectingClients.entries(),
    ]);
    for (const [name, client] of clientsToQuarantine) {
      try {
        client.invalidateCapabilities();
      } catch (error) {
        appendFailures(failures, error);
      }
      try {
        client.abortDiscovery();
      } catch (error) {
        appendFailures(failures, error);
      }
      this.clientDisconnections.retire(client);
      this.quarantinedClients.set(name, client);
    }
    this.clients.clear();
    this.connectingClients.clear();
    for (const name of serverNames) {
      removeMcpServerState(
        name,
        () => updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED),
        () => this.removeServerArtifacts(name),
        failures,
      );
    }
    try {
      this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
        clients: new Map(this.clients),
      });
    } catch (error) {
      appendFailures(failures, error);
    }
    throwTrustRevocationFailures(
      failures,
      'MCP trust revocation quarantine failed',
    );
  }

  async onFolderTrustRevoked(): Promise<void> {
    const failures: unknown[] = [];
    try {
      this.quarantineForTrustRevocation();
    } catch (error) {
      appendFailures(failures, error);
    }
    const entries = new Map(this.quarantinedClients);
    this.quarantinedClients.clear();
    await Promise.all(
      Array.from(entries).map(async ([name, client]) => {
        try {
          await this.clientDisconnections.disconnect(client);
        } catch (error) {
          appendFailures(failures, error);
          debugLogger.error(
            `Error disconnecting client '${name}' on trust revocation: ${getErrorMessage(error)}`,
          );
        }
      }),
    );
    try {
      await this.cliConfig.refreshMcpContext();
    } catch (error) {
      appendFailures(failures, error);
      debugLogger.error(
        `Error refreshing MCP context on trust revocation: ${getErrorMessage(error)}`,
      );
    }
    throwTrustRevocationFailures(failures, 'MCP trust revocation failed');
  }

  async reconcileConfiguredMcpServers(): Promise<void> {
    if (!this.cliConfig.isTrustedFolder() || this.stopped) return;
    this.trustGeneration++;
    const reconciliation = getConfiguredMcpReconciliation(
      this.clients,
      populateMcpServerCommand(
        this.cliConfig.getMcpServers() ?? {},
        this.cliConfig.getMcpServerCommand(),
      ),
    );
    await reconcileConfiguredMcpClients({
      reconciliation,
      failedNames: this.discoveryFailures.keys(),
      remove: (name, client) => this.removeAndDisconnectClient(name, client),
      deleteFailure: (name) => this.discoveryFailures.delete(name),
      discover: (name, config) => this.maybeDiscoverMcpServer(name, config),
      refresh: () => this.cliConfig.refreshMcpContext(),
    });
  }

  /**
   * Restarts all active MCP Clients.
   */
  async restart(): Promise<void> {
    await restartMcpClients({
      clients: this.clients,
      discover: (name, config) => this.maybeDiscoverMcpServer(name, config),
      refresh: () => this.cliConfig.refreshMcpContext(),
      reportError: (name, error) => {
        logger.error(
          `Error restarting client '${name}': ${getErrorMessage(error)}`,
        );
      },
    });
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
    this.stopped = true;
    this.trustGeneration++;
    this.refreshRequestedWhilePending = false;
    if (this.pendingRefreshTimer !== undefined) {
      clearTimeout(this.pendingRefreshTimer);
      this.pendingRefreshTimer = undefined;
      this.pendingRefreshTimerResolve?.();
      this.pendingRefreshTimerResolve = undefined;
    }
    const pendingRefresh = this.pendingRefreshPromise;
    for (const controller of this.fakeDiscoveryControllers.values()) {
      controller.abort();
    }
    const failures: unknown[] = [];
    const serverNames = new Set(this.discoveringServers.keys());
    const clientsByIdentity = new Map<McpClient, string>();
    for (const client of this.clientDisconnections.getFailed()) {
      clientsByIdentity.set(client, 'retired');
    }
    for (const [name, client] of [
      ...this.clients.entries(),
      ...this.connectingClients.entries(),
      ...this.quarantinedClients.entries(),
    ]) {
      serverNames.add(name);
      clientsByIdentity.set(client, clientsByIdentity.get(client) ?? name);
      this.clientDisconnections.retire(client);
    }
    this.clients.clear();
    this.connectingClients.clear();
    this.quarantinedClients.clear();
    for (const name of serverNames) {
      removeMcpServerState(
        name,
        () => updateMCPServerStatus(name, MCPServerStatus.DISCONNECTED),
        () => this.removeServerArtifacts(name),
        failures,
      );
    }
    for (const result of await Promise.allSettled([
      ...Array.from(clientsByIdentity.keys(), (client) =>
        this.clientDisconnections.disconnect(client),
      ),
      this.whenDiscoverySettled(),
      pendingRefresh ?? Promise.resolve(),
    ])) {
      if (result.status === 'rejected') {
        appendFailures(failures, result.reason);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, 'MCP client manager stop failed');
    }
  }

  getDiscoveryState(): MCPDiscoveryState {
    return this.discoveryState;
  }

  /**
   * Resolves once any in-flight discovery pass has settled. When no discovery
   * is in flight this resolves immediately. Used by the public Agent discovery
   * gate to await MCP readiness before a model turn.
   *
   * The wait is BOUNDED by this instance's settle timeout (defaults to
   * {@link DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS}): if a server's
   * transport/discovery never settles, this still resolves so an interactive
   * turn cannot hang forever. Servers still pending when the bound is hit are
   * recorded as discovery failures (issue #2516).
   *
   * @plan:PLAN-20260617-COREAPI.P22
   * @requirement:REQ-013
   */
  async whenDiscoverySettled(): Promise<void> {
    const pending = this.discoveryPromise;
    if (pending === undefined) {
      return;
    }
    const settleTimeout = this.settleTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        recordPendingDiscoveryTimeouts(
          this.pendingDiscoveryServers,
          this.discoveryFailures,
          this.settleTimeoutMs,
          () =>
            this.eventEmitter?.emit(CoreEvent.McpClientUpdate, {
              clients: new Map(this.clients),
            }),
        );
        resolve();
      }, settleTimeout);
    });
    // Note: a settled timer does NOT cancel the underlying discovery promise.
    // The still-pending servers continue in the background and either succeed
    // (clearing their failure) or fail (recording it); either way the gate no
    // longer blocks the turn. The timer is cleared in the `finally` below once
    // the race resolves (whichever side wins).
    try {
      await Promise.race([pending, timeoutPromise]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  getMcpServers(): Record<string, MCPServerConfig> {
    return collectMcpServers(this.clients);
  }

  getClient(name: string): McpClient | undefined {
    return this.clients.get(name);
  }

  private async consumeMcpContextRefreshes(): Promise<void> {
    try {
      await consumeMcpContextRefreshes({
        isStopped: () => this.stopped,
        readRequested: () => this.refreshRequestedWhilePending,
        clearRequested: () => {
          this.refreshRequestedWhilePending = false;
        },
        waitForDebounce: () =>
          waitForMcpRefreshDebounce(
            (timer) => {
              this.pendingRefreshTimer = timer;
            },
            () => {
              this.pendingRefreshTimer = undefined;
            },
            (resolve) => {
              this.pendingRefreshTimerResolve = resolve;
            },
          ),
        refresh: () => this.cliConfig.refreshMcpContext(),
        reportError: (error) =>
          debugLogger.error(
            `Error refreshing MCP context: ${getErrorMessage(error)}`,
          ),
      });
    } finally {
      this.pendingRefreshPromise = null;
    }
  }

  private async scheduleMcpContextRefresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.pendingRefreshPromise) {
      this.refreshRequestedWhilePending = true;
      return this.pendingRefreshPromise;
    }
    this.pendingRefreshPromise = this.consumeMcpContextRefreshes();
    return this.pendingRefreshPromise;
  }

  getMcpServerCount(): number {
    return this.clients.size;
  }

  getMcpInstructions(): string {
    return collectMcpInstructions(this.clients);
  }
}
