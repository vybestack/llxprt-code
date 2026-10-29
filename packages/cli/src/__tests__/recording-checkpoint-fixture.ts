/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { dirname } from 'node:path';
import {
  SessionDiscovery,
  type LocalMediaStore,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { createCheckpointService } from '@vybestack/llxprt-code-core';
import type { ChatRecordingOperations } from '../ui/commands/chatCommand.js';

type CheckpointBindings = readonly [
  ChatRecordingOperations['listTargets'],
  ChatRecordingOperations['saveCheckpoint'],
  ChatRecordingOperations['deleteCheckpoint'],
  ChatRecordingOperations['renameCheckpoint'],
  ChatRecordingOperations['nameSession'],
];

export function checkpointBindings(
  readRecording: () => SessionRecordingPort | null,
  readHash: () => string | null,
  readDirectory: () => string | null,
  readMedia: () => LocalMediaStore | undefined,
): CheckpointBindings {
  const recording = (): SessionRecordingPort => {
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
      await createCheckpointService().createCheckpoint(
        recording(),
        hash(),
        name,
        overwrite,
      );
    },
    async (target) => {
      const service = createCheckpointService();
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
      const service = createCheckpointService();
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
      await createCheckpointService().setSessionName(
        recording(),
        hash(),
        name,
        overwrite,
      );
    },
  ];
}
