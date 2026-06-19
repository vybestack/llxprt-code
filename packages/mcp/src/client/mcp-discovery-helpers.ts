/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { parse } from 'shell-quote';
import type { MCPServerConfig } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const debugLogger = DebugLogger.getLogger('llxprt:core:tools:mcp-client');

/**
 * Checks if the MCP server configuration has a network transport URL (SSE or HTTP).
 * Empty string URLs are treated as invalid.
 */
export function hasNetworkTransport(config: MCPServerConfig): boolean {
  if (config.url !== '' && config.url !== undefined) return true;
  if (config.httpUrl !== '' && config.httpUrl !== undefined) return true;
  return false;
}

interface NamedTool {
  name?: string;
}

/**
 * Checks whether a discovered tool should be enabled based on server-level
 * include/exclude filters. Visible for testing.
 */
export function isEnabled(
  funcDecl: NamedTool,
  mcpServerName: string,
  mcpServerConfig: MCPServerConfig,
): boolean {
  if (!funcDecl.name) {
    debugLogger.warn(
      `Discovered a function declaration without a name from MCP server '${mcpServerName}'. Skipping.`,
    );
    return false;
  }
  const { includeTools, excludeTools } = mcpServerConfig;

  // excludeTools takes precedence over includeTools
  const isExcluded = excludeTools?.includes(funcDecl.name) === true;
  if (isExcluded) {
    return false;
  }

  return (
    includeTools === undefined ||
    includeTools.some(
      (tool) => tool === funcDecl.name || tool.startsWith(`${funcDecl.name}(`),
    )
  );
}

/** Visible for Testing */
export function populateMcpServerCommand(
  mcpServers: Record<string, MCPServerConfig>,
  mcpServerCommand: string | undefined,
): Record<string, MCPServerConfig> {
  if (mcpServerCommand) {
    const cmd = mcpServerCommand;
    const args = parse(cmd, process.env) as string[];
    if (args.some((arg) => typeof arg !== 'string')) {
      throw new Error('failed to parse mcpServerCommand: ' + cmd);
    }
    mcpServers['mcp'] = {
      command: args[0],
      args: args.slice(1),
    };
  }
  return mcpServers;
}
