/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  formatCheckpointDisplayList,
  getToolCallDataSchema,
} from '@vybestack/llxprt-code-core';
import type {
  Command,
  CommandContext,
  CommandExecutionResponse,
} from './types.js';

export class ListCheckpointsCommand implements Command {
  readonly name = 'restore list';
  readonly description = 'Lists all available checkpoints.';

  async execute(
    context: CommandContext,
    _: string[],
  ): Promise<CommandExecutionResponse> {
    try {
      if (!context.config.getCheckpointingEnabled()) {
        return {
          name: this.name,
          data: { error: 'Checkpointing is not enabled' },
        };
      }

      const checkpointDir =
        context.config.storage.getProjectTempCheckpointsDir();
      const files = await fs.readdir(checkpointDir);
      const jsonFiles = files.filter((file) => file.endsWith('.json'));

      const result = formatCheckpointDisplayList(jsonFiles);

      return {
        name: this.name,
        data: result || 'No checkpoints found.',
      };
    } catch (error) {
      return {
        name: this.name,
        data: {
          error: `Failed to list checkpoints: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }
}

export class RestoreCommand implements Command {
  readonly name = 'restore';
  readonly description = 'Restore a checkpoint.';
  readonly requiresWorkspace = true;
  readonly topLevel = true;
  readonly subCommands = [new ListCheckpointsCommand()];

  async execute(
    context: CommandContext,
    args: string[],
  ): Promise<CommandExecutionResponse> {
    try {
      // Validate args
      if (!args[0]) {
        return {
          name: this.name,
          data: { error: 'Checkpoint name is required' },
        };
      }

      // Security: prevent path traversal
      const safe = path.basename(args[0]);
      if (safe !== args[0]) {
        return {
          name: this.name,
          data: {
            error: 'Invalid checkpoint name: path traversal rejected',
          },
        };
      }

      // Ensure .json extension
      const filename = safe.endsWith('.json') ? safe : `${safe}.json`;

      // Resolve full path
      const checkpointDir =
        context.config.storage.getProjectTempCheckpointsDir();
      const fullPath = path.join(checkpointDir, filename);

      // Check if file is a symlink
      const stats = await fs.lstat(fullPath);
      if (stats.isSymbolicLink()) {
        return {
          name: this.name,
          data: { error: 'Cannot restore from symlink' },
        };
      }

      // Read and parse file
      const content = await fs.readFile(fullPath, 'utf-8');
      const data = JSON.parse(content);

      // Validate schema
      const schema = getToolCallDataSchema();
      const validatedData = schema.parse(data);

      // Restore from snapshot if commitHash exists
      if (validatedData.commitHash) {
        if (context.git == null) {
          return {
            name: this.name,
            data: {
              error:
                'Git service is not available. Cannot restore checkpoint with commitHash.',
            },
          };
        }

        await context.git.restoreProjectFromSnapshot(validatedData.commitHash);
      }

      return {
        name: this.name,
        data: {
          toolCall: validatedData.toolCall,
          restored: true,
        },
      };
    } catch (error) {
      return {
        name: this.name,
        data: {
          error: `Failed to restore checkpoint: ${error instanceof Error ? error.message : String(error)}`,
        },
      };
    }
  }
}
