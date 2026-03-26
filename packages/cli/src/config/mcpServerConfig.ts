/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';
import type {
  MCPServerConfig,
  GeminiCLIExtension,
} from '@vybestack/llxprt-code-core';
import type { Settings } from './settings.js';

const logger = new DebugLogger('llxprt:config:mcpServerConfig');

export function mergeMcpServers(
  settings: Settings,
  extensions: GeminiCLIExtension[],
): Record<string, MCPServerConfig> {
  const mcpServers = { ...(settings.mcpServers || {}) };
  for (const extension of extensions) {
    Object.entries(extension.mcpServers || {}).forEach(([key, server]) => {
      if (mcpServers[key]) {
        logger.debug(
          () =>
            `WARNING: Skipping extension MCP config for server with key "${key}" as it already exists.`,
        );
        return;
      }
      mcpServers[key] = {
        ...server,
        extensionName: extension.name,
      };
    });
  }
  return mcpServers;
}

export function allowedMcpServers(
  mcpServers: Record<string, MCPServerConfig>,
  allowMCPServers: string[],
  blockedMcpServers: Array<{ name: string; extensionName: string }>,
): Record<string, MCPServerConfig> {
  const allowedNames = new Set(allowMCPServers.filter(Boolean));
  if (allowedNames.size > 0) {
    return Object.fromEntries(
      Object.entries(mcpServers).filter(([key, server]) => {
        const isAllowed = allowedNames.has(key);
        if (!isAllowed) {
          blockedMcpServers.push({
            name: key,
            extensionName: server.extensionName || '',
          });
        }
        return isAllowed;
      }),
    );
  } else {
    blockedMcpServers.push(
      ...Object.entries(mcpServers).map(([key, server]) => ({
        name: key,
        extensionName: server.extensionName || '',
      })),
    );
    return {};
  }
}
