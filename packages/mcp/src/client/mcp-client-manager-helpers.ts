/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import type { PromptRegistry } from '@vybestack/llxprt-code-core/prompts/prompt-registry.js';
import type { McpClient } from './mcp-client.js';
import type { ResourceRegistry } from '@vybestack/llxprt-code-core/resources/resource-registry.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';

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

export function collectMcpServers(
  clients: ReadonlyMap<string, McpClient>,
): Record<string, MCPServerConfig> {
  return Object.fromEntries(
    Array.from(clients, ([name, client]) => [name, client.getServerConfig()]),
  );
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
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      `Failed to remove MCP artifacts for '${name}'`,
    );
  }
}
