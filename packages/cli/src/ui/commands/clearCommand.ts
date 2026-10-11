/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
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

      try {
        await agent.session.startNewSession();
        agent.metrics.reset();
      } catch (error) {
        if (!(error instanceof AgentBusyError)) throw error;
        return {
          type: 'message',
          messageType: 'error',
          content: error.message,
        };
      }

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

    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
    return undefined;
  },
};
