/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { McpHostConfig } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import type { WorkspaceFilesystemOwner } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';
export function fixtureMcpHost(
  config: Omit<
    McpHostConfig,
    | 'getWorkspaceDirectories'
    | 'onWorkspaceDirectoriesChanged'
    | 'isTrustedFolder'
  >,
  filesystem: Pick<WorkspaceFilesystemOwner, 'paths' | 'subscribeDirectories'>,
  trust: Pick<McpHostConfig, 'isTrustedFolder'>,
): McpHostConfig {
  return {
    getWorkspaceDirectories: () => filesystem.paths.directories(),
    onWorkspaceDirectoriesChanged: (listener) =>
      filesystem.subscribeDirectories(listener),
    getAllowedMcpServers: () => config.getAllowedMcpServers(),
    getBlockedMcpServers: () => config.getBlockedMcpServers(),
    getMcpServers: () => config.getMcpServers(),
    getMcpServerCommand: () => config.getMcpServerCommand(),
    getDebugMode: () => config.getDebugMode(),
    getExtensions: () => config.getExtensions(),
    isTrustedFolder: () => trust.isTrustedFolder(),
  };
}
