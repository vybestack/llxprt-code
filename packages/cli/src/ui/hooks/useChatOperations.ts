import { getProjectHash } from '@vybestack/llxprt-code-core';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { useMemo } from 'react';
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ChatOwnerOperations } from '../commands/chatOwnerCommand.js';
import type { ChatRecordingOperations } from '../commands/chatCommand.js';
import {
  bindChatOwnerOperations,
  bindChatRecordingOperations,
} from '../commands/chatCommandHost.js';

type CheckpointOwner = Pick<
  Agent['session'],
  | 'listCheckpoints'
  | 'createCheckpoint'
  | 'resume'
  | 'deleteCheckpoint'
  | 'renameCheckpoint'
  | 'getHistory'
  | 'clearHistory'
  | 'restoreTurns'
  | 'nameCurrentSession'
  | 'getRecording'
>;
export function useOwnedChatOperations(
  session: CheckpointOwner | undefined,
  getModel: ChatOwnerOperations['getModel'],
  getEmojiFilterMode: ChatOwnerOperations['getEmojiFilterMode'],
): ChatOwnerOperations {
  return useMemo(
    () =>
      bindChatOwnerOperations(
        session?.listCheckpoints.bind(session) ?? missingChatOwner,
        session?.createCheckpoint.bind(session) ?? missingChatOwner,
        session?.resume.bind(session) ?? missingChatOwner,
        session?.deleteCheckpoint.bind(session) ?? missingChatOwner,
        session?.renameCheckpoint.bind(session) ?? missingChatOwner,
        session?.getHistory.bind(session) ?? missingChatOwner,
        session?.clearHistory.bind(session) ?? missingChatOwner,
        session?.restoreTurns.bind(session) ?? missingChatOwner,
        session?.nameCurrentSession.bind(session) ?? missingChatOwner,
        () => {
          if (!session) return missingChatOwner();
          return session.getRecording().path;
        },
        getModel,
        getEmojiFilterMode,
      ),
    [session, getModel, getEmojiFilterMode],
  );
}
function missingChatOwner(): never {
  throw new Error('No session owner available');
}

export function useRawChatOperations(
  getRecording: ChatRecordingOperations['getRecording'],
  getProjectHash: ChatRecordingOperations['getProjectHash'],
  getChatsDir: ChatRecordingOperations['getChatsDir'],
  getMediaStore: ChatRecordingOperations['getMediaStore'],
  getChatHistory: ChatRecordingOperations['getChatHistory'],
  replaceChatHistory: ChatRecordingOperations['replaceChatHistory'],
  getModel: ChatRecordingOperations['getModel'],
): ChatRecordingOperations {
  return useMemo(
    () =>
      bindChatRecordingOperations(
        getRecording,
        getProjectHash,
        getChatsDir,
        getMediaStore,
        getChatHistory,
        replaceChatHistory,
        getModel,
      ),
    [
      getRecording,
      getProjectHash,
      getChatsDir,
      getMediaStore,
      getChatHistory,
      replaceChatHistory,
      getModel,
    ],
  );
}

export function useChatRecordingPath(
  readRecording: () => { path?: string },
): () => string | undefined {
  return useMemo(() => () => readRecording().path, [readRecording]);
}

export function useCurrentChatRecording(
  readSwapped: ChatRecordingOperations['getRecording'] | undefined,
  readInitial:
    | (() => ReturnType<ChatRecordingOperations['getRecording']> | undefined)
    | undefined,
): ChatRecordingOperations['getRecording'] {
  return useMemo(
    () => () => readSwapped?.() ?? readInitial?.() ?? null,
    [readSwapped, readInitial],
  );
}

export function useChatProjectHash(
  readRoot: () => string | null,
): () => string | null {
  return useMemo(
    () => () => {
      const root = readRoot();
      return root === null ? null : getProjectHash(root);
    },
    [readRoot],
  );
}

export function useRawChatHistory(
  client:
    | Pick<
        Agent['agentClient'],
        'hasChatInitialized' | 'getChat' | 'mediaStore'
      >
    | undefined,
) {
  return useMemo(
    () => ({
      getMediaStore: () => client?.mediaStore,
      getChatHistory: () =>
        client?.hasChatInitialized() === true
          ? client.getChat().getHistory()
          : null,
      replaceChatHistory: async (
        history: Parameters<ChatRecordingOperations['replaceChatHistory']>[0],
      ) => {
        if (!client) throw new Error('Session agent is unavailable');
        await client.getChat().setHistory(history);
      },
    }),
    [client],
  );
}
