/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ChatOwnerOperations } from './chatOwnerCommand.js';
import type { ChatRecordingOperations } from './chatCommand.js';

export function bindChatOwnerOperations(
  listCheckpoints: ChatOwnerOperations['listCheckpoints'],
  createCheckpoint: ChatOwnerOperations['createCheckpoint'],
  resume: ChatOwnerOperations['resume'],
  deleteCheckpoint: ChatOwnerOperations['deleteCheckpoint'],
  renameCheckpoint: ChatOwnerOperations['renameCheckpoint'],
  getHistory: ChatOwnerOperations['getHistory'],
  clearHistory: ChatOwnerOperations['clearHistory'],
  restoreTurns: ChatOwnerOperations['restoreTurns'],
  nameCurrentSession: ChatOwnerOperations['nameCurrentSession'],
  getRecordingPath: ChatOwnerOperations['getRecordingPath'],
  getModel: ChatOwnerOperations['getModel'],
  getEmojiFilterMode: ChatOwnerOperations['getEmojiFilterMode'],
): ChatOwnerOperations {
  return {
    listCheckpoints,
    createCheckpoint,
    resume,
    deleteCheckpoint,
    renameCheckpoint,
    getHistory,
    clearHistory,
    restoreTurns,
    nameCurrentSession,
    getRecordingPath,
    getModel,
    getEmojiFilterMode,
  };
}

export function bindChatRecordingOperations(
  getRecording: ChatRecordingOperations['getRecording'],
  readProjectHash: ChatRecordingOperations['getProjectHash'],
  readChatsDir: ChatRecordingOperations['getChatsDir'],
  getMediaStore: ChatRecordingOperations['getMediaStore'],
  getChatHistory: ChatRecordingOperations['getChatHistory'],
  replaceChatHistory: ChatRecordingOperations['replaceChatHistory'],
  getModel: ChatRecordingOperations['getModel'],
): ChatRecordingOperations {
  return {
    getRecording,
    getProjectHash: () => getRecording()?.getProjectHash() ?? readProjectHash(),
    getChatsDir: () => getRecording()?.getChatsDir() ?? readChatsDir(),
    getMediaStore,
    getChatHistory,
    replaceChatHistory,
    getModel,
  };
}
