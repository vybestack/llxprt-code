import type { SlashCommand } from '../ui/commands/types.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  AgentClientContract,
  IContent,
  SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import {
  clearClientHistory,
  restoreClientTurns,
} from '../../../agents/src/api/control/sessionHistoryClear.js';
import { createChatCommand } from '../ui/commands/chatCommand.js';
import type { ChatRecordingOperations } from '../ui/commands/chatCommand.js';
import { checkpointBindings } from './recording-checkpoint-fixture.js';

export function rawChatCommand(
  readRecording: () => SessionRecordingPort | null,
  readHistory: () => AsyncIterable<IContent> | null,
  readModel: () => string | null,
  clearHistory: ChatRecordingOperations['clearHistory'] = async () => {
    throw new Error('No history mutation owner');
  },
  restoreTurns: ChatRecordingOperations['restoreTurns'] = async () => {
    throw new Error('No history mutation owner');
  },
): SlashCommand {
  const [
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
  ] = checkpointBindings(
    readRecording,
    () => null,
    () => null,
    () => undefined,
  );
  return createChatCommand(
    {
      getRecording: readRecording,
      getProjectHash: () => readRecording()?.getProjectHash() ?? null,
      getChatsDir: () => readRecording()?.getChatsDir() ?? null,
      listTargets,
      saveCheckpoint,
      deleteCheckpoint,
      renameCheckpoint,
      nameSession,
      getChatHistory: readHistory,
      clearHistory,
      restoreTurns,
      getModel: readModel,
    },
    () => true,
  );
}

export function rawClientChatCommand(
  client: AgentClientContract,
  readRecording: () => SessionRecordingPort | null,
  readModel: () => string | null,
): SlashCommand {
  return rawChatCommand(
    readRecording,
    () => (client.hasChatInitialized() ? client.streamHistory() : null),
    readModel,
    (options) => clearClientHistory(client, requireMediaStore(client), options),
    async (turns, options) => ({
      itemsRemoved: await restoreClientTurns(
        client,
        requireMediaStore(client),
        turns,
        options,
      ),
    }),
  );
}
