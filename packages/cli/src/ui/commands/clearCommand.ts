/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { GeminiClient, uiTelemetryService } from '@vybestack/llxprt-code-core';
import { CommandKind, SlashCommand, type CommandContext } from './types.js';
import { getCliRuntimeServices } from '../../runtime/runtimeSettings.js';

function resolveForegroundGeminiClient(
  context: CommandContext,
): GeminiClient | null {
  if (context.services.config) {
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
  action: async (context, _args) => {
    const geminiClient = resolveForegroundGeminiClient(context);

    if (geminiClient) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');
      // If resetChat fails, the exception will propagate and halt the command,
      // which is the correct behavior to signal a failure to the user.
      await geminiClient.resetChat();
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    // Reset both telemetry token count and session history token count
    uiTelemetryService.resetLastPromptTokenCount();
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
