/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable eslint-comments/disable-enable-pair -- Phase 5: legacy UI boundary retained while larger decomposition continues. */

import type { SlashCommand, CommandContext } from './types.js';
import { CommandKind } from './types.js';
import { MessageType } from '../types.js';
import * as os from 'os';
import * as path from 'path';
import { loadServerHierarchicalMemory } from '@vybestack/llxprt-code-core';
import { loadTrustedFolders } from '../../config/trustedFolders.js';

export function expandHomeDir(p: string): string {
  if (!p) {
    return '';
  }
  let expandedPath = p;
  if (p.toLowerCase().startsWith('%userprofile%')) {
    expandedPath = os.homedir() + p.substring('%userprofile%'.length);
  } else if (p === '~' || p.startsWith('~/')) {
    expandedPath = os.homedir() + p.substring(1);
  }
  return path.normalize(expandedPath);
}

type ConfigType = NonNullable<CommandContext['services']['config']>;

function addDirectoriesToWorkspace(
  config: ConfigType,
  pathsToAdd: string[],
  added: string[],
  errors: string[],
): void {
  const workspaceContext = config.getWorkspaceContext();
  const folderTrustEnabled = config.getFolderTrust();
  const trustedFolders = folderTrustEnabled ? loadTrustedFolders() : null;

  for (const pathToAdd of pathsToAdd) {
    const expandedPath = expandHomeDir(pathToAdd.trim());

    if (trustedFolders) {
      const isTrusted = trustedFolders.isPathTrusted(expandedPath);
      if (isTrusted === false) {
        errors.push(
          `Directory '${pathToAdd.trim()}' is not trusted. Use the '/permissions' command to change the trust level.`,
        );
        continue;
      }
    }

    try {
      workspaceContext.addDirectory(expandedPath);
      added.push(expandedPath);
    } catch (e) {
      const error = e as Error;
      errors.push(`Error adding '${pathToAdd.trim()}': ${error.message}`);
    }
  }
}

async function refreshMemoryAfterAdd(
  context: CommandContext,
  config: ConfigType,
  added: string[],
  errors: string[],
): Promise<void> {
  const {
    ui: { addItem },
  } = context;

  try {
    if (config.shouldLoadMemoryFromIncludeDirectories()) {
      const memoryImportFormat =
        context.services.settings.merged.ui.memoryImportFormat;
      const effectiveMemoryImportFormat =
        memoryImportFormat === 'tree' || memoryImportFormat === 'flat'
          ? memoryImportFormat
          : 'tree';
      const { memoryContent, fileCount } = await loadServerHierarchicalMemory(
        config.getWorkingDir(),
        [...config.getWorkspaceContext().getDirectories(), ...added],
        config.getDebugMode(),
        config.getFileService(),
        config.getExtensions(),
        config.getFolderTrust(),
        effectiveMemoryImportFormat,
        config.getFileFilteringOptions(),
        context.services.settings.merged.ui.memoryDiscoveryMaxDirs,
      );
      config.setUserMemory(memoryContent);
      config.setLlxprtMdFileCount(fileCount);
      context.ui.setLlxprtMdFileCount(fileCount);
    }
    addItem(
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

export const directoryCommand: SlashCommand = {
  name: 'directory',
  altNames: ['dir'],
  description: 'Manage workspace directories',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    {
      name: 'add',
      description:
        'Add directories to the workspace. Use comma to separate multiple paths',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext, args: string) => {
        const {
          ui: { addItem },
          services: { config },
        } = context;
        const [...rest] = args.split(' ');

        if (!config) {
          addItem(
            {
              type: MessageType.ERROR,
              text: 'Configuration is not available.',
            },
            Date.now(),
          );
          return undefined;
        }

        const workspaceContext = config.getWorkspaceContext();

        const pathsToAdd = rest
          .join(' ')
          .split(',')
          .filter((p) => p);
        if (pathsToAdd.length === 0) {
          addItem(
            {
              type: MessageType.ERROR,
              text: 'Please provide at least one path to add.',
            },
            Date.now(),
          );
          return undefined;
        }

        if (config.isRestrictiveSandbox()) {
          return {
            type: 'message' as const,
            messageType: 'error' as const,
            content:
              'The /directory add command is not supported in restrictive sandbox profiles. Please use --include-directories when starting the session instead.',
          };
        }

        const added: string[] = [];
        const errors: string[] = [];

        addDirectoriesToWorkspace(config, pathsToAdd, added, errors);
        await refreshMemoryAfterAdd(context, config, added, errors);

        if (added.length > 0) {
          await config.getGeminiClient().addDirectoryContext();
          addItem(
            {
              type: MessageType.INFO,
              text: `Successfully added directories:\n- ${added.join('\n- ')}`,
            },
            Date.now(),
          );
          context.recordingIntegration?.recordDirectoriesChanged([
            ...workspaceContext.getDirectories(),
          ]);
        }

        if (errors.length > 0) {
          addItem(
            { type: MessageType.ERROR, text: errors.join('\n') },
            Date.now(),
          );
        }
        return undefined;
      },
    },
    {
      name: 'show',
      description: 'Show all directories in the workspace',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext) => {
        const {
          ui: { addItem },
          services: { config },
        } = context;
        if (!config) {
          addItem(
            {
              type: MessageType.ERROR,
              text: 'Configuration is not available.',
            },
            Date.now(),
          );
          return;
        }
        const workspaceContext = config.getWorkspaceContext();
        const directories = workspaceContext.getDirectories();
        const directoryList = directories.map((dir) => `- ${dir}`).join('\n');
        addItem(
          {
            type: MessageType.INFO,
            text: `Current workspace directories:\n${directoryList}`,
          },
          Date.now(),
        );
      },
    },
  ],
};
