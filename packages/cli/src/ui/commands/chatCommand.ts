/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { dirname } from 'node:path';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import type {
  CommandContext,
  SlashCommand,
  MessageActionReturn,
  SlashCommandActionReturn,
} from './types.js';
import { CommandKind } from './types.js';
import {
  CheckpointService,
  HistoryMutationService,
  SessionDiscovery,
  getProjectHash,
  type ContinueTarget,
  type IContent,
  type SessionRecordingService,
  type TextBlock,
} from '@vybestack/llxprt-code-core';
import type {
  ChatDetail,
  HistoryItemChatList,
  HistoryItemWithoutId,
} from '../types.js';
import { MessageType } from '../types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';

function getProjectHashForContext(context: CommandContext): string | null {
  const recording = getRecording(context);
  if (recording !== null) return recording.getProjectHash();
  const config = context.services.config;
  return config ? getProjectHash(config.getProjectRoot()) : null;
}
function getRecording(context: CommandContext): SessionRecordingService | null {
  return (
    context.recordingSwapCallbacks?.getCurrentRecording() ??
    context.recordingIntegration?.getRecordingService() ??
    null
  );
}

function getChatsDir(context: CommandContext): string | null {
  const recording = getRecording(context);
  if (recording !== null) return recording.getChatsDir();
  return context.services.config?.storage.getProjectChatsDir() ?? null;
}

type CheckpointResolution =
  | { target: Extract<ContinueTarget, { kind: 'checkpoint' }> }
  | { error: string };

function resolveCheckpoint(
  ref: string,
  checkpoints: ReadonlyArray<Extract<ContinueTarget, { kind: 'checkpoint' }>>,
): CheckpointResolution {
  const exactId = checkpoints.filter(
    (checkpoint) => checkpoint.checkpointId === ref,
  );
  if (exactId.length === 1) return { target: exactId[0] };
  if (exactId.length > 1) {
    return { error: `Ambiguous checkpoint ID: ${ref}` };
  }
  const names = checkpoints.filter(
    (checkpoint) => checkpoint.checkpointName === ref,
  );
  if (names.length === 1) return { target: names[0] };
  if (names.length > 1) {
    return { error: `Ambiguous checkpoint name: ${ref}` };
  }
  return { error: `No checkpoint found with tag: ${ref}` };
}

async function listProjectCheckpoints(
  context: CommandContext,
): Promise<Array<Extract<ContinueTarget, { kind: 'checkpoint' }>>> {
  const projectHash = getProjectHashForContext(context);
  if (projectHash === null) return [];
  const chatsDir = getChatsDir(context);
  if (chatsDir === null) return [];
  const targets = await SessionDiscovery.listContinueTargets(
    chatsDir,
    projectHash,
  );
  return targets.filter(
    (target): target is Extract<ContinueTarget, { kind: 'checkpoint' }> =>
      target.kind === 'checkpoint',
  );
}

const getSavedChatTags = async (
  context: CommandContext,
): Promise<ChatDetail[]> => {
  try {
    const checkpoints = await listProjectCheckpoints(context);
    return checkpoints
      .map((checkpoint) => ({
        name: checkpoint.checkpointName,
        mtime: checkpoint.source.lastModified.toISOString(),
      }))
      .sort((left, right) => {
        const byModifiedTime = left.mtime.localeCompare(right.mtime);
        return byModifiedTime === 0
          ? left.name.localeCompare(right.name)
          : byModifiedTime;
      });
  } catch (error: unknown) {
    debugLogger.warn(`Failed to list saved chat checkpoints: ${String(error)}`);
    return [];
  }
};

const checkpointSuggestionDescription = 'Saved conversation checkpoint';
const chatTagSchema: CommandArgumentSchema = [
  {
    kind: 'value',
    name: 'tag',
    description: 'Select saved checkpoint',
    completer: withFuzzyFilter(async (ctx) => {
      const chatDetails = await getSavedChatTags(ctx);
      return [...chatDetails].reverse().map((chat) => ({
        value: chat.name,
        description: checkpointSuggestionDescription,
      }));
    }),
  },
];

const listCommand: SlashCommand = {
  name: 'list',
  description: 'List saved conversation checkpoints',
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<void> => {
    const chatDetails = await getSavedChatTags(context);

    const item: HistoryItemChatList = {
      type: MessageType.CHAT_LIST,
      chats: chatDetails,
    };

    context.ui.addItem(item);
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

    const recording = getRecording(context);
    const projectHash = getProjectHashForContext(context);
    if (!recording || projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recording available to create checkpoint.',
      };
    }

    try {
      await new CheckpointService().createCheckpoint(
        recording,
        projectHash,
        tag,
        context.overwriteConfirmed === true,
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Checkpoint saved: ${tag}.`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        context.overwriteConfirmed !== true &&
        detail.includes('already exists')
      ) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A session or checkpoint named ',
            React.createElement(Text, { color: Colors.AccentPurple }, tag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw ?? `/chat save ${tag}`,
          },
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to save checkpoint: ${detail}`,
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
  autoExecute: true,
  action: async (context, args): Promise<SlashCommandActionReturn> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat resume <tag>',
      };
    }

    // /chat resume is an alias of /continue — both enter the same transition service
    return {
      type: 'perform_resume',
      sessionRef: tag,
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
  autoExecute: true,
  action: async (context, args): Promise<SlashCommandActionReturn> => {
    const force = args.includes('--force');
    const tag = args.replace('--force', '').trim();

    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat delete <tag>',
      };
    }

    if (!force && context.overwriteConfirmed !== true) {
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
    }

    const recording = getRecording(context);
    const checkpoints = await listProjectCheckpoints(context);
    const resolved = resolveCheckpoint(tag, checkpoints);
    if ('error' in resolved) {
      return {
        type: 'message',
        messageType: 'info',
        content: `${resolved.error}.`,
      };
    }
    const target = resolved.target;

    try {
      const service = new CheckpointService();
      if (recording?.getSessionId() === target.source.sessionId) {
        await service.deleteCheckpoint(
          recording,
          target.source.projectHash,
          target.checkpointId,
        );
      } else {
        await service.deleteCheckpointClosed(
          target.source.filePath,
          target.source.projectHash,
          getChatsDir(context) ?? dirname(target.source.filePath),
          target.source.sessionId,
          target.checkpointId,
        );
      }
      return {
        type: 'message',
        messageType: 'info',
        content: `Deleted checkpoint: ${tag}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to delete checkpoint: ${detail}`,
      };
    }
  },
};

async function renameCheckpointTarget(
  context: CommandContext,
  target: Extract<ContinueTarget, { kind: 'checkpoint' }>,
  newName: string,
  projectHash: string,
): Promise<void> {
  const recording = getRecording(context);
  const service = new CheckpointService();
  if (recording?.getSessionId() === target.source.sessionId) {
    await service.renameCheckpoint(
      recording,
      projectHash,
      target.checkpointId,
      newName,
      context.overwriteConfirmed === true,
    );
    return;
  }
  await service.renameCheckpointClosed(
    target.source.filePath,
    projectHash,
    getChatsDir(context) ?? dirname(target.source.filePath),
    target.source.sessionId,
    target.checkpointId,
    newName,
    context.overwriteConfirmed === true,
  );
}

const renameCommand: SlashCommand = {
  name: 'rename',
  altNames: ['mv'],
  description:
    'Rename a conversation checkpoint. Usage: /chat rename <old_tag> <new_tag>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<SlashCommandActionReturn> => {
    const parts = args.trim().split(/\s+/);
    if (parts.length !== 2) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat rename <old_tag> <new_tag>',
      };
    }

    const [oldTag, newTag] = parts;

    const checkpoints = await listProjectCheckpoints(context);
    const resolved = resolveCheckpoint(oldTag, checkpoints);
    if ('error' in resolved) {
      return {
        type: 'message',
        messageType: 'error',
        content: resolved.error,
      };
    }
    const target = resolved.target;

    const projectHash = getProjectHashForContext(context);
    if (projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Project context is unavailable.',
      };
    }

    try {
      await renameCheckpointTarget(context, target, newTag, projectHash);
      return {
        type: 'message',
        messageType: 'info',
        content: `Renamed checkpoint from ${oldTag} to ${newTag}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        context.overwriteConfirmed !== true &&
        detail.includes('already exists')
      ) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A session or checkpoint named ',
            React.createElement(Text, { color: Colors.AccentPurple }, newTag),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw ?? `/chat rename ${oldTag} ${newTag}`,
          },
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to rename checkpoint: ${detail}`,
      };
    }
  },
};

const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear the current conversation history',
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<MessageActionReturn | void> => {
    const client = context.services.config?.getAgentClient();
    if (client?.hasChatInitialized() !== true) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      };
    }

    const chat = client.getChat();
    const history = chat.getHistory();

    const recording = getRecording(context);
    if (!recording) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recording available for durable clear.',
      };
    }

    const mutator = new HistoryMutationService();
    const result = await mutator.clear(history, recording);

    if (!result.ok) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to clear history: ${result.error}`,
      };
    }
    if (result.itemsRemoved === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      };
    }

    chat.setHistory(result.remainingHistory);
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
    return undefined;
  },
};

const restoreHistory = async (
  context: CommandContext,
  turns: number,
): Promise<SlashCommandActionReturn> => {
  const client = context.services.config?.getAgentClient();
  if (client?.hasChatInitialized() !== true) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No chat history available to restore.',
    };
  }

  const currentHistory = client.getChat().getHistory();
  const turnsToRestore = Math.abs(turns);

  if (turnsToRestore < 1) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Number of turns to restore must be greater than 0.',
    };
  }

  const recording = getRecording(context);
  if (!recording) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No recording available for durable restore.',
    };
  }

  const mutator = new HistoryMutationService();
  const result = await mutator.restore(
    currentHistory,
    turnsToRestore,
    recording,
  );

  if (!result.ok) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to restore history: ${result.error}`,
    };
  }

  if (result.itemsRemoved === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'Not enough history to restore the requested number of turns.',
    };
  }

  // Convert to UI history items for display. The slash-command result handler
  // applies the client history exactly once after durable persistence succeeds.
  const uiHistory: HistoryItemWithoutId[] = result.remainingHistory.map(
    (content: IContent) => {
      const textBlocks = content.blocks.filter(
        (b): b is TextBlock => b.type === 'text',
      );
      const text = textBlocks.map((b) => b.text).join('');
      return {
        type: content.speaker === 'human' ? MessageType.USER : MessageType.AI,
        text,
      };
    },
  );

  return {
    type: 'load_history',
    history: uiHistory,
    clientHistory: result.remainingHistory,
  };
};

const restoreCommand: SlashCommand = {
  name: 'restore',
  altNames: ['undo'],
  description:
    'Restore conversation to N turns ago. Usage: /chat restore <number>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<SlashCommandActionReturn> => {
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

const nameCommand: SlashCommand = {
  name: 'name',
  description: 'Name the active session. Usage: /chat name <name>',
  kind: CommandKind.BUILT_IN,
  action: async (context, args): Promise<SlashCommandActionReturn> => {
    const name = args.trim();
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing name. Usage: /chat name <name>',
      };
    }

    const recording = getRecording(context);
    const projectHash = getProjectHashForContext(context);
    if (!recording || projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No active recording to name.',
      };
    }

    try {
      await new CheckpointService().setSessionName(
        recording,
        projectHash,
        name,
        context.overwriteConfirmed === true,
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Session named: ${name}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (
        context.overwriteConfirmed !== true &&
        detail.includes('already exists')
      ) {
        return {
          type: 'confirm_action',
          prompt: React.createElement(
            Text,
            null,
            'A session or checkpoint named ',
            React.createElement(Text, { color: Colors.AccentPurple }, name),
            ' already exists. Do you want to overwrite it?',
          ),
          originalInvocation: {
            raw: context.invocation?.raw ?? `/chat name ${name}`,
          },
        };
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to name session: ${detail}`,
      };
    }
  },
};

const debugCommand: SlashCommand = {
  name: 'debug',
  description: 'Show chat diagnostics and debug information',
  kind: CommandKind.BUILT_IN,
  action: async (context): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;
    const client = config?.getAgentClient();

    const debugInfo: string[] = [];

    const chatInitialized = client?.hasChatInitialized() ?? false;
    debugInfo.push(`Chat initialized: ${chatInitialized}`);

    if (chatInitialized && client) {
      try {
        const chat = client.getChat();
        const history = chat.getHistory();
        debugInfo.push(`History entries: ${history.length}`);
      } catch {
        debugInfo.push('History entries: unavailable');
      }
    } else {
      debugInfo.push('History entries: 0 (chat not initialized)');
    }

    if (config) {
      try {
        const model = config.getModel();
        debugInfo.push(`Current model: ${model}`);
      } catch {
        debugInfo.push('Current model: unavailable');
      }
    } else {
      debugInfo.push('Current model: unavailable (config not initialized)');
    }

    const recording = getRecording(context);
    if (recording?.getFilePath()) {
      debugInfo.push(`Recording file: ${recording.getFilePath()}`);
      debugInfo.push(`Session ID: ${recording.getSessionId()}`);
    } else {
      debugInfo.push('Recording: not active');
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `Chat Debug Information:\n${debugInfo.map((line) => `• ${line}`).join('\n')}`,
    };
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
    nameCommand,
    debugCommand,
  ],
  action: async (): Promise<MessageActionReturn> => ({
    type: 'message',
    messageType: 'info',
    content: `Available /chat commands:
• list - List all saved conversation checkpoints
• save <tag> - Save current conversation with a tag
• resume <tag> - Resume a saved conversation (alias of /continue)
• delete <tag> [--force] - Delete a saved checkpoint
• rename <old_tag> <new_tag> - Rename a checkpoint
• clear - Clear current conversation history
• restore <number> - Restore conversation to N turns ago
• name <name> - Name the active session
• debug - Show chat diagnostics and debug information`,
  }),
};
