/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  Config,
  WorkspaceToolCatalogOwner,
  WorkspaceMcpCatalogOwner,
} from '@vybestack/llxprt-code-core';
import {
  captureMcpSettings,
  type SessionMcpSettingsReads,
  type WorkspaceMcpSettings,
} from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import type {
  McpClientManager,
  McpApprovalPolicy,
} from '@vybestack/llxprt-code-mcp';
import type { McpHostConfig } from '@vybestack/llxprt-code-mcp/host/hostInterfaces.js';
import { createTestOAuthBinding } from './fixture-mcp-auth.js';

export function fixtureMcpRevision(
  config: Pick<Config, 'getMcpServers' | 'getBlockedMcpServers'>,
  settings: SessionMcpSettingsReads | undefined,
  readManager: () => McpClientManager,
): { readServerSettings(): WorkspaceMcpSettings; reload(): Promise<void> } {
  let revision = captureMcpSettings(
    settings?.read() ?? {
      mcpServers: config.getMcpServers() ?? {},
      blockedMcpServers: config.getBlockedMcpServers() ?? [],
      settingsMcpServers: config.getMcpServers() ?? {},
    },
  );
  const readServerSettings = (): WorkspaceMcpSettings =>
    captureMcpSettings(revision);
  return {
    readServerSettings,
    reload: async () => {
      if (settings === undefined)
        throw new Error(
          'MCP server reload is not available in this composition.',
        );
      const next = await settings.reload();
      const previous = revision;
      revision = captureMcpSettings(next);
      try {
        await readManager().reconcileConfiguredMcpServers();
      } catch (error) {
        revision = previous;
        try {
          await readManager().reconcileConfiguredMcpServers();
        } catch (rollback) {
          throw new AggregateError(
            [error, rollback],
            'Fixture MCP rollback failed',
          );
        }
        throw error;
      }
    },
  };
}

export function connectFixtureManager(
  factory: typeof McpClientManager,
  approval: McpApprovalPolicy,
  tools: WorkspaceToolCatalogOwner,
  catalog: WorkspaceMcpCatalogOwner,
  host: McpHostConfig,
): McpClientManager {
  return new factory(
    createTestOAuthBinding(),
    approval,
    'test',
    tools.publication,
    catalog.promptPublication,
    catalog.resourcePublication,
    host,
    async () => {},
  );
}

export function fixtureMcpHostSettings(
  config: Pick<
    McpHostConfig,
    | 'getAllowedMcpServers'
    | 'getMcpServerCommand'
    | 'getDebugMode'
    | 'getExtensions'
  >,
  read: () => WorkspaceMcpSettings,
): Omit<
  McpHostConfig,
  | 'getWorkspaceDirectories'
  | 'onWorkspaceDirectoriesChanged'
  | 'isTrustedFolder'
> {
  return {
    getMcpServers: () => read().mcpServers,
    getBlockedMcpServers: () => read().blockedMcpServers,
    getAllowedMcpServers: () => config.getAllowedMcpServers(),
    getMcpServerCommand: () => config.getMcpServerCommand(),
    getDebugMode: () => config.getDebugMode(),
    getExtensions: () => config.getExtensions(),
  };
}
