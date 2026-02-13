/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getErrorMessage,
  getGlobalCoreMemoryFilePath,
  getProjectCoreMemoryFilePath,
  loadCoreMemoryContent,
  MemoryTool,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs/promises';
import { MessageType } from '../types.js';
import { loadHierarchicalLlxprtMemory } from '../../config/config.js';
import type { SlashCommand, SlashCommandActionReturn } from './types.js';
import { CommandKind } from './types.js';

export const memoryCommand: SlashCommand = {
  name: 'memory',
  description: 'Commands for interacting with memory.',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'show',
      description: 'Show the current memory contents.',
      kind: CommandKind.BUILT_IN,
      action: async (context) => {
        const memoryContent = context.services.config?.getUserMemory() || '';
        const fileCount = context.services.config?.getLlxprtMdFileCount() || 0;

        const messageContent =
          memoryContent.length > 0
            ? `Current memory content from ${fileCount} file(s):\n\n---\n${memoryContent}\n---`
            : 'Memory is currently empty.';

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: messageContent,
          },
          Date.now(),
        );
      },
    },
    {
      name: 'add',
      description:
        'Add content to the memory. Usage: /memory add <global|project|core.global|core.project> <text>',
      kind: CommandKind.BUILT_IN,
      action: (context, args): SlashCommandActionReturn | void => {
        const USAGE =
          'Usage: /memory add <global|project|core.global|core.project> <text to remember>';

        if (!args || args.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content: USAGE,
          };
        }

        // Parse scope as first argument
        const trimmedArgs = args.trim();
        const firstSpaceIndex = trimmedArgs.indexOf(' ');

        // If no space, check if it's just a scope keyword without content
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
              content: USAGE,
            };
          }
          // No scope specified, default to global
          const fact = trimmedArgs;
          context.ui.addItem(
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

        const firstArg = trimmedArgs
          .substring(0, firstSpaceIndex)
          .toLowerCase();
        const remainingArgs = trimmedArgs.substring(firstSpaceIndex + 1).trim();

        // Handle core.project and core.global — write directly to .LLXPRT_SYSTEM
        if (firstArg === 'core.project' || firstArg === 'core.global') {
          if (remainingArgs === '') {
            return {
              type: 'message',
              messageType: 'error',
              content: USAGE,
            };
          }

          const fact = remainingArgs;
          const workingDir =
            context.services.config?.getWorkingDir() || process.cwd();
          const filePath =
            firstArg === 'core.project'
              ? getProjectCoreMemoryFilePath(workingDir)
              : getGlobalCoreMemoryFilePath();

          // Write core memory asynchronously using the shared entry logic
          void (async () => {
            try {
              await MemoryTool.performAddMemoryEntry(fact, filePath, {
                readFile: fs.readFile,
                writeFile: fs.writeFile,
                mkdir: fs.mkdir,
              });
              // Reload cached core memory so the change takes effect immediately
              try {
                const coreContent = await loadCoreMemoryContent(workingDir);
                context.services.config?.setCoreMemory(coreContent);
                await context.services.config?.updateSystemInstructionIfInitialized();
              } catch {
                // Non-fatal: memory is written to disk; cache will sync on next refresh
              }

              context.ui.addItem(
                {
                  type: MessageType.INFO,
                  text: `Core memory saved to ${firstArg}: "${fact}"`,
                },
                Date.now(),
              );
            } catch (error) {
              context.ui.addItem(
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

        let scope: 'global' | 'project' | undefined;
        let fact: string;

        // Check if first argument is a scope keyword
        if (firstArg === 'global' || firstArg === 'project') {
          if (remainingArgs === '') {
            return {
              type: 'message',
              messageType: 'error',
              content: USAGE,
            };
          }
          scope = firstArg;
          fact = remainingArgs;
        } else {
          // No scope specified, treat entire args as the fact
          fact = trimmedArgs;
        }

        context.ui.addItem(
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
      },
    },
    {
      name: 'refresh',
      description: 'Refresh the memory from the source.',
      kind: CommandKind.BUILT_IN,
      action: async (context) => {
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: 'Refreshing memory from source files...',
          },
          Date.now(),
        );

        try {
          const config = await context.services.config;
          const settings = context.services.settings;
          if (config) {
            const { memoryContent, fileCount, filePaths } =
              await loadHierarchicalLlxprtMemory(
                config.getWorkingDir(),
                config.shouldLoadMemoryFromIncludeDirectories()
                  ? config.getWorkspaceContext().getDirectories()
                  : [],
                config.getDebugMode(),
                config.getFileService(),
                settings.merged,
                config.getExtensions(),
                config.isTrustedFolder(),
                context.services.settings.merged.ui?.memoryImportFormat ||
                  'tree', // Use setting or default to 'tree'
                config.getFileFilteringOptions(),
              );
            config.setUserMemory(memoryContent);

            // Refresh core (system) memory from .LLXPRT_SYSTEM files
            try {
              const coreContent = await loadCoreMemoryContent(
                config.getWorkingDir(),
              );
              config.setCoreMemory(coreContent);
            } catch {
              // Non-fatal: keep existing core memory
            }

            try {
              await config.updateSystemInstructionIfInitialized();
            } catch {
              // Best-effort: memory is already stored; instruction update
              // can fail before the chat is initialized.
            }
            config.setLlxprtMdFileCount(fileCount);
            config.setLlxprtMdFilePaths(filePaths);
            context.ui.setGeminiMdFileCount(fileCount);

            const successMessage =
              memoryContent.length > 0
                ? `Memory refreshed successfully. Loaded ${memoryContent.length} characters from ${fileCount} file(s).`
                : 'Memory refreshed successfully. No memory content found.';

            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: successMessage,
              },
              Date.now(),
            );
          }
        } catch (error) {
          const errorMessage = getErrorMessage(error);
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Error refreshing memory: ${errorMessage}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'list',
      description: 'Lists the paths of the LLXPRT.md files in use.',
      kind: CommandKind.BUILT_IN,
      action: async (context) => {
        const filePaths = context.services.config?.getLlxprtMdFilePaths() || [];
        const fileCount = filePaths.length;

        const messageContent =
          fileCount > 0
            ? `There are ${fileCount} LLXPRT.md file(s) in use:\n\n${filePaths.join('\n')}`
            : 'No LLXPRT.md files in use.';

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: messageContent,
          },
          Date.now(),
        );
      },
    },
  ],
};
