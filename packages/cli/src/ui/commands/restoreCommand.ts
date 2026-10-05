/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import path from 'path';
import {
  type CommandContext,
  type SlashCommand,
  type SlashCommandActionReturn,
  CommandKind,
} from './types.js';

import { type CommandArgumentSchema } from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import {
  openDiskCheckpoint,
  type DiskCheckpoint,
} from './checkpoint-restore-source.js';

const checkpointSuggestionDescription = 'Restorable tool call checkpoint';

type LoadHistory = CommandContext['ui']['loadHistory'];

function getRuntimeLoadHistory(
  ui: CommandContext['ui'],
): LoadHistory | undefined {
  return ui.loadHistory;
}

const restoreSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'checkpoint',
    description: 'Select checkpoint to restore',
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P11
     * @requirement:REQ-004
     * @requirement:REQ-006
     * Deprecation: Legacy completion removed in favour of schema completer.
     */
    completer: withFuzzyFilter(async (ctx) => {
      const checkpointDir =
        ctx.services.config?.storage.getProjectTempCheckpointsDir();
      if (!checkpointDir) {
        return [];
      }

      try {
        const files = await fs.readdir(checkpointDir);
        return files
          .filter((file) => file.endsWith('.json'))
          .map((file) => file.replace(/\.json$/, ''))
          .sort()
          .map((name) => ({
            value: name,
            description: checkpointSuggestionDescription,
          }));
      } catch {
        return [];
      }
    }),
  },
];

function listCheckpoints(jsonFiles: string[]): SlashCommandActionReturn {
  if (jsonFiles.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No restorable tool calls found.',
    };
  }
  const truncatedFiles = jsonFiles.map((file) => {
    const components = file.split('.');
    if (components.length <= 1) {
      return file;
    }
    components.pop();
    return components.join('.');
  });
  const fileList = truncatedFiles.join('\n');
  return {
    type: 'message',
    messageType: 'info',
    content: `Available tool calls to restore:\n\n${fileList}`,
  };
}

async function applyCheckpointRestoration(
  context: CommandContext,
  config: CliUiRuntime,
  checkpoint: DiskCheckpoint,
): Promise<void> {
  const { data, rows } = checkpoint;
  const loadHistory = getRuntimeLoadHistory(context.ui);
  if (Array.isArray(data.history) && loadHistory == null)
    throw new Error('loadHistory function is not available.');
  const snapshot =
    typeof data.commitHash === 'string' && data.commitHash.length > 0
      ? data.commitHash
      : undefined;
  const restoreProject = async (): Promise<void> => {
    context.signal.throwIfAborted();
    if (snapshot !== undefined)
      await context.services.git?.restoreProjectFromSnapshot(snapshot);
    context.signal.throwIfAborted();
  };
  if (rows !== undefined) {
    // Snapshot failure rejects the admission source before durable publication.
    await config.getAgentClient().setHistoryFromSource(
      (async function* () {
        yield* rows;
        await checkpoint.close();
        await restoreProject();
      })(),
      { signal: context.signal },
    );
  } else {
    await checkpoint.close();
    await restoreProject();
  }
  if (Array.isArray(data.history)) loadHistory?.(data.history);
  if (snapshot !== undefined)
    context.ui.addItem(
      {
        type: 'info',
        text: 'Restored project to the state before the tool call.',
      },
      Date.now(),
    );
}

async function restoreCheckpoint(
  context: CommandContext,
  config: CliUiRuntime,
  args: string,
  checkpointDir: string,
  jsonFiles: string[],
): Promise<void | SlashCommandActionReturn> {
  const selectedFile = args.endsWith('.json') ? args : `${args}.json`;

  if (!jsonFiles.includes(selectedFile)) {
    return {
      type: 'message',
      messageType: 'error',
      content: `File not found: ${selectedFile}`,
    };
  }

  const filePath = path.join(checkpointDir, selectedFile);
  const checkpoint = await openDiskCheckpoint(filePath, context.signal);
  try {
    await applyCheckpointRestoration(context, config, checkpoint);
    return {
      type: 'tool',
      toolName: checkpoint.data.toolCall.name,
      toolArgs: checkpoint.data.toolCall.args,
    };
  } finally {
    await checkpoint.close();
  }
}

async function restoreAction(
  context: CommandContext,
  args: string,
): Promise<void | SlashCommandActionReturn> {
  const { services } = context;
  const { config } = services;

  if (!config) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Could not determine the configuration directory path.',
    };
  }

  const checkpointDir = config.storage.getProjectTempCheckpointsDir();

  if (!checkpointDir) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Could not determine the configuration directory path.',
    };
  }

  try {
    await fs.mkdir(checkpointDir, { recursive: true });
    const files = await fs.readdir(checkpointDir);
    const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();

    if (!args) {
      return listCheckpoints(jsonFiles);
    }

    return await restoreCheckpoint(
      context,
      config,
      args,
      checkpointDir,
      jsonFiles,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === 'loadHistory function is not available.'
    ) {
      return {
        type: 'message',
        messageType: 'error',
        content: error.message,
      };
    }
    return {
      type: 'message',
      messageType: 'error',
      content: `Could not read restorable tool calls. This is the error: ${error}`,
    };
  }
}

export const restoreCommand = (
  config: CliUiRuntime | null,
): SlashCommand | null => {
  if (config?.getCheckpointingEnabled() !== true) {
    return null;
  }

  return {
    name: 'restore',
    description:
      'Restore a tool call. This will reset the conversation and file history to the state it was in when the tool call was suggested',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: restoreAction,
    schema: restoreSchema,
  };
};
