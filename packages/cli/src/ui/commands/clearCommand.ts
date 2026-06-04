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
  type Config,
  type SessionStartHookOutput,
} from '@vybestack/llxprt-code-core';
import {
  CommandKind,
  type SlashCommand,
  type CommandContext,
} from './types.js';
import { getCliRuntimeServices } from '../../runtime/runtimeSettings.js';

/**
 * Helper to trigger session end hook with fail-open behavior.
 */
async function triggerSessionEndHookSafe(
  config: Config | null | undefined,
  reason: SessionEndReason,
): Promise<void> {
  if (!config) return;
  try {
    await triggerSessionEndHook(config, reason);
  } catch {
    // Hooks are fail-open - continue even if hook fails
  }
}

/**
 * Helper to trigger session start hook with fail-open behavior.
 */
async function triggerSessionStartHookSafe(
  config: Config | null | undefined,
  source: SessionStartSource,
): Promise<SessionStartHookOutput | undefined> {
  if (!config) return undefined;
  try {
    return await triggerSessionStartHook(config, source);
  } catch {
    // Hooks are fail-open - continue even if hook fails
    return undefined;
  }
}

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
  autoExecute: true,
  action: async (context, _args) => {
    const geminiClient = resolveForegroundGeminiClient(context);

    if (geminiClient) {
      context.ui.setDebugMessage('Clearing terminal and resetting chat.');

      // Trigger SessionEnd hook before clearing (fail-open)
      await triggerSessionEndHookSafe(
        context.services.config,
        SessionEndReason.Clear,
      );

      await geminiClient.resetChat();

      // Trigger SessionStart hook after clearing (fail-open)
      const sessionStartOutput = await triggerSessionStartHookSafe(
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
    } else {
      context.ui.setDebugMessage('Clearing terminal.');
    }

    uiTelemetryService.setLastPromptTokenCount(0);
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
