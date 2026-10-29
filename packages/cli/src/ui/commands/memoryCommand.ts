/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getErrorMessage } from '@vybestack/llxprt-code-core';
import { MessageType } from '../types.js';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';

export interface MemoryCommandOperations {
  readonly isConfigured: boolean;
  readonly getUserMemory: () => string;
  readonly getLlxprtMdFileCount: () => number;
  readonly getLlxprtMdFilePaths: () => readonly string[];
  readonly refreshMemory: () => Promise<{
    memoryContent: string;
    fileCount: number;
  }>;
  readonly updateSystemInstruction: () => Promise<void>;
  addItem: UseHistoryManagerReturn['addItem'];
  setMemoryFileCount: (count: number) => void;
  saveCoreMemory: (
    scope: 'core.global' | 'core.project',
    fact: string,
  ) => Promise<void>;
}

const MEMORY_ADD_USAGE =
  'Usage: /memory add <global|project|core.global|core.project> <text to remember>';

function handleCoreMemoryAdd(
  operations: MemoryCommandOperations,
  firstArg: 'core.global' | 'core.project',
  remainingArgs: string,
): SlashCommandActionReturn | void {
  if (remainingArgs === '') {
    return {
      type: 'message',
      messageType: 'error',
      content: MEMORY_ADD_USAGE,
    };
  }

  const fact = remainingArgs;
  void (async () => {
    try {
      await operations.saveCoreMemory(firstArg, fact);
      await operations.refreshMemory();
      await operations.updateSystemInstruction();

      operations.addItem(
        {
          type: MessageType.INFO,
          text: `Core memory saved to ${firstArg}: "${fact}"`,
        },
        Date.now(),
      );
    } catch (error) {
      operations.addItem(
        {
          type: MessageType.ERROR,
          text: `Error saving core memory: ${getErrorMessage(error)}`,
        },
        Date.now(),
      );
    }
  })();

  return;
}

function handleScopedMemoryAdd(
  operations: MemoryCommandOperations,
  firstArg: string,
  remainingArgs: string,
  trimmedArgs: string,
): SlashCommandActionReturn | void {
  let scope: 'global' | 'project' | undefined;
  let fact: string;

  if (firstArg === 'global' || firstArg === 'project') {
    if (remainingArgs === '') {
      return {
        type: 'message',
        messageType: 'error',
        content: MEMORY_ADD_USAGE,
      };
    }
    scope = firstArg;
    fact = remainingArgs;
  } else {
    fact = trimmedArgs;
  }

  operations.addItem(
    {
      type: MessageType.INFO,
      text: `Attempting to save to memory: "${fact}"`,
    },
    Date.now(),
  );

  const toolArgs: { fact: string; scope?: 'global' | 'project' } = {
    fact,
  };
  if (scope) {
    toolArgs.scope = scope;
  }

  return {
    type: 'tool',
    toolName: 'save_memory',
    toolArgs,
  };
}

function createMemoryShowSubcommand(
  operations: MemoryCommandOperations,
): SlashCommand {
  return {
    name: 'show',
    description: 'Show the current memory contents.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (_invocation: unknown) => {
      const memoryContent = operations.getUserMemory();
      const fileCount = operations.getLlxprtMdFileCount();
      const messageContent =
        memoryContent.length > 0
          ? `Current memory content from ${fileCount} file(s):\n\n---\n${memoryContent}\n---`
          : 'Memory is currently empty.';
      operations.addItem(
        { type: MessageType.INFO, text: messageContent },
        Date.now(),
      );
    },
  };
}

function createMemoryAddSubcommand(
  operations: MemoryCommandOperations,
): SlashCommand {
  return {
    name: 'add',
    description:
      'Add content to the memory. Usage: /memory add <global|project|core.global|core.project> <text>',
    kind: CommandKind.BUILT_IN,
    action: (
      _invocation: unknown,
      args: string,
    ): SlashCommandActionReturn | void => {
      if (!args || args.trim() === '') {
        return {
          type: 'message',
          messageType: 'error',
          content: MEMORY_ADD_USAGE,
        };
      }
      const trimmedArgs = args.trim();
      const firstSpaceIndex = trimmedArgs.indexOf(' ');
      if (firstSpaceIndex === -1) {
        const arg = trimmedArgs.toLowerCase();
        if (
          arg === 'global' ||
          arg === 'project' ||
          arg === 'core.global' ||
          arg === 'core.project'
        ) {
          return {
            type: 'message',
            messageType: 'error',
            content: MEMORY_ADD_USAGE,
          };
        }
        const fact = trimmedArgs;
        operations.addItem(
          {
            type: MessageType.INFO,
            text: `Attempting to save to memory: "${fact}"`,
          },
          Date.now(),
        );
        return {
          type: 'tool',
          toolName: 'save_memory',
          toolArgs: { fact },
        };
      }
      const firstArg = trimmedArgs.substring(0, firstSpaceIndex).toLowerCase();
      const remainingArgs = trimmedArgs.substring(firstSpaceIndex + 1).trim();
      if (firstArg === 'core.project' || firstArg === 'core.global') {
        return handleCoreMemoryAdd(operations, firstArg, remainingArgs);
      }
      return handleScopedMemoryAdd(
        operations,
        firstArg,
        remainingArgs,
        trimmedArgs,
      );
    },
  };
}

function createMemoryRefreshSubcommand(
  operations: MemoryCommandOperations,
): SlashCommand {
  return {
    name: 'refresh',
    description: 'Refresh the memory from the source.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (_invocation: unknown) => {
      operations.addItem(
        {
          type: MessageType.INFO,
          text: 'Refreshing memory from source files...',
        },
        Date.now(),
      );
      try {
        if (operations.isConfigured) {
          const { memoryContent, fileCount } = await operations.refreshMemory();
          await operations.refreshMemory();
          try {
            await operations.updateSystemInstruction();
          } catch {
            // Best-effort: memory is already stored; instruction update
            // can fail before the chat is initialized.
          }
          operations.setMemoryFileCount(fileCount);
          const successMessage =
            memoryContent.length > 0
              ? `Memory refreshed successfully. Loaded ${memoryContent.length} characters from ${fileCount} file(s).`
              : 'Memory refreshed successfully. No memory content found.';
          operations.addItem(
            { type: MessageType.INFO, text: successMessage },
            Date.now(),
          );
        }
      } catch (error) {
        operations.addItem(
          {
            type: MessageType.ERROR,
            text: `Error refreshing memory: ${getErrorMessage(error)}`,
          },
          Date.now(),
        );
      }
    },
  };
}

function createMemoryListSubcommand(
  operations: MemoryCommandOperations,
): SlashCommand {
  return {
    name: 'list',
    description: 'Lists the paths of the LLXPRT.md files in use.',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async (_invocation: unknown) => {
      const filePaths = operations.getLlxprtMdFilePaths();
      const messageContent =
        filePaths.length > 0
          ? `There are ${filePaths.length} LLXPRT.md file(s) in use:\n\n${filePaths.join('\n')}`
          : 'No LLXPRT.md files in use.';
      operations.addItem(
        { type: MessageType.INFO, text: messageContent },
        Date.now(),
      );
    },
  };
}

export function createMemoryCommand(
  operations: MemoryCommandOperations,
): SlashCommand {
  return {
    name: 'memory',
    description: 'Commands for interacting with memory.',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      createMemoryShowSubcommand(operations),
      createMemoryAddSubcommand(operations),
      createMemoryRefreshSubcommand(operations),
      createMemoryListSubcommand(operations),
    ],
  };
}
