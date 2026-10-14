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
import type { Agent } from '@vybestack/llxprt-code-agents';

const checkpointSuggestionDescription = 'Restorable tool call checkpoint';
type LoadHistory = CommandContext['ui']['loadHistory'];
type ClientHistory = Parameters<Agent['setHistory']>[0];

export interface RestoreCommandOperations {
  readonly enabled: boolean;
  readonly checkpointDirectory: string | undefined;
  readonly setClientHistory: (history: ClientHistory) => Promise<void>;
  readonly restoreProjectSnapshot:
    | ((commitHash: string) => Promise<void>)
    | undefined;
}

interface ToolCallCheckpoint {
  history?: Parameters<NonNullable<LoadHistory>>[0];
  clientHistory?: ClientHistory;
  commitHash?: string;
  toolCall: { name: string; args: Record<string, unknown> };
}

function listCheckpoints(jsonFiles: string[]): SlashCommandActionReturn {
  if (jsonFiles.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No restorable tool calls found.',
    };
  }
  const files = jsonFiles.map((file) => file.replace(/\.json$/, ''));
  return {
    type: 'message',
    messageType: 'info',
    content: `Available tool calls to restore:\n\n${files.join('\n')}`,
  };
}

async function applyCheckpointRestoration(
  ui: Pick<CommandContext['ui'], 'loadHistory' | 'addItem'>,
  operations: RestoreCommandOperations,
  data: ToolCallCheckpoint,
): Promise<void> {
  if (Array.isArray(data.history)) {
    ui.loadHistory(data.history);
  }
  if (Array.isArray(data.clientHistory)) {
    await operations.setClientHistory(data.clientHistory);
  }
  if (typeof data.commitHash === 'string' && data.commitHash.length > 0) {
    await operations.restoreProjectSnapshot?.(data.commitHash);
    ui.addItem(
      {
        type: 'info',
        text: 'Restored project to the state before the tool call.',
      },
      Date.now(),
    );
  }
}

async function restoreFromDirectory(
  ui: Pick<CommandContext['ui'], 'loadHistory' | 'addItem'>,
  operations: RestoreCommandOperations,
  checkpointDirectory: string,
  args: string,
): Promise<SlashCommandActionReturn> {
  try {
    await fs.mkdir(checkpointDirectory, { recursive: true });
    const files = await fs.readdir(checkpointDirectory);
    const jsonFiles = files.filter((file) => file.endsWith('.json')).sort();
    if (!args) return listCheckpoints(jsonFiles);

    const selectedFile = args.endsWith('.json') ? args : `${args}.json`;
    if (!jsonFiles.includes(selectedFile)) {
      return {
        type: 'message',
        messageType: 'error',
        content: `File not found: ${selectedFile}`,
      };
    }
    const filePath = path.join(checkpointDirectory, selectedFile);
    const text = await fs.readFile(filePath, 'utf-8');
    const checkpoint = JSON.parse(text) as ToolCallCheckpoint;
    await applyCheckpointRestoration(ui, operations, checkpoint);
    return {
      type: 'tool',
      toolName: checkpoint.toolCall.name,
      toolArgs: checkpoint.toolCall.args,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Could not read restorable tool calls. This is the error: ${error}`,
    };
  }
}

export function createRestoreCommand(
  operations: RestoreCommandOperations,
): SlashCommand | null {
  if (!operations.enabled) return null;

  const checkpointDirectory = operations.checkpointDirectory;
  const restoreSchema: CommandArgumentSchema = [
    {
      kind: 'value',
      name: 'checkpoint',
      description: 'Select checkpoint to restore',
      completer: withFuzzyFilter(async () => {
        if (!checkpointDirectory) return [];
        try {
          const files = await fs.readdir(checkpointDirectory);
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

  return {
    name: 'restore',
    description:
      'Restore a tool call. This will reset the conversation and file history to the state it was in when the tool call was suggested',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    schema: restoreSchema,
    action: async ({ ui }, args) => {
      if (!checkpointDirectory) {
        return {
          type: 'message',
          messageType: 'error',
          content: 'Could not determine the configuration directory path.',
        };
      }
      return restoreFromDirectory(ui, operations, checkpointDirectory, args);
    },
  };
}
