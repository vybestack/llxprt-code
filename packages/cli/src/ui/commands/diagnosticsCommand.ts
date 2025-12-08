/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20250909-TOKTRACK.P16
 * @requirement REQ-INT-001.3
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { DebugLogger, MCPOAuthTokenStorage } from '@vybestack/llxprt-code-core';
import process from 'node:process';
import * as os from 'node:os';

function maskSensitive(value: string): string {
  if (value.length < 8) {
    return '*'.repeat(value.length);
  }
  return (
    value.substring(0, 4) +
    '*'.repeat(value.length - 8) +
    value.substring(value.length - 4)
  );
}

export const diagnosticsCommand: SlashCommand = {
  name: 'diagnostics',
  description: 'show current configuration and diagnostic information',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<MessageActionReturn> => {
    try {
      const config = context.services.config;
      const settings = context.services.settings;
      const logger = new DebugLogger('llxprt:ui:diagnostics');

      if (!config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not available',
        };
      }

      const snapshot = getRuntimeApi().getRuntimeDiagnosticsSnapshot();
      logger.debug(
        () =>
          `[diagnostics] snapshot provider=${snapshot.providerName ?? 'unknown'}`,
      );
      const diagnostics: string[] = ['# LLxprt Diagnostics\n'];

      diagnostics.push('## Provider Information');
      diagnostics.push(`- Active Provider: ${snapshot.providerName ?? 'none'}`);
      diagnostics.push(`- Current Model: ${snapshot.modelName ?? 'unknown'}`);
      diagnostics.push(`- Current Profile: ${snapshot.profileName ?? 'none'}`);
      diagnostics.push(`- API Key: unavailable via runtime helpers`);

      diagnostics.push('\n## Model Parameters');
      const modelParams = snapshot.modelParams;
      if (Object.keys(modelParams).length === 0) {
        diagnostics.push('- No custom model parameters set');
      } else {
        for (const [key, value] of Object.entries(modelParams)) {
          diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
        }
      }

      diagnostics.push('\n## Ephemeral Settings');
      const ephemeralSettings = snapshot.ephemeralSettings;
      logger.debug(
        () =>
          `[diagnostics] ephemeral settings ${JSON.stringify(ephemeralSettings)}`,
      );
      if (Object.keys(ephemeralSettings).length === 0) {
        diagnostics.push('- No ephemeral settings configured');
      } else {
        const authSettings: Array<[string, unknown]> = [];
        const toolSettings: Array<[string, unknown]> = [];
        const compressionSettings: Array<[string, unknown]> = [];
        const otherSettings: Array<[string, unknown]> = [];

        for (const [key, value] of Object.entries(ephemeralSettings)) {
          if (value === undefined || value === null) {
            continue;
          }

          if (key.startsWith('auth-')) {
            authSettings.push([key, value]);
          } else if (
            key.startsWith('tool-output-') ||
            key === 'max-prompt-tokens'
          ) {
            toolSettings.push([key, value]);
          } else if (
            key.startsWith('compression-') ||
            key === 'context-limit'
          ) {
            compressionSettings.push([key, value]);
          } else {
            otherSettings.push([key, value]);
          }
        }

        if (authSettings.length > 0) {
          if (authSettings.length > 0) {
            diagnostics.push('- Authentication:');
            for (const [key, value] of authSettings) {
              diagnostics.push(
                `  - ${key}: ${
                  typeof value === 'string' ? maskSensitive(value) : value
                }`,
              );
            }
          }
        }

        if (toolSettings.length > 0) {
          diagnostics.push('- Tool Output & Limits:');
          for (const [key, value] of toolSettings) {
            diagnostics.push(`  - ${key}: ${JSON.stringify(value)}`);
          }
        }

        if (compressionSettings.length > 0) {
          diagnostics.push('- Compression & Context:');
          for (const [key, value] of compressionSettings) {
            diagnostics.push(`  - ${key}: ${value}`);
          }
        }

        if (otherSettings.length > 0) {
          diagnostics.push('- Other Settings:');
          for (const [key, value] of otherSettings) {
            diagnostics.push(`  - ${key}: ${JSON.stringify(value)}`);
          }
        }
      }

      // Add dumpcontext status
      const dumpcontextMode =
        ephemeralSettings['dumpcontext'] ||
        (ephemeralSettings['dumponerror'] === 'enabled' ? 'error' : 'off');
      if (dumpcontextMode && dumpcontextMode !== 'off') {
        diagnostics.push(`\n## Context Dumping`);
        diagnostics.push(`- Mode: ${dumpcontextMode}`);
        diagnostics.push(`- Dump Directory: ${os.homedir()}/.llxprt/dumps/`);
      }

      diagnostics.push('\n## System Information');
      diagnostics.push(`- Platform: ${process.platform}`);
      diagnostics.push(`- Node Version: ${process.version}`);
      diagnostics.push(`- Working Directory: ${process.cwd()}`);
      diagnostics.push(
        `- Debug Mode: ${config.getDebugMode() ? 'Enabled' : 'Disabled'}`,
      );
      diagnostics.push(`- Approval Mode: ${config.getApprovalMode() || 'off'}`);

      diagnostics.push('\n## Compression');
      const compressionThreshold =
        ephemeralSettings['compression-threshold'] ?? 'default';
      diagnostics.push(`- Threshold: ${compressionThreshold}`);
      const contextLimit = ephemeralSettings['context-limit'];
      diagnostics.push(
        `- Context Limit: ${contextLimit !== undefined ? contextLimit : 'provider default'}`,
      );

      diagnostics.push('\n## Settings');
      const merged = settings?.merged || {};
      diagnostics.push(`- Theme: ${merged.ui?.theme || 'default'}`);
      diagnostics.push(
        `- Selected Auth Type: ${merged.selectedAuthType || 'none'}`,
      );
      diagnostics.push(`- Default Profile: ${merged.defaultProfile || 'none'}`);
      diagnostics.push(`- Sandbox: ${merged.sandbox || 'disabled'}`);

      diagnostics.push('\n## IDE Integration');
      diagnostics.push(
        `- IDE Mode: ${config.getIdeMode() ? 'Enabled' : 'Disabled'}`,
      );
      const ideClient = config.getIdeClient();
      diagnostics.push(`- IDE Client: ${ideClient ? 'Connected' : 'Offline'}`);

      diagnostics.push('\n## MCP (Model Context Protocol)');
      const mcpServers = config.getMcpServers();
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        diagnostics.push(
          `- MCP Servers: ${Object.keys(mcpServers).join(', ')}`,
        );
      } else {
        diagnostics.push('- MCP Servers: None configured');
      }
      const mcpServerCommand = config.getMcpServerCommand();
      diagnostics.push(
        `- MCP Server Command: ${mcpServerCommand ?? 'not set'}`,
      );

      diagnostics.push('\n## Memory/Context');
      const userMemory = config.getUserMemory();
      diagnostics.push(
        `- User Memory: ${userMemory ? `${userMemory.length} characters` : 'Not loaded'}`,
      );
      diagnostics.push(
        `- Context Files: ${config.getLlxprtMdFileCount() || 0} files`,
      );

      diagnostics.push('\n## Tools');
      try {
        const toolRegistry = await config.getToolRegistry();
        if (toolRegistry) {
          const tools = toolRegistry.getAllTools();
          diagnostics.push(`- Available Tools: ${tools.length}`);
          const toolNames = tools
            .map((t: { name: string }) => t.name)
            .slice(0, 10);
          if (toolNames.length > 0) {
            diagnostics.push(`- First 10 Tools: ${toolNames.join(', ')}`);
          }
        } else {
          diagnostics.push('- Tool Registry: Not initialized');
        }
      } catch {
        diagnostics.push('- Tool Registry: Not initialized');
      }

      diagnostics.push('\n## Telemetry');
      diagnostics.push(
        `- Usage Statistics: ${merged.ui?.usageStatisticsEnabled ? 'Enabled' : 'Disabled'}`,
      );

      diagnostics.push('\n## OAuth Tokens');

      try {
        const runtimeApi = getRuntimeApi();
        const oauthManager = runtimeApi.getCliOAuthManager();

        if (!oauthManager) {
          diagnostics.push('- No OAuth tokens configured');
        } else {
          const supportedProviders = oauthManager.getSupportedProviders();

          let hasProviderTokens = false;
          let hasMCPTokens = false;

          if (supportedProviders.length > 0) {
            diagnostics.push('### Provider Tokens');

            for (const provider of supportedProviders) {
              const isAuthenticated =
                await oauthManager.isAuthenticated(provider);

              if (isAuthenticated) {
                const token = await oauthManager.peekStoredToken(provider);

                if (token && typeof token.expiry === 'number') {
                  hasProviderTokens = true;
                  const expiryDate = new Date(token.expiry * 1000);
                  const timeUntilExpiry = Math.max(
                    0,
                    token.expiry - Date.now() / 1000,
                  );
                  const hours = Math.floor(timeUntilExpiry / 3600);
                  const minutes = Math.floor((timeUntilExpiry % 3600) / 60);

                  diagnostics.push(`- ${provider}:`);
                  diagnostics.push(`  - Status: Authenticated`);
                  diagnostics.push(`  - Expires: ${expiryDate.toISOString()}`);
                  diagnostics.push(`  - Time Remaining: ${hours}h ${minutes}m`);
                  diagnostics.push(
                    `  - Refresh Token: ${token.refresh_token ? 'Available' : 'None'}`,
                  );
                }
              } else {
                hasProviderTokens = true;
                diagnostics.push(`- ${provider}: Not authenticated`);
              }
            }
          }

          const mcpTokenStorage = new MCPOAuthTokenStorage();
          const mcpTokens = await mcpTokenStorage.getAllCredentials();

          if (mcpTokens.size > 0) {
            hasMCPTokens = true;
            diagnostics.push('\n### MCP Server Tokens');

            for (const [serverName, credentials] of mcpTokens) {
              const token = credentials.token;
              const isExpired = MCPOAuthTokenStorage.isTokenExpired(token);

              diagnostics.push(`- ${serverName}:`);
              diagnostics.push(
                `  - Status: ${isExpired ? 'Expired' : 'Valid'}`,
              );

              if (token.expiresAt) {
                const expiryDate = new Date(token.expiresAt);
                const timeUntilExpiry = Math.max(
                  0,
                  (token.expiresAt - Date.now()) / 1000,
                );
                const hours = Math.floor(timeUntilExpiry / 3600);
                const minutes = Math.floor((timeUntilExpiry % 3600) / 60);

                diagnostics.push(`  - Expires: ${expiryDate.toISOString()}`);
                diagnostics.push(`  - Time Remaining: ${hours}h ${minutes}m`);
              }

              diagnostics.push(
                `  - Refresh Token: ${token.refreshToken ? 'Available' : 'None'}`,
              );

              if (token.tokenType) {
                diagnostics.push(`  - Token Type: ${token.tokenType}`);
              }

              if (token.scope) {
                diagnostics.push(`  - Scopes: ${token.scope}`);
              }
            }
          }

          if (!hasProviderTokens && !hasMCPTokens) {
            diagnostics.push('- No OAuth tokens configured');
          }
        }
      } catch (error) {
        logger.debug(
          () => `[diagnostics] Failed to retrieve OAuth tokens: ${error}`,
        );
        diagnostics.push('- Unable to retrieve OAuth token information');
      }

      return {
        type: 'message',
        messageType: 'info',
        content: diagnostics.join('\n'),
      };
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to generate diagnostics: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
