/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import { Colors } from '../colors.js';
import type {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { composeChatCommand } from './chatCommandShape.js';
import {
  type ContinueTarget,
  type UnreadableRecording,
  type IContent,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import type { ChatDetail, HistoryItemChatList } from '../types.js';
import { MessageType } from '../types.js';
import { type CommandArgumentSchema } from './schema/types.js';
import { withFuzzyFilter } from '../utils/fuzzyFilter.js';
import { debugLogger } from '@vybestack/llxprt-code-telemetry';
import { warnUnreadableRecordings } from '../utils/warnUnreadableRecordings.js';

/**
 * Operations the recording-native /chat command uses. The host binds them to
 * the session's recording, project and chat history when it registers the
 * command, so invocation context never selects the owner.
 */
export interface ChatRecordingOperations {
  readonly getRecording: () => SessionRecordingPort | null;
  readonly getProjectHash: () => string | null;
  readonly getChatsDir: () => string | null;
  readonly listTargets: () => Promise<{
    targets: ContinueTarget[];
    unreadableRecordings: readonly UnreadableRecording[];
  }>;
  readonly saveCheckpoint: (name: string, overwrite: boolean) => Promise<void>;
  readonly deleteCheckpoint: (target: CheckpointTarget) => Promise<void>;
  readonly renameCheckpoint: (
    target: CheckpointTarget,
    name: string,
    overwrite: boolean,
  ) => Promise<void>;
  readonly nameSession: (name: string, overwrite: boolean) => Promise<void>;
  /** Live chat history, or null when no chat has been initialized. */
  readonly getChatHistory: () => AsyncIterable<IContent> | null;
  readonly clearHistory: (options?: {
    readonly signal?: AbortSignal;
    readonly publish?: () => void | Promise<void>;
  }) => Promise<void>;
  readonly restoreTurns: (
    turns: number,
    options?: {
      readonly signal?: AbortSignal;
      readonly publish?: () => void | Promise<void>;
    },
  ) => Promise<{ readonly itemsRemoved: number }>;
  /** Configured model name, or null when no configuration is available. */
  readonly getModel: () => string | null;
}

type CheckpointTarget = Extract<ContinueTarget, { kind: 'checkpoint' }>;

type CheckpointResolution = { target: CheckpointTarget } | { error: string };

function resolveCheckpoint(
  ref: string,
  checkpoints: readonly CheckpointTarget[],
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
  operations: ChatRecordingOperations,
): Promise<CheckpointTarget[]> {
  const projectHash = operations.getProjectHash();
  if (projectHash === null) return [];
  const chatsDir = operations.getChatsDir();
  if (chatsDir === null) return [];
  const detailed = await operations.listTargets();
  warnUnreadableRecordings('/chat checkpoints', detailed.unreadableRecordings);
  return detailed.targets.filter(
    (target): target is CheckpointTarget => target.kind === 'checkpoint',
  );
}

async function getSavedChatTags(
  operations: ChatRecordingOperations,
): Promise<ChatDetail[]> {
  try {
    const checkpoints = await listProjectCheckpoints(operations);
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
}

const checkpointSuggestionDescription = 'Saved conversation checkpoint';

function createChatTagSchema(
  operations: ChatRecordingOperations,
  readFuzzyFiltering: () => boolean,
): CommandArgumentSchema {
  return [
    {
      kind: 'value',
      name: 'tag',
      description: 'Select saved checkpoint',
      completer: withFuzzyFilter(async () => {
        const chatDetails = await getSavedChatTags(operations);
        return [...chatDetails].reverse().map((chat) => ({
          value: chat.name,
          description: checkpointSuggestionDescription,
        }));
      }, readFuzzyFiltering),
    },
  ];
}

function overwriteConfirmation(
  context: CommandContext,
  name: string,
  fallbackInvocation: string,
): SlashCommandActionReturn {
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
      raw: context.invocation?.raw ?? fallbackInvocation,
    },
  };
}

function isCollision(context: CommandContext, detail: string): boolean {
  return (
    context.overwriteConfirmed !== true && detail.includes('already exists')
  );
}

function createListAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context): Promise<void> => {
    const chatDetails = await getSavedChatTags(operations);

    const item: HistoryItemChatList = {
      type: MessageType.CHAT_LIST,
      chats: chatDetails,
    };

    context.ui.addItem(item);
  };
}

function createSaveAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context, args): Promise<SlashCommandActionReturn | void> => {
    const tag = args.trim();
    if (!tag) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing tag. Usage: /chat save <tag>',
      };
    }

    const recording = operations.getRecording();
    const projectHash = operations.getProjectHash();
    if (!recording || projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recording available to create checkpoint.',
      };
    }

    try {
      await operations.saveCheckpoint(tag, context.overwriteConfirmed === true);
      return {
        type: 'message',
        messageType: 'info',
        content: `Checkpoint saved: ${tag}.`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isCollision(context, detail)) {
        return overwriteConfirmation(context, tag, `/chat save ${tag}`);
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to save checkpoint: ${detail}`,
      };
    }
  };
}

function createResumeAction(): NonNullable<SlashCommand['action']> {
  return async (_context, args): Promise<SlashCommandActionReturn> => {
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
  };
}

async function deleteCheckpointTarget(
  operations: ChatRecordingOperations,
  target: CheckpointTarget,
): Promise<void> {
  await operations.deleteCheckpoint(target);
}

function createDeleteAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context, args): Promise<SlashCommandActionReturn> => {
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

    const checkpoints = await listProjectCheckpoints(operations);
    const resolved = resolveCheckpoint(tag, checkpoints);
    if ('error' in resolved) {
      return {
        type: 'message',
        messageType: 'info',
        content: `${resolved.error}.`,
      };
    }

    try {
      await deleteCheckpointTarget(operations, resolved.target);
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
  };
}

async function renameCheckpointTarget(
  operations: ChatRecordingOperations,
  target: CheckpointTarget,
  newName: string,
  _projectHash: string,
  overwrite: boolean,
): Promise<void> {
  await operations.renameCheckpoint(target, newName, overwrite);
}

function createRenameAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context, args): Promise<SlashCommandActionReturn> => {
    const parts = args.trim().split(/\s+/);
    if (parts.length !== 2) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Usage: /chat rename <old_tag> <new_tag>',
      };
    }

    const [oldTag, newTag] = parts;

    const checkpoints = await listProjectCheckpoints(operations);
    const resolved = resolveCheckpoint(oldTag, checkpoints);
    if ('error' in resolved) {
      return {
        type: 'message',
        messageType: 'error',
        content: resolved.error,
      };
    }

    const projectHash = operations.getProjectHash();
    if (projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Project context is unavailable.',
      };
    }

    try {
      await renameCheckpointTarget(
        operations,
        resolved.target,
        newTag,
        projectHash,
        context.overwriteConfirmed === true,
      );
      return {
        type: 'message',
        messageType: 'info',
        content: `Renamed checkpoint from ${oldTag} to ${newTag}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isCollision(context, detail)) {
        return overwriteConfirmation(
          context,
          newTag,
          `/chat rename ${oldTag} ${newTag}`,
        );
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to rename checkpoint: ${detail}`,
      };
    }
  };
}

async function hasRemovableTurn(
  history: AsyncIterable<IContent>,
): Promise<boolean> {
  let humans = 0;
  for await (const row of history) {
    if (row.speaker === 'human' && ++humans === 2) return true;
  }
  return false;
}

async function reportHistoryMutation(
  operation: 'clear' | 'restore',
  signal: AbortSignal,
  recording: SessionRecordingPort,
  execute: () => Promise<SlashCommandActionReturn | void>,
): Promise<SlashCommandActionReturn | void> {
  try {
    signal.throwIfAborted();
    if (!recording.isActive()) throw new Error('Recording is not active');
    await recording.flush();
    signal.throwIfAborted();
    if (!recording.isActive())
      throw new Error('Recording failed before the cut');
    return await execute();
  } catch (error) {
    signal.throwIfAborted();
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to ${operation} history: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function createClearAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context): Promise<SlashCommandActionReturn | void> => {
    context.signal.throwIfAborted();
    const history = operations.getChatHistory();
    if (history === null || !(await hasRemovableTurn(history))) {
      return {
        type: 'message',
        messageType: 'info',
        content: 'No conversation to clear.',
      };
    }

    const recording = operations.getRecording();
    if (!recording) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No recording available for durable clear.',
      };
    }

    return reportHistoryMutation(
      'clear',
      context.signal,
      recording,
      async () => {
        await operations.clearHistory({
          signal: context.signal,
          publish: () => {
            context.ui.updateHistoryTokenCount(0);
            context.ui.clear();
          },
        });
      },
    );
  };
}

async function restoreHistory(
  operations: ChatRecordingOperations,
  turns: number,
  context: CommandContext,
): Promise<SlashCommandActionReturn | void> {
  context.signal.throwIfAborted();
  const currentHistory = operations.getChatHistory();
  if (currentHistory === null) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No chat history available to restore.',
    };
  }

  const turnsToRestore = Math.abs(turns);

  if (turnsToRestore < 1) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Number of turns to restore must be greater than 0.',
    };
  }

  const recording = operations.getRecording();
  if (!recording) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No recording available for durable restore.',
    };
  }

  return reportHistoryMutation(
    'restore',
    context.signal,
    recording,
    async () => {
      const result = await operations.restoreTurns(turnsToRestore, {
        signal: context.signal,
        publish: () => context.ui.clear(),
      });
      if (result.itemsRemoved === 0) {
        return {
          type: 'message',
          messageType: 'info',
          content:
            'Not enough history to restore the requested number of turns.',
        };
      }
      return undefined;
    },
  );
}

function createRestoreAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context, args): Promise<SlashCommandActionReturn | void> => {
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

    return restoreHistory(operations, -turns, context);
  };
}

function createNameAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context, args): Promise<SlashCommandActionReturn> => {
    const name = args.trim();
    if (!name) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Missing name. Usage: /chat name <name>',
      };
    }

    const recording = operations.getRecording();
    const projectHash = operations.getProjectHash();
    if (!recording || projectHash === null) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No active recording to name.',
      };
    }

    try {
      await operations.nameSession(name, context.overwriteConfirmed === true);
      return {
        type: 'message',
        messageType: 'info',
        content: `Session named: ${name}`,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      if (isCollision(context, detail)) {
        return overwriteConfirmation(context, name, `/chat name ${name}`);
      }
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to name session: ${detail}`,
      };
    }
  };
}

async function describeHistoryEntries(
  operations: ChatRecordingOperations,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const lines: string[] = [];
  try {
    const history = operations.getChatHistory();
    lines.push(`Chat initialized: ${history !== null}`);
    let count = 0;
    if (history !== null) for await (const _row of history) count++;
    lines.push(
      history === null
        ? 'History entries: 0 (chat not initialized)'
        : `History entries: ${count}`,
    );
  } catch {
    signal?.throwIfAborted();
    lines.push('Chat initialized: true', 'History entries: unavailable');
  }
  return lines;
}

function describeModel(operations: ChatRecordingOperations): string {
  try {
    const model = operations.getModel();
    return model === null
      ? 'Current model: unavailable (config not initialized)'
      : `Current model: ${model}`;
  } catch {
    return 'Current model: unavailable';
  }
}

function createDebugAction(
  operations: ChatRecordingOperations,
): NonNullable<SlashCommand['action']> {
  return async (context): Promise<SlashCommandActionReturn> => {
    const debugInfo = [
      ...(await describeHistoryEntries(operations, context.signal)),
      describeModel(operations),
    ];

    const recording = operations.getRecording();
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
  };
}

export function createChatCommand(
  operations: ChatRecordingOperations,
  readFuzzyFiltering: () => boolean,
): SlashCommand {
  return composeChatCommand(
    {
      list: createListAction(operations),
      save: createSaveAction(operations),
      resume: createResumeAction(),
      delete: createDeleteAction(operations),
      rename: createRenameAction(operations),
      clear: createClearAction(operations),
      restore: createRestoreAction(operations),
      name: createNameAction(operations),
      debug: createDebugAction(operations),
    },
    createChatTagSchema(operations, readFuzzyFiltering),
  );
}
