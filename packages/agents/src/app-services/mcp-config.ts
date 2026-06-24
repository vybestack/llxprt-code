/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan:PLAN-20260617-COREAPI.P27
 * @requirement:REQ-021
 *
 * Durable MCP server config add/remove (REQ-021). The CLI persists MCP servers
 * under the `mcpServers` settings key (see
 * `packages/cli/src/commands/mcp/add.ts` / `remove.ts`); this app-service does
 * the same via the SHARED `SettingsService.get('mcpServers')` /
 * `set('mcpServers', record)` so add→get→remove round-trips. No `packages/cli`
 * import, no live `Agent` instance required.
 */

import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/config.js';
import type {
  AddMcpServerInput,
  AddMcpServerResult,
  RemoveMcpServerInput,
  RemoveMcpServerResult,
} from './types.js';

const MCP_SERVERS_KEY = 'mcpServers';

function readServers(
  settingsService: AddMcpServerInput['settingsService'],
): Record<string, MCPServerConfig> {
  const raw = settingsService.get(MCP_SERVERS_KEY);
  if (raw !== null && typeof raw === 'object') {
    return { ...(raw as Record<string, MCPServerConfig>) };
  }
  return {};
}

/**
 * Add (or overwrite) a durable MCP server config under `name`.
 */
export function addMcpServer(input: AddMcpServerInput): AddMcpServerResult {
  const servers = readServers(input.settingsService);
  servers[input.name] = input.config;
  input.settingsService.set(MCP_SERVERS_KEY, servers);
  return { name: input.name, servers };
}

/**
 * Remove a durable MCP server config by `name`.
 */
export function removeMcpServer(
  input: RemoveMcpServerInput,
): RemoveMcpServerResult {
  const servers = readServers(input.settingsService);
  const removed = Object.prototype.hasOwnProperty.call(servers, input.name);
  if (removed) {
    delete servers[input.name];
    input.settingsService.set(MCP_SERVERS_KEY, servers);
  }
  return { name: input.name, removed, servers };
}
