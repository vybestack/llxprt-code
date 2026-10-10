/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { CommandKind, type SlashCommand } from './types.js';
export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'clear the screen and conversation history',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args) => {
    const agent = context.services.agent;

    if (agent) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');

      // Trigger SessionEnd hook before clearing (fail-open)
      await agent.hooks.triggerSessionEnd(SessionEndReason.Clear);

      await agent.resetChat({ retainInitialHistory: false });

      // Trigger SessionStart hook after clearing (fail-open)
      const sessionStartOutput = await agent.hooks.triggerSessionStart(
        SessionStartSource.Clear,
      );

      // Display system message if provided
      if (sessionStartOutput.systemMessage) {
        context.ui.addItem(
          {
            type: 'info',
            text: sessionStartOutput.systemMessage,
          },
          Date.now(),
        );
      }
      // Note: Additional context is NOT injected after clear - clear means fresh start
      // Only the system message is displayed
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    uiTelemetryService.reset();
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
