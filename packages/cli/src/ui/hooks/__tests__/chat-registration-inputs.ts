import { checkpointBindings } from '../../../__tests__/recording-checkpoint-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { Agent } from '@vybestack/llxprt-code-agents';
import type { ChatOwnerOperations } from '../../commands/chatOwnerCommand.js';
import type { ChatRecordingOperations } from '../../commands/chatCommand.js';
export function ownerOperations(owner: Agent): ChatOwnerOperations {
  return {
    listCheckpoints: () => owner.session.listCheckpoints(),
    createCheckpoint: (name, options) =>
      owner.session.createCheckpoint(name, options),
    resume: (tag) => owner.session.resume(tag),
    deleteCheckpoint: (id) => owner.session.deleteCheckpoint(id),
    renameCheckpoint: (id, name, options) =>
      owner.session.renameCheckpoint(id, name, options),
    getHistory: () => owner.session.getHistory(),
    clearHistory: () => owner.session.clearHistory(),
    restoreTurns: (turns) => owner.session.restoreTurns(turns),
    nameCurrentSession: (name, options) =>
      owner.session.nameCurrentSession(name, options),
    getRecordingPath: () => owner.session.getRecording().path,
    getModel: () => owner.getModel(),
    getEmojiFilterMode: () => 'auto',
  };
}

export function rawOperations(owner: Agent): ChatRecordingOperations {
  const [
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
  ] = checkpointBindings(
    () => null,
    () => null,
    () => null,
    () => undefined,
  );
  return {
    getRecording: () => null,
    getProjectHash: () => null,
    getChatsDir: () => null,
    listTargets,
    saveCheckpoint,
    deleteCheckpoint,
    renameCheckpoint,
    nameSession,
    getChatHistory: () => null,
    replaceChatHistory: async (history) => {
      await owner.session.replaceHistory(history);
    },
    getModel: () => owner.getModel(),
  };
}
