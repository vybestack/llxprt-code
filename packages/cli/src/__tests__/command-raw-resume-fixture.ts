/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { bindCommandRawResume } from '../ui/hooks/commandRawResumeHost.js';
import { bindResumedHistoryReplay } from '../ui/hooks/commandHistoryLoaderHost.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../services/performResume.js';
import type { CliSessionPersistencePort } from '../cliSessionPersistence.js';
import type { SlashCommandHandlerDeps } from '../ui/hooks/slashCommandHandlers.js';

export function installFixtureRawResume(
  deps: SlashCommandHandlerDeps,
  persistence: CliSessionPersistencePort,
  callbacks: RecordingSwapCallbacks,
  resume: typeof performResume = performResume,
): void {
  const agent = deps.commandContext.services.agent;
  const config = deps.config;
  deps.resumeRawSession = bindCommandRawResume(
    config,
    persistence,
    () => {
      if (!agent) throw new Error('Session agent is unavailable');
      return agent.agentClient.getHistoryService();
    },
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
