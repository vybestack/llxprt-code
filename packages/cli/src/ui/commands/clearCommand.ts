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
      await geminiClient.resetChat();
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    uiTelemetryService.setLastPromptTokenCount(0);
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
