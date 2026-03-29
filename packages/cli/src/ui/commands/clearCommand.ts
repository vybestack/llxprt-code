/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type GeminiClient,
  uiTelemetryService,
  triggerSessionEndHook,
  triggerSessionStartHook,
  SessionEndReason,
  SessionStartSource,
} from '@vybestack/llxprt-code-core';
import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
} from './types.js';
import { getCliRuntimeServices } from '../../runtime/runtimeSettings.js';

function resolveForegroundGeminiClient(
  context: CommandContext,
): GeminiClient | null {
  if (context.services.config != null) {
    return context.services.config.getGeminiClient();
  }

  try {
    return getCliRuntimeServices().config.getGeminiClient();
  } catch {
    return null;
  }
}

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'clear the screen and conversation history',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args) => {
    const geminiClient = resolveForegroundGeminiClient(context);

    if (geminiClient != null) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');

      // Trigger SessionEnd hook before clearing (fail-open)
      if (context.services.config != null) {
        try {
          await triggerSessionEndHook(
            context.services.config,
            SessionEndReason.Clear,
          );
        } catch {
          // Hooks are fail-open - continue even if hook fails
        }
      }

      await geminiClient.resetChat();

      // Trigger SessionStart hook after clearing (fail-open)
      if (context.services.config != null) {
        try {
          const sessionStartOutput = await triggerSessionStartHook(
            context.services.config,
            SessionStartSource.Clear,
          );

          // Display system message if provided
          if (sessionStartOutput?.systemMessage) {
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
        } catch {
          // Hooks are fail-open - continue even if hook fails
        }
      }
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    uiTelemetryService.setLastPromptTokenCount(0);
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
