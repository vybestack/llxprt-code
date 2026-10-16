/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import { bindCommandOwnerResume } from '../ui/hooks/commandOwnerResumeHost.js';
import { importOwnerSession } from '../ui/utils/ownerSessionUi.js';
import { resumeOwnerSession } from '../ui/utils/resumeOwnerSession.js';
import type { CliUiRuntime } from '../ui/cliUiRuntime.js';
import { vi } from 'bun:test';
import { CommandKind, type SlashCommand } from '../ui/commands/types.js';
import { bindCommandHistoryLoader } from '../ui/hooks/commandHistoryLoaderHost.js';
import { resolveEmojiFilterMode } from '../ui/utils/iContentToHistoryItems.js';

export function bindFixtureHistoryLoader(context: CommandOwnerFixture) {
  const agent = context.services.agent;
  const config = context.services.config;
  return bindCommandHistoryLoader(
    async (history) => {
      if (!agent) throw new Error('Missing fixture agent');
      await agent.setHistory(history);
    },
    () => resolveEmojiFilterMode(config),
    context.ui.clear,
    context.ui.addItem,
  );
}

export function createCommands(
  action: SlashCommand['action'],
): readonly SlashCommand[] {
  return [
    {
      name: 'help',
      description: 'Show help',
      kind: CommandKind.BUILT_IN,
      action:
        action ??
        vi.fn(() => ({
          type: 'message' as const,
          messageType: 'info' as const,
          content: 'ok',
        })),
    },
  ];
}

export function bindFixtureOwnerResume(
  context: CommandOwnerFixture,
  config: CliUiRuntime | null,
) {
  const agent = context.services.agent;
  const loadHistory = context.ui.loadHistory;
  return bindCommandOwnerResume((action) => {
    if (agent === null) throw new Error('Session agent is unavailable');
    const mode = resolveEmojiFilterMode(config);
    return action.sessionPackage === undefined
      ? resumeOwnerSession(
          agent.session.resume.bind(agent.session),
          action.sessionRef,
          mode,
          agent.session.listBrowserTargetsDetailed.bind(agent.session),
        )
      : importOwnerSession(
          agent.session.importSession.bind(agent.session),
          action.sessionPackage.packageDirectory,
          mode,
          agent.session.getHistory.bind(agent.session),
        );
  }, loadHistory);
}
