/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260206-TOOLKEY.P06, PLAN-20260206-TOOLKEY.P08
 * @requirement REQ-002
 * @pseudocode lines 259-316
 */

import {
  SlashCommand,
  CommandContext,
  MessageActionReturn,
  CommandKind,
} from './types.js';
import type { CommandArgumentSchema } from './schema/types.js';
import {
  ToolKeyStorage,
  isValidToolKeyName,
  getSupportedToolNames,
  getToolKeyEntry,
  maskKeyForDisplay,
} from '@vybestack/llxprt-code-core';

const toolNameOptions = getSupportedToolNames().map((toolName) => {
  const entry = getToolKeyEntry(toolName);
  return {
    value: toolName,
    description: entry
      ? `${entry.displayName}: ${entry.description}`
      : `Tool ${toolName}`,
  };
});

const toolkeySchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'tool',
    description: 'Select built-in tool',
    options: toolNameOptions,
    next: [
      {
        kind: 'value',
        name: 'key-or-none',
        description: 'API key value or none',
        hint: 'Paste API key for the tool, or use none to clear stored key',
        options: [{ value: 'none', description: 'Clear stored API key' }],
      },
    ],
  },
];

export const toolkeyCommand: SlashCommand = {
  name: 'toolkey',
  description: 'set, show, or clear API key for a built-in tool',
  kind: CommandKind.BUILT_IN,
  schema: toolkeySchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    // @pseudocode lines 276-278: Parse arguments
    const tokens = args.trim().split(/\s+/, 2);
    const toolName = tokens[0]?.trim()?.toLowerCase();

    // @pseudocode lines 280-282: No arguments — show usage
    if (!toolName) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Usage: /toolkey <tool> [<key>|none]\nSupported tools: ${getSupportedToolNames().join(', ')}`,
      };
    }

    // @pseudocode lines 284-287: Validate tool name
    if (!isValidToolKeyName(toolName)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown tool '${toolName}'. Supported tools: ${getSupportedToolNames().join(', ')}`,
      };
    }

    // @pseudocode lines 289-291
    const pat = tokens[1]?.trim();
    const entry = getToolKeyEntry(toolName)!;
    const storage = new ToolKeyStorage();

    // @pseudocode lines 294-302: Show status
    if (!pat) {
      const existingKey = await storage.getKey(toolName);
      if (existingKey !== null) {
        const masked = maskKeyForDisplay(existingKey);
        return {
          type: 'message',
          messageType: 'info',
          content: `${entry.displayName} API key: ${masked}`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'info',
          content: `No API key configured for '${entry.displayName}'`,
        };
      }
    }

    // @pseudocode lines 305-308: Clear key (case-insensitive "none")
    if (pat.toLowerCase() === 'none') {
      await storage.deleteKey(toolName);
      return {
        type: 'message',
        messageType: 'info',
        content: `Cleared API key for '${entry.displayName}'`,
      };
    }

    // @pseudocode lines 310-314: Set key
    await storage.saveKey(toolName, pat);
    const masked = maskKeyForDisplay(pat);
    return {
      type: 'message',
      messageType: 'info',
      content: `API key set for '${entry.displayName}': ${masked}`,
    };
  },
};
