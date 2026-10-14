/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getProjectHash,
  type RecordingIntegration,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import { resolveEmojiFilterMode } from '../utils/iContentToHistoryItems.js';
import type { ChatOwnerOperations } from './chatOwnerCommand.js';
import type { ChatRecordingOperations } from './chatCommand.js';

/**
 * Binds the owner-backed /chat operations to the Agent that registers the
 * command. Each operation fails visibly when no Agent is available.
 */
export function bindChatOwnerOperations(
  agent: Agent | null,
  config: CliUiRuntime | null,
): ChatOwnerOperations {
  const owner = (): Agent => {
    if (agent === null) throw new Error('No session owner available');
    return agent;
  };
  return {
    listCheckpoints: () => owner().session.listCheckpoints(),
    createCheckpoint: (name, options) =>
      owner().session.createCheckpoint(name, options),
    resume: (tag) => owner().session.resume(tag),
    deleteCheckpoint: (checkpointId) =>
      owner().session.deleteCheckpoint(checkpointId),
    renameCheckpoint: (checkpointId, name, options) =>
      owner().session.renameCheckpoint(checkpointId, name, options),
    getHistory: () => owner().session.getHistory(),
    clearHistory: () => owner().session.clearHistory(),
    restoreTurns: (turns) => owner().session.restoreTurns(turns),
    nameCurrentSession: (name, options) =>
      owner().session.nameCurrentSession(name, options),
    getRecordingPath: () => owner().session.getRecording().path,
    getModel: () => owner().getModel(),
    getEmojiFilterMode: () => resolveEmojiFilterMode(config),
  };
}

export interface ChatRecordingHost {
  readonly agent: Agent | null;
  readonly config: CliUiRuntime | null;
  readonly recordingIntegration: RecordingIntegration | undefined;
  readonly recordingSwapCallbacks: RecordingSwapCallbacks | undefined;
}

/** Binds the recording-native /chat operations to one raw interactive session. */
export function bindChatRecordingOperations(
  host: ChatRecordingHost,
): ChatRecordingOperations {
  const { agent, config } = host;
  const getRecording = (): SessionRecordingService | null =>
    host.recordingSwapCallbacks?.getCurrentRecording() ??
    host.recordingIntegration?.getRecordingService() ??
    null;
  return {
    getRecording,
    getProjectHash: () => {
      const recording = getRecording();
      if (recording !== null) return recording.getProjectHash();
      return config ? getProjectHash(config.getProjectRoot()) : null;
    },
    getChatsDir: () =>
      getRecording()?.getChatsDir() ?? config?.projectChatsDir ?? null,
    getMediaStore: () => agent?.agentClient.mediaStore,
    getChatHistory: () => {
      const client = agent?.agentClient;
      return client?.hasChatInitialized() === true
        ? client.getChat().getHistory()
        : null;
    },
    replaceChatHistory: async (history) => {
      if (agent === null) throw new Error('Session agent is unavailable');
      await agent.agentClient.getChat().setHistory(history);
    },
    getModel: () => (config ? config.getModel() : null),
  };
}
