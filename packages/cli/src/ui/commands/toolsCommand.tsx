/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
  type SlashCommandActionReturn,
} from './types.js';
import { MessageType } from '../types.js';
import { AnyDeclarativeTool } from '@vybestack/llxprt-code-core';

export const toolsCommand: SlashCommand = {
  name: 'tools',
  description: 'list, enable, or disable Gemini CLI tools',
  kind: CommandKind.BUILT_IN,
  action: async (
    context: CommandContext,
    args?: string,
  ): Promise<void | SlashCommandActionReturn> => {
    const parts = args?.trim().split(/\s+/) || [];
    const subCommand = parts[0];

    const toolRegistry = await context.services.config?.getToolRegistry();
    if (!toolRegistry) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Could not retrieve tool registry.',
        },
        Date.now(),
      );
      return;
    }

    // Get current disabled tools from ephemeral settings
    const config = context.services.config;
    const ephemeralSettings = config?.getEphemeralSettings() || {};
    const disabledTools =
      (ephemeralSettings['disabled-tools'] as string[]) || [];

    // Handle disable/enable subcommands
    if (subCommand === 'disable' || subCommand === 'enable') {
      // Return dialog action to open the tools dialog
      return {
        type: 'dialog',
        dialog: 'tools',
      };
    }

    // Default behavior - list tools
    const tools = toolRegistry.getAllTools();
    // Filter out MCP tools by checking for the absence of a serverName property
    const geminiTools = tools.filter(
      (tool: AnyDeclarativeTool) => !('serverName' in tool),
    );

    // Check if user wants descriptions
    let useShowDescriptions = false;
    if (subCommand === 'desc' || subCommand === 'descriptions') {
      useShowDescriptions = true;
    }

    let message = 'Available Gemini CLI tools:\n\n';

    if (geminiTools.length > 0) {
      geminiTools.forEach((tool: AnyDeclarativeTool) => {
        const isDisabled = disabledTools.includes(tool.name);
        const disabledPrefix = isDisabled ? '[DISABLED] ' : '';
        const disabledColor = isDisabled ? '\u001b[90m' : ''; // Gray color for disabled
        const resetColor = '\u001b[0m';

        if (useShowDescriptions && tool.description) {
          message += `  - ${disabledColor}${disabledPrefix}\u001b[36m${tool.displayName} (${tool.name})\u001b[0m${disabledColor}:\n`;

          const greenColor = isDisabled ? '\u001b[90m' : '\u001b[32m'; // Gray if disabled, green if enabled

          // Handle multi-line descriptions
          const descLines = tool.description.trim().split('\n');
          for (const descLine of descLines) {
            message += `      ${greenColor}${descLine}${resetColor}\n`;
          }
        } else {
          message += `  - ${disabledColor}${disabledPrefix}\u001b[36m${tool.displayName}${resetColor}\n`;
        }
      });
    } else {
      message += '  No tools available\n';
    }

    if (disabledTools.length > 0) {
      message += `\n\u001b[90m${disabledTools.length} tool(s) disabled. Use /tools enable <tool_name> to re-enable.\u001b[0m\n`;
    }

    message += '\n';
    message += '\u001b[0m';

    context.ui.addItem({ type: MessageType.INFO, text: message }, Date.now());
  },
  completion: async (
    _context: CommandContext,
    args: string,
  ): Promise<string[]> => {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/);

    // Only complete subcommands
    if (parts.length === 1) {
      const subcommands = ['disable', 'enable', 'desc', 'descriptions'];
      return subcommands.filter((cmd) => cmd.startsWith(parts[0]));
    }

    return [];
  },
};
