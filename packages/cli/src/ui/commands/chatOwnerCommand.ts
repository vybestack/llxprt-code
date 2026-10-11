/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import type { Agent, CheckpointInfo } from '@vybestack/llxprt-code-agents';
import { Colors } from '../colors.js';
import { MessageType, type HistoryItemChatList } from '../types.js';
import {
  iContentToHistoryItems,
  resolveEmojiFilterMode,
} from '../utils/iContentToHistoryItems.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { chatCommand } from './chatCommand.js';

function owner(context: CommandContext): Agent {
  const agent = context.services.agent;
  if (!agent) throw new Error('No session owner available');
  return agent;
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

async function replayUiHistory(
  context: CommandContext,
  history: Awaited<ReturnType<Agent['getHistory']>>,
): Promise<void> {
  context.ui.loadHistory(
    iContentToHistoryItems(
      [...history],
      resolveEmojiFilterMode(context.services.config),
    ),
  );
}

const actions: Record<string, NonNullable<SlashCommand['action']>> = {
  list: async (context) => {
    try {
      const checkpoints = await owner(context).session.listCheckpoints();
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
  },
  save: async (context, args) => {
    const tag = args.trim();
    if (!tag)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      };
    try {
      await owner(context).session.createCheckpoint(tag, {
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
  },
  resume: async (context, args) => {
    const tag = args.trim();
    if (!tag)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      };
    try {
      const agent = owner(context);
      const history = await agent.session.resume(tag);
      await replayUiHistory(context, history);
      return undefined;
    } catch (error) {
      return failure('resume checkpoint', error);
    }
  },
  delete: async (context, args) => {
    const force = args.includes('--force');
    const tag = args.replace('--force', '').trim();
    if (!tag)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
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
      const agent = owner(context);
      const resolved = resolveCheckpoint(
        tag,
        await agent.session.listCheckpoints(),
      );
      if (typeof resolved === 'string')
        return {
          type: 'message',
          messageType: 'info',
          content: `${resolved}.`,
        };
      await agent.session.deleteCheckpoint(resolved.checkpointId);
      return {
        type: 'message',
        messageType: 'info',
        content: `Deleted checkpoint: ${tag}`,
      };
    } catch (error) {
      return failure('delete checkpoint', error);
    }
  },
  rename: async (context, args) => {
    const parts = args.trim().split(/\s+/);
    if (parts.length !== 2)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat rename <old_tag> <new_tag>',
      };
    const [oldTag, newTag] = parts;
    try {
      const agent = owner(context);
      const resolved = resolveCheckpoint(
        oldTag,
        await agent.session.listCheckpoints(),
      );
      if (typeof resolved === 'string')
        return { type: 'message', messageType: 'error', content: resolved };
      await agent.session.renameCheckpoint(resolved.checkpointId, newTag, {
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
  },
  clear: async (context) => {
    try {
      const agent = owner(context);
      if ((await agent.session.getHistory()).length === 0)
        return {
          type: 'message',
          messageType: 'info',
          content: 'No conversation to clear.',
        };
      await agent.session.clearHistory();
      context.ui.updateHistoryTokenCount(0);
      context.ui.clear();
      return undefined;
    } catch (error) {
      return failure('clear history', error);
    }
  },
  restore: async (context, args) => {
    const turnsStr = args.trim();
    if (!turnsStr)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat restore <number>',
      };
    const turns = parseInt(turnsStr, 10);
    if (isNaN(turns) || turns < 1)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Please provide a valid positive number of turns to restore.',
      };
    try {
      const result = await owner(context).session.restoreTurns(turns);
      if (result.itemsRemoved === 0)
        return {
          type: 'message',
          messageType: 'info',
          content:
            'Not enough history to restore the requested number of turns.',
        };
      await replayUiHistory(context, result.remainingHistory);
      return undefined;
    } catch (error) {
      return failure('restore history', error);
    }
  },
  name: async (context, args) => {
    const name = args.trim();
    if (!name)
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing name. Usage: /chat name <name>',
      };
    try {
      await owner(context).session.nameCurrentSession(name, {
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
  },
  debug: async (context) => {
    const agent = owner(context);
    const history = await agent.session.getHistory();
    const recording = agent.session.getRecording();
    return {
      type: 'message',
      messageType: 'info',
      content: `Chat Debug Information:\n• Chat initialized: ${history.length > 0}\n• History entries: ${history.length}\n• Current model: ${agent.getModel()}\n• Recording: ${recording.path ?? 'not active'}`,
    };
  },
};

const checkpointSchema = [
  {
    kind: 'value' as const,
    name: 'tag',
    description: 'Select saved checkpoint',
    completer: withFuzzyFilter(async (context: CommandContext) =>
      (await owner(context).session.listCheckpoints()).map((entry) => ({
        value: entry.name,
        description: 'Saved conversation checkpoint',
      })),
    ),
  },
];

export const chatOwnerCommand: SlashCommand = {
  ...chatCommand,
  subCommands: chatCommand.subCommands?.map((command) => ({
    ...command,
    action: actions[command.name],
    ...(command.schema ? { schema: checkpointSchema } : {}),
  })),
};
