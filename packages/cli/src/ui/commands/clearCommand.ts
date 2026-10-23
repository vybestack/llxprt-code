/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { AgentBusyError } from '@vybestack/llxprt-code-agents';
import { CommandKind, type SlashCommand } from './types.js';
export interface ClearSessionOperations {
  readonly endSession: () => Promise<void>;
  readonly startNewSession: () => Promise<void>;
  readonly startSession: () => Promise<{ readonly systemMessage?: string }>;
}
export function createClearCommand(
  session: ClearSessionOperations | null,
  setDebugMessage: (message: string) => void,
  addItem: UseHistoryManagerReturn['addItem'],
  updateHistoryTokenCount: (count: number) => void,
  clear: () => void,
): SlashCommand {
  return {
    name: 'clear',
    description: 'clear the screen and conversation history',
    kind: CommandKind.BUILT_IN,
    autoExecute: true,
    action: async () => {
      if (session) {
        setDebugMessage('Clearing terminal and resetting chat.');

        // Trigger SessionEnd hook before clearing (fail-open)
        await session.endSession();

        try {
          await session.startNewSession();
        } catch (error) {
          if (!(error instanceof AgentBusyError)) throw error;
          return {
            type: 'message',
            messageType: 'error',
            content: error.message,
          };
        }

        // Trigger SessionStart hook after clearing (fail-open)
        const sessionStartOutput = await session.startSession();

        // Display system message if provided
        if (sessionStartOutput.systemMessage) {
          addItem(
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
        setDebugMessage('Clearing terminal.');
      }

      updateHistoryTokenCount(0);
      clear();
      return undefined;
    },
  };
}
