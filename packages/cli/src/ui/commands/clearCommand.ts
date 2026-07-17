/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  triggerSessionEndHook,
  triggerSessionStartHook,
  SessionEndReason,
  SessionStartSource,
  type SessionStartHookOutput,
} from '@vybestack/llxprt-code-core';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';
import { CommandKind, type SlashCommand } from './types.js';
import type { HookSkillState } from '../cliUiRuntime.js';

type SessionHookRuntime = Pick<
  HookSkillState,
  'getEnableHooks' | 'getHookSystem'
>;

/**
 * Helper to trigger session end hook with fail-open behavior.
 */
async function triggerSessionEndHookSafe(
  runtime: SessionHookRuntime | null | undefined,
  reason: SessionEndReason,
): Promise<void> {
  if (!runtime) return;
  try {
    await triggerSessionEndHook(runtime, reason);
  } catch {
    // Hooks are fail-open - continue even if hook fails
  }
}

/**
 * Helper to trigger session start hook with fail-open behavior.
 */
async function triggerSessionStartHookSafe(
  runtime: SessionHookRuntime | null | undefined,
  source: SessionStartSource,
): Promise<SessionStartHookOutput | undefined> {
  if (!runtime) return undefined;
  try {
    return await triggerSessionStartHook(runtime, source);
  } catch {
    // Hooks are fail-open - continue even if hook fails
    return undefined;
  }
}

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
      await triggerSessionEndHookSafe(
        context.services.config,
        SessionEndReason.Clear,
      );

      await agent.resetChat();

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

    uiTelemetryService.reset();
    context.ui.updateHistoryTokenCount(0);
    context.ui.clear();
  },
};
