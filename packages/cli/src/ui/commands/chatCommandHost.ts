import type { CliSessionPersistencePort } from '../../cliSessionPersistence.js';
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
  listTargets: ChatRecordingOperations['listTargets'],
  saveCheckpoint: ChatRecordingOperations['saveCheckpoint'],
  deleteCheckpoint: ChatRecordingOperations['deleteCheckpoint'],
  renameCheckpoint: ChatRecordingOperations['renameCheckpoint'],
  nameSession: ChatRecordingOperations['nameSession'],
  getChatHistory: ChatRecordingOperations['getChatHistory'],
  replaceChatHistory: ChatRecordingOperations['replaceChatHistory'],
  getModel: ChatRecordingOperations['getModel'],
): ChatRecordingOperations {
  return {
    getRecording,
    getProjectHash: () => getRecording()?.getProjectHash() ?? readProjectHash(),
    getChatsDir: () => getRecording()?.getChatsDir() ?? readChatsDir(),
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
    getChatHistory,
    replaceChatHistory,
    getModel,
  };
}

export function bindPersistedChatRecording(
  readPersistence: () => CliSessionPersistencePort,
  readRecording: ChatRecordingOperations['getRecording'],
  readHash: ChatRecordingOperations['getProjectHash'],
  readDirectory: ChatRecordingOperations['getChatsDir'],
  readHistory: ChatRecordingOperations['getChatHistory'],
  replaceHistory: ChatRecordingOperations['replaceChatHistory'],
  readModel: ChatRecordingOperations['getModel'],
): ChatRecordingOperations {
  const requireRecording = () => {
    const recording = readRecording();
    if (!recording) throw new Error('No recording available');
    return recording;
  };
  return bindChatRecordingOperations(
    readRecording,
    readHash,
    readDirectory,
    () => readPersistence().listBrowserTargetsDetailed(),
    (name, overwrite) =>
      readPersistence().createCheckpoint(requireRecording(), name, overwrite),
    (target) => readPersistence().deleteBrowserTarget(target, readRecording()),
    (target, name, overwrite) =>
      readPersistence().renameCheckpoint(
        readRecording(),
        target,
        name,
        overwrite,
      ),
    (name, overwrite) =>
      readPersistence().nameSession(requireRecording(), name, overwrite),
    readHistory,
    replaceHistory,
    readModel,
  );
}
