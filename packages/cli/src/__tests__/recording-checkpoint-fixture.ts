/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { dirname } from 'node:path';
import {
  CheckpointService,
  SessionDiscovery,
  type LocalMediaStore,
  type SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { ChatRecordingOperations } from '../ui/commands/chatCommand.js';

type CheckpointBindings = readonly [
  ChatRecordingOperations['listTargets'],
  ChatRecordingOperations['saveCheckpoint'],
  ChatRecordingOperations['deleteCheckpoint'],
  ChatRecordingOperations['renameCheckpoint'],
  ChatRecordingOperations['nameSession'],
];

export function checkpointBindings(
  readRecording: () => SessionRecordingService | null,
  readHash: () => string | null,
  readDirectory: () => string | null,
  readMedia: () => LocalMediaStore | undefined,
): CheckpointBindings {
  const recording = (): SessionRecordingService => {
    const current = readRecording();
    if (!current) throw new Error('No recording available');
    return current;
  };
  const hash = (): string =>
    readRecording()?.getProjectHash() ?? readHash() ?? '';
  const directory = (): string =>
    readRecording()?.getChatsDir() ?? readDirectory() ?? '';
  return [
    () =>
      SessionDiscovery.listContinueTargetsDetailed(
        directory(),
        hash(),
        readMedia(),
      ),
    async (name, overwrite) => {
      await new CheckpointService(readMedia()).createCheckpoint(
        recording(),
        hash(),
        name,
        overwrite,
      );
    },
    async (target) => {
      const service = new CheckpointService(readMedia());
      const current = readRecording();
      if (current?.getSessionId() === target.source.sessionId)
        await service.deleteCheckpoint(
          current,
          target.source.projectHash,
          target.checkpointId,
        );
      else
        await service.deleteCheckpointClosed(
          target.source.filePath,
          target.source.projectHash,
          directory() || dirname(target.source.filePath),
          target.source.sessionId,
          target.checkpointId,
        );
    },
    async (target, name, overwrite) => {
      const service = new CheckpointService(readMedia());
      const current = readRecording();
      if (current?.getSessionId() === target.source.sessionId)
        await service.renameCheckpoint(
          current,
          hash(),
          target.checkpointId,
          name,
          overwrite,
        );
      else
        await service.renameCheckpointClosed(
          target.source.filePath,
          hash(),
          directory() || dirname(target.source.filePath),
          target.source.sessionId,
          target.checkpointId,
          name,
          overwrite,
        );
    },
    async (name, overwrite) => {
      await new CheckpointService(readMedia()).setSessionName(
        recording(),
        hash(),
        name,
        overwrite,
      );
    },
  ];
}
