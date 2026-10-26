/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  bindCommandRawResume,
  type ResumeSessionReads,
} from '../ui/hooks/commandRawResumeHost.js';
import { bindResumedHistoryReplay } from '../ui/hooks/commandHistoryLoaderHost.js';
import {
  resolveEmojiFilterMode,
  type EmojiFilterSettingsSource,
} from '../ui/utils/iContentToHistoryItems.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../services/performResume.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
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
  deps.replayResumedHistory = bindResumedHistoryReplay(
    () => resolveEmojiFilterMode(config),
    deps.commandContext.ui.clear,
    deps.commandContext.ui.addItem,
  );
}
