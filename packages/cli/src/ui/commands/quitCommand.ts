/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatDuration } from '../utils/formatters.js';
import { CommandKind, type SlashCommand } from './types.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-telemetry';

export const quitCommand: SlashCommand = {
  name: 'quit',
  altNames: ['exit'],
  description: 'exit the cli',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: (context) => {
    const now = Date.now();
    const { sessionStartTime } = context.session.stats;
    const wallDuration = now - sessionStartTime.getTime();

    // getSessionSnapshot() returns a fresh plain object from internal
    // aggregator state on each call, so this is already a snapshot copy.
    const finalSnapshot = uiTelemetryService.getSessionSnapshot();
    const totalTokens =
      finalSnapshot.totalInputTokens +
      finalSnapshot.totalOutputTokens +
      finalSnapshot.totalThoughtsTokens +
      finalSnapshot.totalToolTokens;

    return {
      type: 'quit',
      messages: [
        {
          type: 'user',
          text: `/quit`,
          id: now - 1,
        },
        {
          type: 'quit',
          duration: formatDuration(wallDuration),
          id: now,
          totalApiRequests: finalSnapshot.totalApiRequests,
          totalTokens,
          completeTokensPerMinute: finalSnapshot.completeTokensPerMinute,
          totalToolCalls: finalSnapshot.totalToolCalls,
        },
      ],
    };
  },
};
