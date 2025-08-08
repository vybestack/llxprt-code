/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';

/**
 * Masks sensitive information like API keys
 */
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

/**
 * Implementation for the /diagnostics command that shows current configuration and state
 */
export const diagnosticsCommand: SlashCommand = {
  name: 'diagnostics',
  description: 'show current configuration and diagnostic information',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext): Promise<MessageActionReturn> => {
    try {
      const config = context.services.config;
      const settings = context.services.settings;

      if (!config) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Configuration not available',
        };
      }

      const diagnostics: string[] = ['# LLxprt Diagnostics\n'];

      // Provider information
      const providerManager = config.getProviderManager();
      const activeProvider = providerManager?.getActiveProvider();
      diagnostics.push('## Provider Information');
      diagnostics.push(`- Active Provider: ${activeProvider?.name || 'none'}`);
      diagnostics.push(`- Current Model: ${config.getModel()}`);

      // Check for API key
      if (
        activeProvider &&
        'hasApiKey' in activeProvider &&
        typeof activeProvider.hasApiKey === 'function'
      ) {
        diagnostics.push(
          `- API Key: ${activeProvider.hasApiKey() ? 'Set' : 'Not set'}`,
        );
      }

      // Ephemeral settings
      const ephemeralSettings = config.getEphemeralSettings();
      diagnostics.push('\n## Ephemeral Settings');

      if (Object.keys(ephemeralSettings).length === 0) {
        diagnostics.push('- No ephemeral settings configured');
      } else {
        // Group settings by category for better readability
        const authSettings: Array<[string, unknown]> = [];
        const toolSettings: Array<[string, unknown]> = [];
        const compressionSettings: Array<[string, unknown]> = [];
        const otherSettings: Array<[string, unknown]> = [];

        for (const [key, value] of Object.entries(ephemeralSettings)) {
          if (key.startsWith('auth-')) {
            authSettings.push([key, value]);
          } else if (
            key.startsWith('tool-output-') ||
            key === 'max-prompt-tokens'
          ) {
            toolSettings.push([key, value]);
          } else if (key.startsWith('compression-')) {
            compressionSettings.push([key, value]);
          } else {
            otherSettings.push([key, value]);
          }
        }

        // Display auth settings
        if (authSettings.length > 0) {
          diagnostics.push('### Authentication');
          for (const [key, value] of authSettings) {
            if (key === 'auth-key' && typeof value === 'string') {
              diagnostics.push(`- ${key}: ${maskSensitive(value)}`);
            } else if (key === 'auth-keyfile' && typeof value === 'string') {
              diagnostics.push(`- ${key}: ${value}`);
            } else {
              diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
            }
          }
        }

        // Display tool/output settings
        if (toolSettings.length > 0) {
          diagnostics.push('### Tool & Output Limits');
          for (const [key, value] of toolSettings) {
            diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
          }
        }

        // Display compression settings
        if (compressionSettings.length > 0) {
          diagnostics.push('### Compression');
          for (const [key, value] of compressionSettings) {
            diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
          }
        }

        // Display other settings
        if (otherSettings.length > 0) {
          diagnostics.push('### Other');
          for (const [key, value] of otherSettings) {
            if (key === 'stream-options') {
              // Special handling for stream-options to show default
              diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
            } else {
              diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
            }
          }
        }
      }

      // Model parameters
      diagnostics.push('\n## Model Parameters');
      if (
        activeProvider &&
        'getModelParams' in activeProvider &&
        typeof activeProvider.getModelParams === 'function'
      ) {
        const modelParams = activeProvider.getModelParams();
        if (modelParams && Object.keys(modelParams).length > 0) {
          for (const [key, value] of Object.entries(modelParams)) {
            diagnostics.push(`- ${key}: ${JSON.stringify(value)}`);
          }
        } else {
          diagnostics.push('- No model parameters configured');
        }
      } else {
        diagnostics.push('- Model parameters not available for this provider');
      }

      // Add important defaults if not explicitly set
      diagnostics.push('\n## Important Defaults');
      const maxPromptTokens = ephemeralSettings['max-prompt-tokens'] as
        | number
        | undefined;
      diagnostics.push(
        `- max-prompt-tokens: ${maxPromptTokens ?? 200000} ${!maxPromptTokens ? '(default)' : ''}`,
      );

      const toolMaxTokens = ephemeralSettings['tool-output-max-tokens'] as
        | number
        | undefined;
      diagnostics.push(
        `- tool-output-max-tokens: ${toolMaxTokens ?? 50000} ${!toolMaxTokens ? '(default)' : ''}`,
      );

      const toolMaxItems = ephemeralSettings['tool-output-max-items'] as
        | number
        | undefined;
      diagnostics.push(
        `- tool-output-max-items: ${toolMaxItems ?? 50} ${!toolMaxItems ? '(default)' : ''}`,
      );

      const truncateMode = ephemeralSettings['tool-output-truncate-mode'] as
        | string
        | undefined;
      diagnostics.push(
        `- tool-output-truncate-mode: ${truncateMode ?? 'warn'} ${!truncateMode ? '(default)' : ''}`,
      );

      const streamOptions = ephemeralSettings['stream-options'];
      diagnostics.push(
        `- stream-options: ${streamOptions !== undefined ? JSON.stringify(streamOptions) : '{ include_usage: true } (default)'}`,
      );

      // System information
      diagnostics.push('\n## System Information');
      diagnostics.push(`- Platform: ${process.platform}`);
      diagnostics.push(`- Node Version: ${process.version}`);
      diagnostics.push(`- Working Directory: ${process.cwd()}`);
      diagnostics.push(
        `- Debug Mode: ${config.getDebugMode() ? 'Enabled' : 'Disabled'}`,
      );
      diagnostics.push(`- Approval Mode: ${config.getApprovalMode() || 'off'}`);

      // Compression
      const compressionEnabled = ephemeralSettings['compression-enabled'];
      const compressionThreshold = ephemeralSettings['compression-threshold'];
      if (
        compressionEnabled !== undefined ||
        compressionThreshold !== undefined
      ) {
        diagnostics.push('\n## Compression');
        if (compressionEnabled !== undefined) {
          diagnostics.push(`- Compression Enabled: ${compressionEnabled}`);
        }
        if (compressionThreshold !== undefined) {
          diagnostics.push(`- Compression Threshold: ${compressionThreshold}`);
        }
      }

      // Settings
      diagnostics.push('\n## Settings');
      const merged = settings.merged || {};
      diagnostics.push(`- Theme: ${merged.theme || 'default'}`);
      diagnostics.push(
        `- Selected Auth Type: ${merged.selectedAuthType || 'none'}`,
      );
      diagnostics.push(`- Default Profile: ${merged.defaultProfile || 'none'}`);
      diagnostics.push(`- Sandbox: ${merged.sandbox || 'disabled'}`);

      // IDE Integration
      diagnostics.push('\n## IDE Integration');
      diagnostics.push(
        `- IDE Mode: ${config.getIdeMode() ? 'Enabled' : 'Disabled'}`,
      );
      diagnostics.push(
        `- IDE Mode Feature: ${config.getIdeModeFeature() ? 'Enabled' : 'Disabled'}`,
      );
      const ideClient = config.getIdeClient();
      if (ideClient) {
        diagnostics.push(`- IDE Client: Connected`);
      } else {
        diagnostics.push(`- IDE Client: Not connected`);
      }

      // MCP (Model Context Protocol)
      diagnostics.push('\n## MCP (Model Context Protocol)');
      const mcpServers = config.getMcpServers();
      if (mcpServers && Object.keys(mcpServers).length > 0) {
        diagnostics.push(
          `- MCP Servers: ${Object.keys(mcpServers).join(', ')}`,
        );
      } else {
        diagnostics.push(`- MCP Servers: None configured`);
      }
      const mcpServerCommand = config.getMcpServerCommand();
      if (mcpServerCommand) {
        diagnostics.push(`- MCP Server Command: ${mcpServerCommand}`);
      }

      // Memory/Context
      diagnostics.push('\n## Memory/Context');
      const userMemory = config.getUserMemory();
      diagnostics.push(
        `- User Memory: ${userMemory ? `${userMemory.length} characters` : 'Not loaded'}`,
      );
      diagnostics.push(
        `- Context Files: ${config.getContextFileCount() || 0} files`,
      );

      // Tool Registry
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
          diagnostics.push(`- Tool Registry: Not initialized`);
        }
      } catch {
        diagnostics.push(`- Tool Registry: Not initialized`);
      }

      // Telemetry
      diagnostics.push('\n## Telemetry');
      diagnostics.push(
        `- Usage Statistics: ${merged.usageStatisticsEnabled ? 'Enabled' : 'Disabled'}`,
      );

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
