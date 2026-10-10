/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MCPServerConfig, McpExtensionConfig } from '../config/index.js';
import type { McpOAuthBinding } from '../auth/index.js';
import type {
  McpApprovalPolicy,
  McpHostConfig,
  McpPromptRegistry,
  McpResourceRegistry,
} from '../host/hostInterfaces.js';
import type { McpToolPublication } from '@vybestack/llxprt-code-tools';
import {
  MCPDiscoveryState,
  populateMcpServerCommand,
  type McpClient,
} from './mcp-client.js';
import { MCPServerStatus } from './mcp-status.js';
import { McpOwnerStatus } from './mcp-owner-status.js';
import {
  applyFakeServerDiscovery,
  isFakeMcpDiscoveryActive,
  loadFakeMcpFixture,
} from '../fake/fakeMcpDiscovery.js';
import {
  getErrorMessage,
  isAuthenticationError,
} from '@vybestack/llxprt-code-tools/utils/errors.js';
import type { EventEmitter } from 'node:events';
import {
  captureHostFeedback,
  type HostFeedbackSink,
  MCP_CLIENT_UPDATE_EVENT,
} from '../host/hostServices.js';
import { DebugLogger } from '@vybestack/llxprt-code-telemetry/debug/index.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry/utils/debugLogger.js';
import {
  appendFailures,
  throwTrustRevocationFailures,
} from './trust-revocation-errors.js';
import { RetryableClientDisconnections } from './retryable-client-disconnections.js';
import { collectMcpInstructions } from './mcp-instructions.js';
import {
  collectMcpServers,
  createConfiguredMcpClient,
  consumeMcpContextRefreshes,
  getConfiguredMcpReconciliation,
  abortMcpDiscoveryControllers,
  quarantineMcpClients,
  collectMcpRetirementClients,
  cancelMcpRefreshTimer,
  rejectMcpReconciliationErrors,
  settleMcpDisconnections,
  isAllowedMcpServer,
  recordPendingDiscoveryTimeouts,
  recordMcpDiscoveryFailure,
  rejectConflictingMcpExtension,
  rejectReservedExtensionMcpServer,
  reconcileConfiguredMcpClients,
  removeAndDisconnectMcpClient,
  removeMcpServerArtifacts,
  restartMcpClients,
  restartMcpServer,
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
  private readonly serverStatus = new McpOwnerStatus();
  readonly getServerStates = this.serverStatus.states;
  readonly getStatusServers = this.serverStatus.servers;
  readonly getServerStatus = this.serverStatus.status;
  readonly subscribeStatus = this.serverStatus.subscribe;

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
  private readonly discoveryErrors = new Map<string, unknown>();
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
  private readonly emitFeedback: HostFeedbackSink;
  private readonly oauth: McpOAuthBinding;
  constructor(
    oauth: McpOAuthBinding,
    private readonly approvalPolicy: McpApprovalPolicy,
    private readonly clientVersion: string,
    private readonly toolRegistry: McpToolPublication,
    private readonly promptPublication: McpPromptRegistry,
    private readonly resourcePublication: McpResourceRegistry,
    private readonly cliConfig: McpHostConfig,
    private readonly refreshContext: () => Promise<void>,
    private readonly eventEmitter?: EventEmitter,
    private readonly settleTimeoutMs: number = DEFAULT_MCP_DISCOVERY_SETTLE_TIMEOUT_MS,
    feedback?: HostFeedbackSink,
  ) {
    this.emitFeedback = captureHostFeedback(feedback);
    this.oauth = { ...oauth };
  }
  private emitClientUpdate(): void {
    if (this.stopped) return;
    this.eventEmitter?.emit(MCP_CLIENT_UPDATE_EVENT, {
      clients: new Map(this.clients),
    });
  }

  getBlockedMcpServers = () => this.blockedMcpServers;
  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Disconnects all MCP clients from their servers.
   *    - Updates the agent chat configuration to load the new tools.
   */
  async stopExtension(extension: McpExtensionConfig) {
    logger.log(`Unloading extension: ${extension.name}`);
    await stopMcpExtension({
      extension,
      disconnect: (name) => this.disconnectClient(name, true),
      refresh: () => this.refreshContext(),
    });
  }

  /**
   * For all the MCP servers associated with this extension:
   *
   *    - Connects MCP clients to each server and discovers their tools.
   *    - Updates the agent chat configuration to load the new tools.
   */
  async startExtension(extension: McpExtensionConfig) {
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
    await this.refreshContext();
  }

  private async disconnectClient(name: string, skipRefresh = false) {
    const existing = this.clients.get(name);
    if (existing) {
      try {
        this.clients.delete(name);
        this.emitClientUpdate();
        await existing.disconnect();
      } catch (error) {
        logger.warn(
          `Error stopping client '${name}': ${getErrorMessage(error)}`,
        );
      } finally {
        if (!skipRefresh) {
          // This is required to update the content generator configuration with the
          // new tool configuration and system instructions.
          await this.refreshContext();
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
      rejectReservedExtensionMcpServer(
        name,
        config,
        this.cliConfig.getMcpServers(),
        (message) => logger.warn(message),
      )
    )
      return;
    const pendingDiscovery = this.discoveringServers.get(name);
    if (pendingDiscovery) {
      this.queuedDiscoveryConfigs.set(name, config);
      return pendingDiscovery;
    }
    const existing = this.clients.get(name);
    if (
      rejectConflictingMcpExtension(name, config, existing, (message) =>
        logger.warn(message),
      )
    )
      return;

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

  private async buildDiscoveryPromise(
    name: string,
    config: MCPServerConfig,
    existing: McpClient | undefined,
  ): Promise<void> {
    this.pendingDiscoveryServers.add(name);
    this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
    this.discoveryFailures.delete(name);
    this.discoveryErrors.delete(name);
    this.serverStatus.ensure(name, config);
    try {
      await this.connectAndDiscover(name, config, existing);
    } catch (error) {
      this.discoveryErrors.set(name, error);
      this.pendingDiscoveryServers.delete(name);
      if (!isAuthenticationError(error)) {
        this.reportDiscoveryFailure(name, error);
      }
      return;
    }
    this.pendingDiscoveryServers.delete(name);
  }

  private reportDiscoveryFailure(name: string, error: unknown): void {
    if (this.stopped) return;
    recordMcpDiscoveryFailure(
      name,
      error,
      this.discoveryFailures,
      this.serverStatus,
      this.emitFeedback,
    );
  }

  private removeServerArtifacts(name: string): void {
    removeMcpServerArtifacts(
      name,
      this.toolRegistry,
      this.promptPublication,
      this.resourcePublication,
    );
  }

  private createClient(name: string, config: MCPServerConfig): McpClient {
    const client = createConfiguredMcpClient(
      this.oauth,
      this.approvalPolicy,
      this.clientVersion,
      this.toolRegistry,
      this.promptPublication,
      this.resourcePublication,
      this.cliConfig,
      name,
      config,
      async () => {
        debugLogger.log('Tools changed, updating agent context...');
        await this.scheduleMcpContextRefresh();
      },
      this.emitFeedback,
      this.serverStatus.begin(name, config),
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
      emitCleanup: () => this.emitClientUpdate(),
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
      this.emitClientUpdate();
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
      this.emitClientUpdate();
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
      this.emitClientUpdate();
      // Record the per-server failure so the discovery gate can surface a
      // warning without aborting the whole turn (issue #2516). Auth errors
      // are excluded so an interactive OAuth flow is not treated as a failure;
      // clear any stale timeout entry too, so a server that was awaiting auth
      // when the settle timeout fired is not left with a bogus "Timed out".
      if (this.isDiscoveryInvalid(generationBeforeConnect)) return;
      if (isAuthenticationError(error)) {
        // Interactive auth is not a failure — clear any stale timeout entry
        // recorded by recordPendingDiscoveryTimeouts while auth was pending.
        this.discoveryFailures.delete(name);
      }
      throw error;
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
      this.emitClientUpdate();
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
        (status) => {
          if (isAuthorized()) this.serverStatus.update(name, status);
        },
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
          this.serverStatus.update(name, MCPServerStatus.DISCONNECTED);
        }
        await this.removeAndDisconnectClient(name, client);
        return;
      }

      client.markConnectedForFakeDiscovery();
      this.emitClientUpdate();
      if (!isAuthorized()) {
        await this.removeAndDisconnectClient(name, client);
      }
    } catch (error) {
      try {
        this.serverStatus.update(name, MCPServerStatus.DISCONNECTED);
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
  readonly getDiscoveryFailures = (): ReadonlyMap<string, string> =>
    new Map(this.discoveryFailures);

  private enqueueDiscovery(promise: Promise<void>): void {
    if (this.discoveryPromise) {
      this.discoveryPromise = this.discoveryPromise.then(() => promise);
    } else {
      this.discoveryState = MCPDiscoveryState.IN_PROGRESS;
      this.discoveryPromise = promise;
    }
    this.emitClientUpdate();
    const currentPromise = this.discoveryPromise;
    void currentPromise.then((_) => {
      if (currentPromise === this.discoveryPromise) {
        this.discoveryPromise = undefined;
        this.discoveryState = MCPDiscoveryState.COMPLETED;
        this.serverStatus.publishDiscoveryComplete();
        this.emitClientUpdate();
      }
    });
  }

  /**
   * Initiates the tool discovery process for all configured MCP servers (via
   * settings or command line arguments).
   *
   * It connects to each server, discovers its available tools, and registers
   * them with the `McpToolPublication`.
   *
   * For any server which is already connected, it will first be disconnected.
   *
   * This does NOT load extension MCP servers - this happens when the
   * ExtensionLoader explicitly calls `loadExtension`.
   */
  async startConfiguredMcpServers(): Promise<void> {
    const emitUpdate = () => this.emitClientUpdate();
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
      refresh: () => this.refreshContext(),
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
      this.emitClientUpdate();
      await this.refreshContext();
      return;
    }

    await Promise.all(discoverPromises);
    await this.refreshContext();
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
    quarantineMcpClients(
      clientsToQuarantine,
      (name) => this.serverStatus.retire(name),
      (name, client) => {
        this.clientDisconnections.retire(client);
        this.quarantinedClients.set(name, client);
      },
      failures,
    );
    this.clients.clear();
    this.connectingClients.clear();
    for (const name of serverNames) {
      removeMcpServerState(
        name,
        () => this.serverStatus.update(name, MCPServerStatus.DISCONNECTED),
        () => this.removeServerArtifacts(name),
        failures,
      );
    }
    try {
      this.emitClientUpdate();
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
      await this.refreshContext();
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
      deleteFailure: (name) => {
        this.discoveryFailures.delete(name);
        this.serverStatus.forget(name);
      },
      discover: (name, config) => this.maybeDiscoverMcpServer(name, config),
      refresh: () => this.refreshContext(),
    });
    rejectMcpReconciliationErrors(
      reconciliation.discoveries,
      this.discoveryErrors,
    );
  }

  /**
   * Restarts all active MCP Clients.
   */
  async restart(): Promise<void> {
    await restartMcpClients({
      clients: this.clients,
      discover: (name, config) => this.maybeDiscoverMcpServer(name, config),
      refresh: () => this.refreshContext(),
      reportError: (name, error) =>
        logger.error(
          `Error restarting client '${name}': ${getErrorMessage(error)}`,
        ),
    });
  }

  /**
   * Restart a single MCP server by name.
   */
  restartServer(name: string): Promise<void> {
    return restartMcpServer({
      name,
      clients: this.clients,
      configured: this.cliConfig.getMcpServers(),
      discover: (server, config) => this.maybeDiscoverMcpServer(server, config),
      refresh: () => this.refreshContext(),
    });
  }

  /**
   * Stops all running local MCP servers and closes all client connections.
   * This is the cleanup method to be called on application exit.
   */
  cancelDiscovery(): Promise<void> {
    this.stopped = true;
    this.serverStatus.stopAdmission();
    this.trustGeneration++;
    this.refreshRequestedWhilePending = false;
    cancelMcpRefreshTimer(
      this.pendingRefreshTimer,
      this.pendingRefreshTimerResolve,
    );
    this.pendingRefreshTimer = undefined;
    this.pendingRefreshTimerResolve = undefined;
    return abortMcpDiscoveryControllers(
      this.fakeDiscoveryControllers.values(),
      this.clients.values(),
      this.connectingClients.values(),
      (client) => this.clientDisconnections.disconnect(client),
      this.discoveringServers.values(),
      this.pendingRefreshPromise,
    );
  }

  async stop(): Promise<void> {
    const cancellation = this.cancelDiscovery();
    const failures: unknown[] = [];
    const { serverNames, clientsByIdentity } = collectMcpRetirementClients(
      this.clientDisconnections.getFailed(),
      [this.clients, this.connectingClients, this.quarantinedClients],
      this.discoveringServers.keys(),
    );
    this.clients.clear();
    this.connectingClients.clear();
    this.quarantinedClients.clear();
    for (const name of serverNames) {
      removeMcpServerState(
        name,
        () => this.serverStatus.update(name, MCPServerStatus.DISCONNECTING),
        () => this.removeServerArtifacts(name),
        failures,
      );
    }
    failures.push(
      ...(await settleMcpDisconnections(
        [
          ...Array.from(clientsByIdentity.keys(), (client) =>
            this.clientDisconnections.disconnect(client),
          ),
          this.whenDiscoverySettled(),
          cancellation,
        ],
        serverNames,
        (name) => this.serverStatus.update(name, MCPServerStatus.DISCONNECTED),
      )),
    );
    this.serverStatus.release();
    if (failures.length > 0) {
      throw new AggregateError(failures, 'MCP client manager stop failed');
    }
  }

  readonly getDiscoveryState = (): MCPDiscoveryState => this.discoveryState;

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
          () => this.emitClientUpdate(),
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

  readonly getMcpServers = (): Record<string, MCPServerConfig> =>
    collectMcpServers(this.clients);

  readonly getClient = (name: string): McpClient | undefined =>
    this.clients.get(name);

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
        refresh: () => this.refreshContext(),
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

  readonly getMcpServerCount = (): number => this.clients.size;

  readInstructions = (): string => collectMcpInstructions(this.clients);
}
