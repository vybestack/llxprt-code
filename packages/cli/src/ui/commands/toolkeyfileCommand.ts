/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260206-TOOLKEY.P06, PLAN-20260206-TOOLKEY.P08
 * @requirement REQ-003
 * @pseudocode lines 317-381
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
} from '@vybestack/llxprt-code-core';
import { promises as fs } from 'fs';
import path from 'path';
import { homedir } from 'os';

const toolNameOptions = getSupportedToolNames().map((toolName) => {
  const entry = getToolKeyEntry(toolName);
  return {
    value: toolName,
    description: entry
      ? `${entry.displayName}: ${entry.description}`
      : `Tool ${toolName}`,
  };
});

const toolkeyfileSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'tool',
    description: 'Select built-in tool',
    options: toolNameOptions,
    next: [
      {
        kind: 'value',
        name: 'filepath-or-none',
        description: 'Path to plaintext key file or none',
        hint: 'Provide key file path to use, or none to clear keyfile mapping',
        options: [
          { value: 'none', description: 'Clear configured keyfile path' },
        ],
      },
    ],
  },
];

export const toolkeyfileCommand: SlashCommand = {
  name: 'toolkeyfile',
  description: 'manage API key file for a built-in tool',
  kind: CommandKind.BUILT_IN,
  schema: toolkeyfileSchema,
  action: async (
    context: CommandContext,
    args: string,
  ): Promise<MessageActionReturn> => {
    // @pseudocode lines 327-328: Parse arguments
    const tokens = args.trim().split(/\s+/, 2);
    const toolName = tokens[0]?.trim()?.toLowerCase();

    // @pseudocode lines 331-333: No arguments — show usage
    if (!toolName) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Usage: /toolkeyfile <tool> [<filepath>|none]\nSupported tools: ${getSupportedToolNames().join(', ')}`,
      };
    }

    // @pseudocode lines 336-338: Validate tool name
    if (!isValidToolKeyName(toolName)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Unknown tool '${toolName}'. Supported tools: ${getSupportedToolNames().join(', ')}`,
      };
    }

    // @pseudocode lines 340-342
    const filePath = tokens[1]?.trim();
    const entry = getToolKeyEntry(toolName)!;
    const storage = new ToolKeyStorage();

    // @pseudocode lines 345-352: Show current keyfile
    if (!filePath) {
      const currentPath = await storage.getKeyfilePath(toolName);
      if (currentPath !== null) {
        return {
          type: 'message',
          messageType: 'info',
          content: `${entry.displayName} keyfile: ${currentPath}`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'info',
          content: `No keyfile configured for '${entry.displayName}'`,
        };
      }
    }

    // @pseudocode lines 355-358: Clear keyfile (case-insensitive "none")
    if (filePath.toLowerCase() === 'none') {
      await storage.clearKeyfilePath(toolName);
      return {
        type: 'message',
        messageType: 'info',
        content: `Cleared keyfile for '${entry.displayName}'`,
      };
    }

    // @pseudocode lines 360-379: Set keyfile
    // @pseudocode line 361: Resolve ~ to homedir (REQ-003.2)
    const resolvedPath = filePath.replace(/^~/, homedir());
    // @pseudocode line 362: Resolve to absolute path
    const absolutePath = path.resolve(resolvedPath);

    // @pseudocode lines 365-369: Validate file exists
    try {
      await fs.access(absolutePath);
    } catch {
      return {
        type: 'message',
        messageType: 'error',
        content: `File not found: ${absolutePath}`,
      };
    }

    // @pseudocode lines 372-375: Validate file is non-empty
    const content = await fs.readFile(absolutePath, 'utf-8');
    if (!content.trim()) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Keyfile is empty: ${absolutePath}`,
      };
    }

    // @pseudocode lines 377-379: Persist and confirm
    await storage.setKeyfilePath(toolName, absolutePath);
    return {
      type: 'message',
      messageType: 'info',
      content: `Keyfile set for '${entry.displayName}': ${absolutePath}`,
    };
  },
};
