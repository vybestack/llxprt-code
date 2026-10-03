/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpHostConfig } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import {
  defaultHostServices,
  type McpHostServices,
} from '@vybestack/llxprt-code-mcp/host/hostServices.js';
import type { Config } from './config.js';
import type { ConfigParameters } from './configTypes.js';

export function createMcpHostServices(
  params: Pick<ConfigParameters, 'mcpFeedback' | 'mcpBrowser'>,
): Readonly<McpHostServices> {
  return {
    emitFeedback: params.mcpFeedback ?? defaultHostServices.emitFeedback,
    openBrowser: params.mcpBrowser ?? defaultHostServices.openBrowser,
  };
}

export function createMcpHostConfig(config: Config): McpHostConfig {
  return {
    refreshMcpContext: () => config.refreshDiscoveredMcpMetadata(),
    getAllowedMcpServers: () => config.getAllowedMcpServers(),
    getBlockedMcpServers: () => config.getBlockedMcpServers(),
    getMcpServers: () => config.getMcpServers(),
    getMcpServerCommand: () => config.getMcpServerCommand(),
    getPromptRegistry: () => config.getPromptRegistry(),
    getResourceRegistry: () => config.getResourceRegistry(),
    getWorkspaceContext: () => config.getWorkspaceContext(),
    getDebugMode: () => config.getDebugMode(),
    getExtensions: () => config.getExtensions(),
    isTrustedFolder: () => config.isTrustedFolder(),
  };
}
