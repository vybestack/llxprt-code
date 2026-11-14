/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { CommandOwnerFixture } from './mockCommandContext.js';

import { bindCommandOwnerResume } from '../ui/hooks/commandOwnerResumeHost.js';
import { importOwnerSession } from '../ui/utils/ownerSessionUi.js';
import { resumeOwnerSession } from '../ui/utils/resumeOwnerSession.js';
import type { FixtureCommandRuntime } from './slash-command-runtime-fixture.js';
import { CommandKind, type SlashCommand } from '../ui/commands/types.js';

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
        (() => ({ type: 'message', messageType: 'info', content: 'ok' })),
    },
  ];
}

export function bindFixtureOwnerResume(
  context: CommandOwnerFixture,
  _config: FixtureCommandRuntime | null,
) {
  const agent = context.services.agent;
  const refresh = context.ui.clear;
  return bindCommandOwnerResume((action) => {
    if (agent === null) throw new Error('Session agent is unavailable');
    return action.sessionPackage === undefined
      ? resumeOwnerSession(
          agent.session.resume.bind(agent.session),
          action.sessionRef,
          agent.session.listBrowserTargetsDetailed.bind(agent.session),
        )
      : importOwnerSession(
          agent.session.importSession.bind(agent.session),
          action.sessionPackage.packageDirectory,
        );
  }, refresh);
}
