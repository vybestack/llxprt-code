/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import type {
  AgentHistoryItem,
  CheckpointInfo,
} from '@vybestack/llxprt-code-agents';
import { Colors } from '../colors.js';
import { MessageType, type HistoryItemChatList } from '../types.js';
import type { EmojiFilterMode } from '@vybestack/llxprt-code-core';
import { iContentToHistoryItems } from '../utils/iContentToHistoryItems.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import {
  composeChatCommand,
  type ChatSubcommandActions,
} from './chatCommandShape.js';

/**
 * Operations the owner-backed /chat command uses. The host binds each one to
 * the session owner that registered the command, so invocation context never
 * selects the owner.
 */
export interface ChatOwnerOperations {
  readonly listCheckpoints: () => Promise<readonly CheckpointInfo[]>;
  readonly createCheckpoint: (
    name: string,
    options: { readonly overwrite: boolean },
  ) => Promise<unknown>;
  readonly resume: (tag: string) => Promise<readonly AgentHistoryItem[]>;
  readonly deleteCheckpoint: (checkpointId: string) => Promise<void>;
  readonly renameCheckpoint: (
    checkpointId: string,
    name: string,
    options: { readonly overwrite: boolean },
  ) => Promise<void>;
  readonly getHistory: () => Promise<readonly AgentHistoryItem[]>;
  readonly clearHistory: () => Promise<void>;
  readonly restoreTurns: (turns: number) => Promise<{
    readonly remainingHistory: readonly AgentHistoryItem[];
    readonly itemsRemoved: number;
  }>;
  readonly nameCurrentSession: (
    name: string,
    options: { readonly overwrite: boolean },
  ) => Promise<void>;
  readonly getRecordingPath: () => string | undefined;
  readonly getModel: () => string;
  readonly getEmojiFilterMode: () => EmojiFilterMode;
}

function failure(operation: string, error: unknown): SlashCommandActionReturn {
  return {
    type: 'message',
    messageType: 'error',
    content: `Failed to ${operation}: ${error instanceof Error ? error.message : String(error)}`,
  };
}

function collision(
  context: CommandContext,
  name: string,
  raw: string,
  error: unknown,
): SlashCommandActionReturn | undefined {
  if (
    context.overwriteConfirmed === true ||
    !(error instanceof Error) ||
    !error.message.includes('already exists')
  )
    return undefined;
  return {
    type: 'confirm_action',
    prompt: React.createElement(
      Text,
      null,
      'A session or checkpoint named ',
      React.createElement(Text, { color: Colors.AccentPurple }, name),
      ' already exists. Do you want to overwrite it?',
    ),
    originalInvocation: { raw: context.invocation?.raw ?? raw },
  };
}

function resolveCheckpoint(
  ref: string,
  checkpoints: readonly CheckpointInfo[],
): CheckpointInfo | string {
  const matchesById = checkpoints.filter((entry) => entry.checkpointId === ref);
  if (matchesById.length > 1) return `Ambiguous checkpoint ID: ${ref}`;
  if (matchesById.length === 1) return matchesById[0];
  const matchesByName = checkpoints.filter((entry) => entry.name === ref);
  if (matchesByName.length > 1) return `Ambiguous checkpoint name: ${ref}`;
  return matchesByName[0] ?? `No checkpoint found with tag: ${ref}`;
}

function replayUiHistory(
  context: CommandContext,
  operations: ChatOwnerOperations,
  history: readonly AgentHistoryItem[],
): void {
  context.ui.loadHistory(
    iContentToHistoryItems([...history], operations.getEmojiFilterMode()),
  );
}

function usageError(content: string): SlashCommandActionReturn {
  return { type: 'message', messageType: 'error', content };
}

type ChatAction = ChatSubcommandActions['list'];

function createListAction(operations: ChatOwnerOperations): ChatAction {
  return async (context) => {
    try {
      const checkpoints = await operations.listCheckpoints();
      const item: HistoryItemChatList = {
        type: MessageType.CHAT_LIST,
        chats: checkpoints
          .map((entry) => ({ name: entry.name, mtime: entry.createdAt }))
          .sort((left, right) => {
            const byTime = left.mtime.localeCompare(right.mtime);
            return byTime === 0 ? left.name.localeCompare(right.name) : byTime;
          }),
      };
      context.ui.addItem(item);
      return undefined;
    } catch (error) {
      return failure('list saved chat checkpoints', error);
    }
  };
}

function createSaveAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const tag = args.trim();
    if (!tag) return usageError('Missing tag. Usage: /chat save <tag>');
    try {
      await operations.createCheckpoint(tag, {
        overwrite: context.overwriteConfirmed === true,
      });
      return {
        type: 'message',
        messageType: 'info',
        content: `Checkpoint saved: ${tag}.`,
      };
    } catch (error) {
      return (
        collision(context, tag, `/chat save ${tag}`, error) ??
        failure('save checkpoint', error)
      );
    }
  };
}

function createResumeAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const tag = args.trim();
    if (!tag) return usageError('Missing tag. Usage: /chat resume <tag>');
    try {
      replayUiHistory(context, operations, await operations.resume(tag));
      return undefined;
    } catch (error) {
      return failure('resume checkpoint', error);
    }
  };
}

function createDeleteAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const force = args.includes('--force');
    const tag = args.replace('--force', '').trim();
    if (!tag) return usageError('Missing tag. Usage: /chat delete <tag>');
    if (!force && context.overwriteConfirmed !== true)
      return {
        type: 'confirm_action',
        prompt: React.createElement(
          Text,
          null,
          'Are you sure you want to delete the checkpoint ',
          React.createElement(Text, { color: Colors.AccentPurple }, tag),
          '?',
        ),
        originalInvocation: {
          raw: context.invocation?.raw ?? `/chat delete ${tag}`,
        },
      };
    try {
      const resolved = resolveCheckpoint(
        tag,
        await operations.listCheckpoints(),
      );
      if (typeof resolved === 'string')
        return {
          type: 'message',
          messageType: 'info',
          content: `${resolved}.`,
        };
      await operations.deleteCheckpoint(resolved.checkpointId);
      return {
        type: 'message',
        messageType: 'info',
        content: `Deleted checkpoint: ${tag}`,
      };
    } catch (error) {
      return failure('delete checkpoint', error);
    }
  };
}

function createRenameAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length !== 2)
      return usageError('Usage: /chat rename <old_tag> <new_tag>');
    const [oldTag, newTag] = parts;
    try {
      const resolved = resolveCheckpoint(
        oldTag,
        await operations.listCheckpoints(),
      );
      if (typeof resolved === 'string') return usageError(resolved);
      await operations.renameCheckpoint(resolved.checkpointId, newTag, {
        overwrite: context.overwriteConfirmed === true,
      });
      return {
        type: 'message',
        messageType: 'info',
        content: `Renamed checkpoint from ${oldTag} to ${newTag}`,
      };
    } catch (error) {
      return (
        collision(context, newTag, `/chat rename ${oldTag} ${newTag}`, error) ??
        failure('rename checkpoint', error)
      );
    }
  };
}

function createClearAction(operations: ChatOwnerOperations): ChatAction {
  return async (context) => {
    try {
      if ((await operations.getHistory()).length === 0)
        return {
          type: 'message',
          messageType: 'info',
          content: 'No conversation to clear.',
        };
      await operations.clearHistory();
      context.ui.updateHistoryTokenCount(0);
      context.ui.clear();
      return undefined;
    } catch (error) {
      return failure('clear history', error);
    }
  };
}

function createRestoreAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const turnsStr = args.trim();
    if (!turnsStr) return usageError('Usage: /chat restore <number>');
    const turns = parseInt(turnsStr, 10);
    if (isNaN(turns) || turns < 1)
      return usageError(
        'Please provide a valid positive number of turns to restore.',
      );
    try {
      const result = await operations.restoreTurns(turns);
      if (result.itemsRemoved === 0)
        return {
          type: 'message',
          messageType: 'info',
          content:
            'Not enough history to restore the requested number of turns.',
        };
      replayUiHistory(context, operations, result.remainingHistory);
      return undefined;
    } catch (error) {
      return failure('restore history', error);
    }
  };
}

function createNameAction(operations: ChatOwnerOperations): ChatAction {
  return async (context, args) => {
    const name = args.trim();
    if (!name) return usageError('Missing name. Usage: /chat name <name>');
    try {
      await operations.nameCurrentSession(name, {
        overwrite: context.overwriteConfirmed === true,
      });
      return {
        type: 'message',
        messageType: 'info',
        content: `Session named: ${name}`,
      };
    } catch (error) {
      return (
        collision(context, name, `/chat name ${name}`, error) ??
        failure('name session', error)
      );
    }
  };
}

function createDebugAction(operations: ChatOwnerOperations): ChatAction {
  return async () => {
    const history = await operations.getHistory();
    return {
      type: 'message',
      messageType: 'info',
      content: `Chat Debug Information:\n• Chat initialized: ${history.length > 0}\n• History entries: ${history.length}\n• Current model: ${operations.getModel()}\n• Recording: ${operations.getRecordingPath() ?? 'not active'}`,
    };
  };
}

export function createChatOwnerCommand(
  operations: ChatOwnerOperations,
): SlashCommand {
  return composeChatCommand(
    {
      list: createListAction(operations),
      save: createSaveAction(operations),
      resume: createResumeAction(operations),
      delete: createDeleteAction(operations),
      rename: createRenameAction(operations),
      clear: createClearAction(operations),
      restore: createRestoreAction(operations),
      name: createNameAction(operations),
      debug: createDebugAction(operations),
    },
    [
      {
        kind: 'value',
        name: 'tag',
        description: 'Select saved checkpoint',
        completer: withFuzzyFilter(async () =>
          (await operations.listCheckpoints()).map((entry) => ({
            value: entry.name,
            description: 'Saved conversation checkpoint',
          })),
        ),
      },
    ],
  );
}
