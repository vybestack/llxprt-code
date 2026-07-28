/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LlxprtExtension,
  MCPServerConfig,
} from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { McpClient } from './mcp-client.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
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
  extension: LlxprtExtension;
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
  toolRegistry: ToolRegistry,
  promptRegistry: PromptRegistry,
  resourceRegistry: ResourceRegistry,
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
