/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fsPromises from 'fs/promises';
import React from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import {
  CommandContext,
  SlashCommand,
  MessageActionReturn,
  CommandKind,
  SlashCommandActionReturn,
} from './types.js';
import {
  decodeTagName,
  EmojiFilter,
  type EmojiFilterMode,
} from '@vybestack/llxprt-code-core';
import path from 'path';
import type {
  HistoryItemWithoutId,
  HistoryItemChatList,
  ChatDetail,
} from '../types.js';
import { MessageType } from '../types.js';
import { Content, Part } from '@google/genai';
import { type CommandArgumentSchema } from './schema/types.js';

const getSavedChatTags = async (
  context: CommandContext,
  mtSortDesc: boolean,
): Promise<ChatDetail[]> => {
  const cfg = context.services.config;
  const geminiDir = cfg?.storage?.getProjectTempDir();
  if (!geminiDir) {
    return [];
  }
  try {
    const file_head = 'checkpoint-';
    const file_tail = '.json';
    const files = await fsPromises.readdir(geminiDir);
    const chatDetails: ChatDetail[] = [];

    for (const file of files) {
      if (file.startsWith(file_head) && file.endsWith(file_tail)) {
        const filePath = path.join(geminiDir, file);
        const stats = await fsPromises.stat(filePath);
        const tagName = file.slice(file_head.length, -file_tail.length);
        chatDetails.push({
          name: decodeTagName(tagName),
          mtime: stats.mtime.toISOString(),
        });
      }
    }

    chatDetails.sort((a, b) =>
      mtSortDesc
        ? b.mtime.localeCompare(a.mtime)
        : a.mtime.localeCompare(b.mtime),
    );

    return chatDetails;
  } catch (_err) {
    return [];
  }
};

const checkpointSuggestionDescription = 'Saved conversation checkpoint';
const chatTagSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'tag',
    description: 'Select saved checkpoint',
    /**
     * @plan:PLAN-20251013-AUTOCOMPLETE.P11
     * @requirement:REQ-004
     * Schema completer replaces legacy checkpoint completion.
     */
    completer: async (ctx, partialArg) => {
      const chatDetails = await getSavedChatTags(ctx, true);
      const normalizedPartial = partialArg.toLowerCase();
      return chatDetails
        .map((chat) => chat.name)
        .filter((name) =>
          normalizedPartial.length === 0
            ? true
            : name.toLowerCase().startsWith(normalizedPartial),
        )
        .map((name) => ({
          value: name,
          description: checkpointSuggestionDescription,
        }));
    },
  },
];

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List saved conversation checkpoints',
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<void> => {
    const chatDetails = await getSavedChatTags(context, false);

    const item: HistoryItemChatList = {
      type: MessageType.CHAT_LIST,
      chats: chatDetails,
    };

    context.ui.addItem(item, Date.now());
  },
};

const saveCommand: SlashCommand = {
  name: 'save',
  description:
    'Save the current conversation as a checkpoint. Usage: /chat save <tag>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<SlashCommandActionReturn | void> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      };
    }

    const { logger, config } = context.services;
    await logger.initialize();

    // Check for overwrite confirmation first
    if (!context.overwriteConfirmed) {
      const exists = await logger.checkpointExists(tag);
      if (exists) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A checkpoint with the tag ',
            React.createElement(Text, { color: Colors.AccentPurple }, tag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw || `/chat save ${tag}`,
          },
        };
      }
    }

    const client = config?.getGeminiClient();
    // Check if chat is initialized before accessing it
    if (!client?.hasChatInitialized()) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat history available to save.',
      };
    }

    const chat = client.getChat();
    const history = chat.getHistory();
    if (history.length > 2) {
      await logger.saveCheckpoint(history, tag);
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint saved with tag: ${decodeTagName(tag)}.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to save.',
      };
    }
  },
};

const resumeCommand: SlashCommand = {
  name: 'resume',
  altNames: ['load'],
  description:
    'Resume a conversation from a checkpoint. Usage: /chat resume <tag>',
  kind: CommandKind.BUILT_IN,
  schema: chatTagSchema,
  action: async (context, args) => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      };
    }

    const { logger, config } = context.services;
    await logger.initialize();

    // Get emoji filter mode from settings
    const emojiFilterMode =
      (config?.getEphemeralSetting('emojifilter') as EmojiFilterMode) || 'auto';

    // Create emoji filter if not in 'allowed' mode
    const emojiFilter =
      emojiFilterMode !== 'allowed'
        ? new EmojiFilter({ mode: emojiFilterMode })
        : undefined;

    const checkpoint = await logger.loadCheckpoint(tag);
    let conversation = checkpoint.history;

    // Apply emoji filtering if needed
    if (emojiFilter) {
      conversation = conversation.map((item) => {
        const filteredItem = { ...item };
        if (Array.isArray(filteredItem.parts)) {
          filteredItem.parts = filteredItem.parts.map((part: Part) => {
            if (part.text) {
              const filterResult = emojiFilter.filterText(part.text);
              return { ...part, text: filterResult.filtered as string };
            }
            return part;
          });
        }
        return filteredItem;
      });
    }

    if (conversation.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${decodeTagName(tag)}.`,
      };
    }

    const client = config?.getGeminiClient();
    const chat = client.getChat();
    await chat.loadHistory(conversation);

    const modelName = checkpoint.modelName || 'unknown';
    return {
      type: 'message',
      messageType: 'info',
      content: `Conversation from checkpoint (${decodeTagName(tag)}) with model ${modelName} is resumed. You can continue the conversation now.`,
    };
  },
};

const deleteCommand: SlashCommand = {
  name: 'delete',
  altNames: ['rm', 'remove'],
  description:
    'Delete a conversation checkpoint. Usage: /chat delete <tag> [--force]',
  kind: CommandKind.BUILT_IN,
  schema: chatTagSchema,
  action: async (context, args): Promise<MessageActionReturn> => {
    const force = args.includes('--force');
    const tag = args.replace('--force', '').trim();

    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
    }

    const { logger } = context.services;
    await logger.initialize();

    if (!force && !context.overwriteConfirmed) {
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
          raw: context.invocation?.raw || `/chat delete ${tag}`,
        },
      };
    }

    if (!(await logger.checkpointExists(tag))) {
      return {
        type: 'message',
        messageType: 'info',
        content: `No saved checkpoint found with tag: ${decodeTagName(tag)}.`,
      };
    }

    await logger.deleteCheckpoint(tag);

    return {
      type: 'message',
      messageType: 'info',
      content: `Deleted checkpoint: ${decodeTagName(tag)}`,
    };
  },
};

const renameCommand: SlashCommand = {
  name: 'rename',
  altNames: ['mv'],
  description:
    'Rename a conversation checkpoint. Usage: /chat rename <old_tag> <new_tag>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<MessageActionReturn> => {
    const parts = args.trim().split(/\s+/);
    if (parts.length !== 2) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat rename <old_tag> <new_tag>',
      };
    }

    const [oldTag, newTag] = parts;
    const { logger } = context.services;
    await logger.initialize();

    if (!(await logger.checkpointExists(oldTag))) {
      return {
        type: 'message',
        messageType: 'error',
        content: `No checkpoint found with tag: ${decodeTagName(oldTag)}`,
      };
    }

    if (await logger.checkpointExists(newTag)) {
      if (!context.overwriteConfirmed) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A checkpoint with the tag ',
            React.createElement(Text, { color: Colors.AccentPurple }, newTag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw || `/chat rename ${oldTag} ${newTag}`,
          },
        };
      }
      // If confirmed, delete the target checkpoint first
      await logger.deleteCheckpoint(newTag);
    }

    await logger.renameCheckpoint(oldTag, newTag);

    return {
      type: 'message',
      messageType: 'info',
      content: `Renamed checkpoint from ${decodeTagName(oldTag)} to ${decodeTagName(newTag)}`,
    };
  },
};

const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the current conversation history',
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<MessageActionReturn | void> => {
    const client = context.services.config?.getGeminiClient();
    // Check if chat is initialized before clearing
    if (!client?.hasChatInitialized()) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      };
    }

    const chat = client.getChat();
    const history = chat.getHistory();
    if (history.length <= 2) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      };
    }

    await chat.clearHistory();
    return {
      type: 'message',
      messageType: 'info',
      content: 'Conversation history cleared.',
    };
  },
};

/**
 * Restore the conversation based on the number of turns to go back.
 * @param context The slash command context.
 * @param turns Number of turns to restore (negative number).
 * @returns A message about the restore operation.
 */
const restoreHistory = async (
  context: CommandContext,
  turns: number,
): Promise<MessageActionReturn | void> => {
  const client = context.services.config?.getGeminiClient();
  if (!client?.hasChatInitialized()) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No chat history available to restore.',
    };
  }

  const chat = client.getChat();
  const currentHistory = chat.getHistory();
  const turnsToRestore = Math.abs(turns);

  if (turnsToRestore < 1) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Number of turns to restore must be greater than 0.',
    };
  }

  // Calculate how many entries to keep
  // Each turn typically has 2 entries (user + assistant), plus initial system/user
  const entriesToRemove = turnsToRestore * 2;
  const minEntries = 2; // Keep at least the initial entries

  if (currentHistory.length <= minEntries + entriesToRemove) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'Not enough history to restore the requested number of turns.',
    };
  }

  // Create new history by removing the last N turns
  const newHistory = currentHistory.slice(0, -entriesToRemove);
  await chat.loadHistory(newHistory);

  return {
    type: 'message',
    messageType: 'info',
    content: `Restored conversation to ${turnsToRestore} turn${turnsToRestore > 1 ? 's' : ''} ago.`,
  };
};

const restoreCommand: SlashCommand = {
  name: 'restore',
  altNames: ['undo'],
  description:
    'Restore conversation to N turns ago. Usage: /chat restore <number>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<MessageActionReturn | void> => {
    const turnsStr = args.trim();
    if (!turnsStr) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat restore <number>',
      };
    }

    const turns = parseInt(turnsStr, 10);
    if (isNaN(turns) || turns < 1) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Please provide a valid positive number of turns to restore.',
      };
    }

    return restoreHistory(context, -turns);
  },
};

export const chatCommand: SlashCommand = {
  name: 'chat',
  description: 'Manage conversation checkpoints',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    listCommand,
    saveCommand,
    resumeCommand,
    deleteCommand,
    renameCommand,
    clearCommand,
    restoreCommand,
  ],
  action: async (): Promise<HistoryItemWithoutId> => {
    return {
      type: 'info',
      text: `Available /chat commands:
• list - List all saved conversation checkpoints
• save <tag> - Save current conversation with a tag
• resume <tag> - Resume a saved conversation
• delete <tag> [--force] - Delete a saved checkpoint
• rename <old_tag> <new_tag> - Rename a checkpoint
• clear - Clear current conversation history
• restore <number> - Restore conversation to N turns ago`,
    };
  },
};