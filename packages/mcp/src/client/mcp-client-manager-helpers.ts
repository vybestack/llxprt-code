/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MCPServerConfig, McpExtensionConfig } from '../config/index.js';
import type {
  McpPromptRegistry,
  McpResourceRegistry,
} from '../host/hostInterfaces.js';
import { McpClient } from './mcp-client.js';
import type { McpOAuthBinding } from '../auth/index.js';
import type {
  McpApprovalPolicy,
  McpHostConfig,
} from '../host/hostInterfaces.js';
import type { HostFeedbackSink } from '../host/hostServices.js';
import { MCPServerStatus } from './mcp-status.js';
import type { McpOwnerStatus } from './mcp-owner-status.js';
import { getErrorMessage } from '@vybestack/llxprt-code-tools/utils/errors.js';
import type { McpToolPublication } from '@vybestack/llxprt-code-tools';
import { isDeepStrictEqual } from 'node:util';
import { appendFailures } from './trust-revocation-errors.js';

export function isAllowedMcpServer(
  name: string,
  allowedNames: readonly string[] | undefined,
  blockedServers: ReadonlyArray<{ readonly name: string }> | undefined,
): boolean {
  if (
    allowedNames !== undefined &&
    allowedNames.length > 0 &&
    !allowedNames.includes(name)
  ) {
    return false;
  }
  return !(
    blockedServers !== undefined &&
    blockedServers.length > 0 &&
    blockedServers.some((server) => server.name === name)
  );
}

export function recordPendingDiscoveryTimeouts(
  pendingServers: Set<string>,
  discoveryFailures: Map<string, string>,
  settleTimeoutMs: number,
  onRecorded: () => void,
): void {
  if (pendingServers.size === 0) {
    return;
  }
  for (const name of pendingServers) {
    if (!discoveryFailures.has(name)) {
      discoveryFailures.set(
        name,
        `Timed out after ${settleTimeoutMs}ms waiting for discovery to settle.`,
      );
    }
  }
  pendingServers.clear();
  onRecorded();
}

export function isRefreshRequested(readRequested: () => boolean): boolean {
  return readRequested();
}

export async function waitForMcpRefreshDebounce(
  setTimer: (timer: ReturnType<typeof setTimeout>) => void,
  clearTimer: () => void,
  setResolve: (resolve: (() => void) | undefined) => void,
): Promise<void> {
  await new Promise<void>((resolve) => {
    setResolve(resolve);
    setTimer(
      setTimeout(() => {
        clearTimer();
        setResolve(undefined);
        resolve();
      }, 300),
    );
  });
}

export async function consumeMcpContextRefreshes({
  isStopped,
  readRequested,
  clearRequested,
  waitForDebounce,
  refresh,
  reportError,
}: {
  isStopped: () => boolean;
  readRequested: () => boolean;
  clearRequested: () => void;
  waitForDebounce: () => Promise<void>;
  refresh: () => Promise<void>;
  reportError: (error: unknown) => void;
}): Promise<void> {
  do {
    clearRequested();
    await waitForDebounce();
    if (!isStopped()) {
      try {
        await refresh();
      } catch (error) {
        reportError(error);
      }
    }
  } while (!isStopped() && isRefreshRequested(readRequested));
}

export function collectMcpServers(
  clients: ReadonlyMap<string, McpClient>,
): Record<string, MCPServerConfig> {
  return Object.fromEntries(
    Array.from(clients, ([name, client]) => [name, client.getServerConfig()]),
  );
}
export interface ConfiguredMcpReconciliation {
  readonly removals: ReadonlyArray<readonly [string, McpClient]>;
  readonly discoveries: ReadonlyArray<readonly [string, MCPServerConfig]>;
  readonly configuredNames: ReadonlySet<string>;
}

export function getConfiguredMcpReconciliation(
  clients: ReadonlyMap<string, McpClient>,
  configuredServers: Readonly<Record<string, MCPServerConfig>>,
): ConfiguredMcpReconciliation {
  const configuredNames = new Set(Object.keys(configuredServers));
  const removals = Array.from(clients.entries()).filter(
    ([name, client]) =>
      !configuredNames.has(name) &&
      client.getServerConfig().extension === undefined,
  );
  const discoveries = Object.entries(configuredServers).filter(
    ([name, config]) => {
      const client = clients.get(name);
      return (
        client === undefined ||
        !isDeepStrictEqual(client.getServerConfig(), config)
      );
    },
  );
  return { removals, discoveries, configuredNames };
}

export async function removeAndDisconnectMcpClient({
  name,
  client,
  isCurrent,
  removeCurrent,
  removeArtifacts,
  emitCleanup,
  disconnect,
  reportError,
}: {
  name: string;
  client: McpClient;
  isCurrent: () => boolean;
  removeCurrent: () => void;
  removeArtifacts: () => void;
  emitCleanup: () => void;
  disconnect: (client: McpClient) => Promise<void>;
  reportError: (message: string, error: unknown) => void;
}): Promise<void> {
  if (isCurrent()) {
    removeCurrent();
    for (const [message, cleanup] of [
      [`Error removing artifacts for MCP client '${name}'`, removeArtifacts],
      [`Error emitting cleanup for MCP client '${name}'`, emitCleanup],
    ] as const) {
      try {
        cleanup();
      } catch (error) {
        reportError(message, error);
      }
    }
  }
  try {
    await disconnect(client);
  } catch (error) {
    reportError(`Error cleaning up failed MCP client '${name}'`, error);
  }
}

export async function startConfiguredMcpClients({
  trusted,
  resolveServers,
  completeEmpty,
  emitUpdate,
  discover,
  refresh,
}: {
  trusted: boolean;
  resolveServers: () => Readonly<Record<string, MCPServerConfig>>;
  completeEmpty: () => void;
  emitUpdate: () => void;
  discover: (name: string, config: MCPServerConfig) => Promise<void> | void;
  refresh: () => Promise<void>;
}): Promise<void> {
  if (!trusted) {
    return;
  }
  const servers = resolveServers();
  if (Object.keys(servers).length === 0) {
    completeEmpty();
    emitUpdate();
    await refresh();
    return;
  }
  emitUpdate();
  await Promise.all(
    Object.entries(servers).map(([name, config]) => discover(name, config)),
  );
  await refresh();
}

export async function reconcileConfiguredMcpClients({
  reconciliation,
  failedNames,
  remove,
  deleteFailure,
  discover,
  refresh,
}: {
  reconciliation: ConfiguredMcpReconciliation;
  failedNames: Iterable<string>;
  remove: (name: string, client: McpClient) => Promise<void>;
  deleteFailure: (name: string) => void;
  discover: (name: string, config: MCPServerConfig) => Promise<void> | void;
  refresh: () => Promise<void>;
}): Promise<void> {
  for (const failedName of failedNames) {
    if (!reconciliation.configuredNames.has(failedName)) {
      deleteFailure(failedName);
    }
  }
  await Promise.all(
    reconciliation.removals.map(async ([name, client]) => {
      await remove(name, client);
      deleteFailure(name);
    }),
  );
  await Promise.all(
    reconciliation.discoveries.map(([name, config]) => discover(name, config)),
  );
  await refresh();
}
export async function stopMcpExtension({
  extension,
  disconnect,
  refresh,
}: {
  extension: McpExtensionConfig;
  disconnect: (name: string) => Promise<void>;
  refresh: () => Promise<void>;
}): Promise<void> {
  await Promise.all(
    Object.keys(extension.mcpServers ?? {}).map((name) => disconnect(name)),
  );
  await refresh();
}

export async function restartMcpClients({
  clients,
  discover,
  refresh,
  reportError,
}: {
  clients: ReadonlyMap<string, McpClient>;
  discover: (name: string, config: MCPServerConfig) => Promise<void> | void;
  refresh: () => Promise<void>;
  reportError: (name: string, error: unknown) => void;
}): Promise<void> {
  await Promise.all(
    Array.from(clients.entries()).map(async ([name, client]) => {
      try {
        await discover(name, client.getServerConfig());
      } catch (error) {
        reportError(name, error);
      }
    }),
  );
  await refresh();
}

export async function restartMcpServer({
  name,
  clients,
  configured,
  discover,
  refresh,
}: {
  name: string;
  clients: ReadonlyMap<string, McpClient>;
  configured: Readonly<Record<string, MCPServerConfig>> | undefined;
  discover: (name: string, config: MCPServerConfig) => Promise<void> | void;
  refresh: () => Promise<void>;
}): Promise<void> {
  const config = clients.get(name)?.getServerConfig() ?? configured?.[name];
  if (!config) {
    throw new Error(`No MCP server registered with the name "${name}"`);
  }
  await discover(name, config);
  await refresh();
}

export function removeMcpServerState(
  name: string,
  updateStatus: () => void,
  removeArtifacts: () => void,
  failures: unknown[],
): void {
  for (const cleanup of [updateStatus, removeArtifacts]) {
    try {
      cleanup();
    } catch (error) {
      appendFailures(failures, error);
    }
  }
}

export function removeMcpServerArtifacts(
  name: string,
  toolRegistry: McpToolPublication,
  promptRegistry: McpPromptRegistry,
  resourceRegistry: McpResourceRegistry,
): void {
  const failures: unknown[] = [];
  for (const remove of [
    () => toolRegistry.removeMcpToolsByServer(name),
    () => promptRegistry.removePromptsByServer(name),
    () => resourceRegistry.removeResourcesByServer(name),
  ]) {
    try {
      remove();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      `Failed to remove MCP artifacts for '${name}'`,
    );
  }
}

export function createConfiguredMcpClient(
  oauth: McpOAuthBinding,
  approvalPolicy: McpApprovalPolicy,
  version: string,
  tools: McpToolPublication,
  promptPublication: McpPromptRegistry,
  resourcePublication: McpResourceRegistry,
  host: McpHostConfig,
  name: string,
  config: MCPServerConfig,
  onToolsUpdated: () => Promise<void>,
  feedback: HostFeedbackSink,
  onStatus: (status: MCPServerStatus, requiresOAuth: boolean) => void,
): McpClient {
  return new McpClient(
    oauth,
    approvalPolicy,
    name,
    config,
    tools,
    promptPublication,
    resourcePublication,
    {
      getDirectories: () => host.getWorkspaceDirectories(),
      onDirectoriesChanged: (listener) =>
        host.onWorkspaceDirectoriesChanged(listener),
    },
    host,
    host.getDebugMode(),
    version,
    onToolsUpdated,
    feedback,
    onStatus,
  );
}

export function recordMcpDiscoveryFailure(
  name: string,
  error: unknown,
  failures: Map<string, string>,
  status: McpOwnerStatus,
  feedback: HostFeedbackSink,
): void {
  const message = getErrorMessage(error);
  failures.set(name, message);
  status.update(name, MCPServerStatus.DISCONNECTED);
  feedback(
    'error',
    `Error during discovery for server '${name}': ${message}`,
    error,
  );
}

export function rejectConflictingMcpExtension(
  name: string,
  config: MCPServerConfig,
  existing: McpClient | undefined,
  warn: (message: string) => void,
): boolean {
  if (!existing || existing.getServerConfig().extension === config.extension)
    return false;
  const extensionText = config.extension
    ? ` from extension "${config.extension.name}"`
    : '';
  warn(
    `Skipping MCP config for server with name "${name}"${extensionText} as it already exists.`,
  );
  return true;
}

export function rejectReservedExtensionMcpServer(
  name: string,
  config: MCPServerConfig,
  servers: Record<string, MCPServerConfig> | undefined,
  warn: (message: string) => void,
): boolean {
  if (
    !config.extension ||
    !Object.prototype.hasOwnProperty.call(servers ?? {}, name)
  )
    return false;
  warn(
    `Skipping MCP config for server with name "${name}" from extension "${config.extension.name}" because configured server names are reserved.`,
  );
  return true;
}

export async function joinMcpDiscoveryCancellation(
  operations: ReadonlyArray<Promise<unknown> | undefined>,
): Promise<void> {
  const results = await Promise.allSettled(operations);
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (failures.length > 0)
    throw new AggregateError(failures, 'MCP discovery cancellation failed');
}

export function cancelMcpDiscoveryWork(
  clients: Iterable<McpClient>,
  connecting: Iterable<McpClient>,
  disconnect: (client: McpClient) => Promise<void>,
  discoveries: Iterable<Promise<void>>,
  pendingRefresh: Promise<void> | null,
): Promise<void> {
  for (const client of clients) client.abortDiscovery();
  return joinMcpDiscoveryCancellation([
    ...discoveries,
    ...Array.from(connecting, disconnect),
    pendingRefresh ?? undefined,
  ]);
}

export function rejectMcpReconciliationErrors(
  discoveries: ConfiguredMcpReconciliation['discoveries'],
  errors: ReadonlyMap<string, unknown>,
): void {
  const failures = discoveries.flatMap(([name]) =>
    errors.has(name) ? [errors.get(name)] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, 'MCP settings reconciliation failed');
}

export async function settleMcpDisconnections(
  operations: ReadonlyArray<Promise<void>>,
  names: Iterable<string>,
  notify: (name: string) => void,
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const result of await Promise.allSettled(operations))
    if (result.status === 'rejected') failures.push(result.reason);
  for (const name of names) {
    try {
      notify(name);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

export function abortMcpDiscoveryControllers(
  controllers: Iterable<AbortController>,
  clients: Iterable<McpClient>,
  connecting: Iterable<McpClient>,
  disconnect: (client: McpClient) => Promise<void>,
  discoveries: Iterable<Promise<void>>,
  pendingRefresh: Promise<void> | null,
): Promise<void> {
  for (const controller of controllers) controller.abort();
  return cancelMcpDiscoveryWork(
    clients,
    connecting,
    disconnect,
    discoveries,
    pendingRefresh,
  );
}

export function quarantineMcpClients(
  clients: ReadonlyMap<string, McpClient>,
  retireStatus: (name: string) => void,
  retain: (name: string, client: McpClient) => void,
  failures: unknown[],
): void {
  for (const [name, client] of clients) {
    retireStatus(name);
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
    retain(name, client);
  }
}

export function cancelMcpRefreshTimer(
  timer: ReturnType<typeof setTimeout> | undefined,
  resolve: (() => void) | undefined,
): void {
  if (timer !== undefined) {
    clearTimeout(timer);
    resolve?.();
  }
}

export function collectMcpRetirementClients(
  failed: ReadonlySet<McpClient>,
  collections: ReadonlyArray<ReadonlyMap<string, McpClient>>,
  discovering: Iterable<string>,
): { serverNames: Set<string>; clientsByIdentity: Map<McpClient, string> } {
  const serverNames = new Set(discovering);
  const clientsByIdentity = new Map(
    Array.from(failed, (client): [McpClient, string] => [client, 'retired']),
  );
  for (const collection of collections) {
    for (const [name, client] of collection) {
      serverNames.add(name);
      clientsByIdentity.set(client, clientsByIdentity.get(client) ?? name);
    }
  }
  return { serverNames, clientsByIdentity };
}
