/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { join } from 'node:path';
import {
  getProjectHash,
  importSessionMediaPackage,
} from '@vybestack/llxprt-code-core';
import type { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import type { CliUiRuntime } from '../cliUiRuntime.js';
import type { CliSessionPersistencePort } from '../../cliSessionPersistence.js';
import type { PerformResumeActionReturn } from '../commands/types.js';
import type {
  performResume,
  PerformResumeResult,
  RecordingSwapCallbacks,
  ResumeContext,
} from '../../services/performResume.js';

type ResumeSessionReads = Pick<
  CliUiRuntime,
  | 'projectTempDir'
  | 'getProjectRoot'
  | 'getSessionId'
  | 'getProvider'
  | 'getModel'
  | 'directories'
  | 'getSessionRecordingQueueByteLimit'
  | 'adoptSessionId'
>;

export function bindCommandRawResume(
  config: ResumeSessionReads | null,
  persistence: CliSessionPersistencePort | undefined,
  readHistoryService: () => ResumeContext['historyService'],
  callbacks: RecordingSwapCallbacks | undefined,
  logger: DebugLogger,
  resume: typeof performResume,
):
  | ((action: PerformResumeActionReturn) => Promise<PerformResumeResult>)
  | null {
  if (config === null || callbacks === undefined) return null;
  return (action) => {
    if (!persistence) throw new Error('CLI session persistence is unavailable');
    const mediaStore = persistence.mediaStore;
    if (!mediaStore) throw new Error('CLI session media store is unavailable');
    const context: ResumeContext = {
      chatsDir: join(config.projectTempDir, 'chats'),
      projectHash: getProjectHash(config.getProjectRoot()),
      currentSessionId: config.getSessionId(),
      currentProvider: config.getProvider() ?? 'unknown',
      currentModel: config.getModel(),
      workspaceDirs: [...config.directories()],
      mediaStore,
      maxQueueBytes: config.getSessionRecordingQueueByteLimit(),
      persistenceFactory: (sessionId) => persistence.forRecording(sessionId),
      recordingCallbacks: callbacks,
      historyService: readHistoryService(),
      adoptSessionId: (sessionId) => config.adoptSessionId(sessionId),
      logger,
    };
    return (async () =>
      action.sessionPackage === undefined
        ? resume(action.sessionRef, context)
        : importSessionMediaPackage(
            action.sessionPackage,
            context.chatsDir,
            context.projectHash,
            mediaStore,
            async (imported) => {
              const result = await resume(imported.sessionId, context);
              if (!result.ok) throw new Error(result.error);
              return result;
            },
          ))();
  };
}
