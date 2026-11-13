/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  bindCommandRawResume,
  type ResumeSessionReads,
} from '../ui/hooks/commandRawResumeHost.js';
import { bindPublishedHistoryRefresh } from '../ui/hooks/commandHistoryLoaderHost.js';
import { type EmojiFilterSettingsSource } from '../ui/utils/iContentToHistoryItems.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../services/performResume.js';
import {
  CliSessionPersistence,
  type CliSessionPersistencePort,
} from '../cliSessionPersistence.js';
import type { Config, LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { CommandHandlerFixture } from '../ui/hooks/slash-command-handler-deps-test-helpers.js';

/** Reads the raw recording resume path and the emoji filter mode need. */
export type RawResumeRuntime = ResumeSessionReads & EmojiFilterSettingsSource;

export function installFixtureRawResume(
  deps: CommandHandlerFixture,
  config: RawResumeRuntime,
  persistence: Pick<CliSessionPersistencePort, 'resumeRecording'>,
  callbacks: RecordingSwapCallbacks,
  resume: typeof performResume = performResume,
): void {
  const agent = deps.commandContext.services.agent;
  deps.resumeRawSession = bindCommandRawResume(
    config,
    persistence,
    agent?.session,
    callbacks,
    deps.slashCommandLogger,
    resume,
  );
  deps.refreshResumedHistory = bindPublishedHistoryRefresh(() => {});
}

export function createRawResumePersistence(
  config: Config,
  mediaStore: LocalMediaStore,
  maxQueueBytes?: number,
): CliSessionPersistence {
  return new CliSessionPersistence(
    { projectRoot: config.getProjectRoot(), chatsDir: config.projectChatsDir },
    {
      scratchRoots: config.scratchRoots,
      namedWriters: config.namedWriters,
      mediaStore,
      maxQueueBytes,
    },
  );
}
