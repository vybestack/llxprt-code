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
import { HistoryItemWithoutId, MessageType } from '../types.js';
import { Content, Part } from '@google/genai';
import { type CommandArgumentSchema } from './schema/types.js';

interface ChatDetail {
  name: string;
  mtime: Date;
}

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
    const chatDetails: Array<{ name: string; mtime: Date }> = [];

    for (const file of files) {
      if (file.startsWith(file_head) && file.endsWith(file_tail)) {
        const filePath = path.join(geminiDir, file);
        const stats = await fsPromises.stat(filePath);
        const tagName = file.slice(file_head.length, -file_tail.length);
        chatDetails.push({
          name: decodeTagName(tagName),
          mtime: stats.mtime,
        });
      }
    }

    chatDetails.sort((a, b) =>
      mtSortDesc
        ? b.mtime.getTime() - a.mtime.getTime()
        : a.mtime.getTime() - b.mtime.getTime(),
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
  action: async (context): Promise<MessageActionReturn> => {
    const chatDetails = await getSavedChatTags(context, false);
    if (chatDetails.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No saved conversation checkpoints found.',
      };
    }

    const maxNameLength = Math.max(
      ...chatDetails.map((chat) => chat.name.length),
    );

    let message = 'List of saved conversations:\n\n';
    for (const chat of chatDetails) {
      const paddedName = chat.name.padEnd(maxNameLength, ' ');
      const isoString = chat.mtime.toISOString();
      const match = isoString.match(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
      const formattedDate = match ? `${match[1]} ${match[2]}` : 'Invalid Date';
      message += `  - \u001b[36m${paddedName}\u001b[0m  \u001b[90m(saved on ${formattedDate})\u001b[0m\n`;
    }
    message += `\n\u001b[90mNote: Newest last, oldest first\u001b[0m`;
    return {
      type: 'message',
      messageType: 'info',
      content: message,
    };
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

    const rolemap: { [key: string]: MessageType } = {
      user: MessageType.USER,
      model: MessageType.GEMINI,
    };

    const uiHistory: HistoryItemWithoutId[] = [];
    let hasSystemPrompt = false;
    let i = 0;

    for (const item of conversation) {
      i += 1;
      const text =
        item.parts
          ?.filter((m: Part) => !!m.text)
          .map((m: Part) => m.text)
          .join('') || '';
      if (!text) {
        continue;
      }
      if (i === 1 && text.match(/context for our chat/)) {
        hasSystemPrompt = true;
      }
      if (i > 2 || !hasSystemPrompt) {
        uiHistory.push({
          type: (item.role && rolemap[item.role]) || MessageType.GEMINI,
          text,
        } as HistoryItemWithoutId);
      }
    }
    return {
      type: 'load_history',
      history: uiHistory,
      clientHistory: conversation,
    };
  },
};

const deleteCommand: SlashCommand = {
  name: 'delete',
  description: 'Delete a conversation checkpoint. Usage: /chat delete <tag>',
  kind: CommandKind.BUILT_IN,
  schema: chatTagSchema,
  action: async (context, args): Promise<MessageActionReturn> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
    }

    const { logger } = context.services;
    await logger.initialize();
    const deleted = await logger.deleteCheckpoint(tag);

    if (deleted) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation checkpoint '${decodeTagName(tag)}' has been deleted.`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Error: No checkpoint found with tag '${decodeTagName(tag)}'.`,
      };
    }
  },
  completion: async (context, partialArg) => {
    const chatDetails = await getSavedChatTags(context, true);
    return chatDetails
      .map((chat) => chat.name)
      .filter((name) => name.startsWith(partialArg));
  },
};

export function serializeHistoryToMarkdown(history: Content[]): string {
  return history
    .map((item) => {
      const text =
        item.parts
          ?.map((part) => {
            if (part.text) {
              return part.text;
            }
            if (part.functionCall) {
              return `**Tool Command**:\n\`\`\`json\n${JSON.stringify(
                part.functionCall,
                null,
                2,
              )}\n\`\`\``;
            }
            if (part.functionResponse) {
              return `**Tool Response**:\n\`\`\`json\n${JSON.stringify(
                part.functionResponse,
                null,
                2,
              )}\n\`\`\``;
            }
            return '';
          })
          .join('') || '';
      const roleIcon = item.role === 'user' ? '🧑‍💻' : '✨';
      return `${roleIcon} ## ${(item.role || 'model').toUpperCase()}\n\n${text}`;
    })
    .join('\n\n---\n\n');
}

const shareCommand: SlashCommand = {
  name: 'share',
  description:
    'Share the current conversation to a markdown or json file. Usage: /chat share <file>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<MessageActionReturn> => {
    let filePathArg = args.trim();
    if (!filePathArg) {
      filePathArg = `gemini-conversation-${Date.now()}.json`;
    }

    const filePath = path.resolve(filePathArg);
    const extension = path.extname(filePath);
    if (extension !== '.md' && extension !== '.json') {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Invalid file format. Only .md and .json are supported.',
      };
    }

    const chat = await context.services.config?.getGeminiClient()?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available to share conversation.',
      };
    }

    const history = chat.getHistory();

    // An empty conversation has two hidden messages that setup the context for
    // the chat. Thus, to check whether a conversation has been started, we
    // can't check for length 0.
    if (history.length <= 2) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation found to share.',
      };
    }

    let content = '';
    if (extension === '.json') {
      content = JSON.stringify(history, null, 2);
    } else {
      content = serializeHistoryToMarkdown(history);
    }

    try {
      await fsPromises.writeFile(filePath, content);
      return {
        type: 'message',
        messageType: 'info',
        content: `Conversation shared to ${filePath}`,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      return {
        type: 'message',
        messageType: 'error',
        content: `Error sharing conversation: ${errorMessage}`,
      };
    }
  },
};

export const chatCommand: SlashCommand = {
  name: 'chat',
  description: 'Manage conversation history.',
  kind: CommandKind.BUILT_IN,
  subCommands: [
    listCommand,
    saveCommand,
    resumeCommand,
    deleteCommand,
    shareCommand,
  ],
};
