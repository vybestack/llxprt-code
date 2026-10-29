/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import type { HistoryItemWithoutId } from '../types.js';
import { MessageType } from '../types.js';
import {
  CommandKind,
  type SlashCommand,
  type SlashCommandActionReturn,
} from './types.js';
import { loadTrustedFolders } from '../../config/trustedFolders.js';

type AddDirectoryCommandItem = (
  item: HistoryItemWithoutId,
  baseTimestamp?: number,
) => void;

export interface DirectoryCommandOperations {
  readonly isConfigured: boolean;
  readonly addDirectory: (path: string) => void;
  readonly directories: () => readonly string[];
  readonly getFolderTrust: () => boolean;
  readonly isRestrictiveSandbox: () => boolean;
  readonly refreshMemory: () => Promise<{ fileCount: number }>;
  readonly shouldLoadMemoryFromIncludeDirectories: () => boolean;
  readonly addItem: AddDirectoryCommandItem;
  readonly setMemoryFileCount: (count: number) => void;
  readonly addDirectoryContext: () => Promise<void>;
  readonly recordDirectoriesChanged: (
    directories: readonly string[],
  ) => void | Promise<void>;
}

export function expandHomeDir(value: string): string {
  if (!value) return '';
  let expandedPath = value;
  if (value.toLowerCase().startsWith('%userprofile%')) {
    expandedPath = os.homedir() + value.substring('%userprofile%'.length);
  } else if (value === '~' || value.startsWith('~/')) {
    expandedPath = os.homedir() + value.substring(1);
  }
  return path.normalize(expandedPath);
}

function addDirectoriesToWorkspace(
  operations: DirectoryCommandOperations,
  pathsToAdd: string[],
  added: string[],
  errors: string[],
): void {
  const trustedFolders = operations.getFolderTrust()
    ? loadTrustedFolders()
    : null;

  for (const pathToAdd of pathsToAdd) {
    const expandedPath = expandHomeDir(pathToAdd.trim());
    if (trustedFolders && trustedFolders.isPathTrusted(expandedPath) !== true) {
      errors.push(
        `Directory '${pathToAdd.trim()}' is not trusted. Use the '/permissions' command to change the trust level.`,
      );
      continue;
    }

    try {
      operations.addDirectory(expandedPath);
      added.push(expandedPath);
    } catch (error) {
      errors.push(
        `Error adding '${pathToAdd.trim()}': ${(error as Error).message}`,
      );
    }
  }
}

async function refreshMemoryAfterAdd(
  operations: DirectoryCommandOperations,
  added: string[],
  errors: string[],
): Promise<void> {
  try {
    if (operations.shouldLoadMemoryFromIncludeDirectories()) {
      const { fileCount } = await operations.refreshMemory();
      operations.setMemoryFileCount(fileCount);
    }
    operations.addItem(
      {
        type: MessageType.INFO,
        text: `Successfully added GEMINI.md files from the following directories if there are:\n- ${added.join('\n- ')}`,
      },
      Date.now(),
    );
  } catch (error) {
    errors.push(`Error refreshing memory: ${(error as Error).message}`);
  }
}

function createAddDirectorySubcommand(
  operations: DirectoryCommandOperations,
): SlashCommand {
  return {
    name: 'add',
    description:
      'Add directories to the workspace. Use comma to separate multiple paths',
    kind: CommandKind.BUILT_IN,
    action: async (
      _invocation: unknown,
      args: string,
    ): Promise<SlashCommandActionReturn | void> => {
      if (!operations.isConfigured) {
        operations.addItem(
          {
            type: MessageType.ERROR,
            text: 'Configuration is not available.',
          },
          Date.now(),
        );
        return undefined;
      }

      const pathsToAdd = args.split(',').filter((value) => value);
      if (pathsToAdd.length === 0) {
        operations.addItem(
          {
            type: MessageType.ERROR,
            text: 'Please provide at least one path to add.',
          },
          Date.now(),
        );
        return undefined;
      }

      if (operations.isRestrictiveSandbox()) {
        return {
          type: 'message',
          messageType: 'error',
          content:
            'The /directory add command is not supported in restrictive sandbox profiles. Please use --include-directories when starting the session instead.',
        };
      }

      const added: string[] = [];
      const errors: string[] = [];
      addDirectoriesToWorkspace(operations, pathsToAdd, added, errors);
      await refreshMemoryAfterAdd(operations, added, errors);

      if (added.length > 0) {
        await operations.addDirectoryContext();
        operations.addItem(
          {
            type: MessageType.INFO,
            text: `Successfully added directories:\n- ${added.join('\n- ')}`,
          },
          Date.now(),
        );
        await operations.recordDirectoriesChanged([
          ...operations.directories(),
        ]);
      }

      if (errors.length > 0) {
        operations.addItem(
          { type: MessageType.ERROR, text: errors.join('\n') },
          Date.now(),
        );
      }
      return undefined;
    },
  };
}

function createShowDirectorySubcommand(
  operations: DirectoryCommandOperations,
): SlashCommand {
  return {
    name: 'show',
    description: 'Show all directories in the workspace',
    kind: CommandKind.BUILT_IN,
    action: (_invocation: unknown): void => {
      if (!operations.isConfigured) {
        operations.addItem(
          {
            type: MessageType.ERROR,
            text: 'Configuration is not available.',
          },
          Date.now(),
        );
        return;
      }
      const directoryList = operations
        .directories()
        .map((directory) => `- ${directory}`)
        .join('\n');
      operations.addItem(
        {
          type: MessageType.INFO,
          text: `Current workspace directories:\n${directoryList}`,
        },
        Date.now(),
      );
    },
  };
}

export function createDirectoryCommand(
  operations: DirectoryCommandOperations,
): SlashCommand {
  return {
    name: 'directory',
    altNames: ['dir'],
    description: 'Manage workspace directories',
    kind: CommandKind.BUILT_IN,
    subCommands: [
      createAddDirectorySubcommand(operations),
      createShowDirectorySubcommand(operations),
    ],
  };
}
