/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { formatDuration } from '../utils/formatters.js';
import { CommandKind, type SlashCommand } from './types.js';

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
    const { metrics } = context.session.stats;
    const totals = Object.values(metrics.models).reduce(
      (sum, model) => ({
        totalInputTokens: sum.totalInputTokens + model.tokens.prompt,
        totalOutputTokens: sum.totalOutputTokens + model.tokens.candidates,
        totalThoughtsTokens: sum.totalThoughtsTokens + model.tokens.thoughts,
        totalToolTokens: sum.totalToolTokens + model.tokens.tool,
        totalApiRequests: sum.totalApiRequests + model.api.totalRequests,
      }),
      {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalThoughtsTokens: 0,
        totalToolTokens: 0,
        totalApiRequests: 0,
      },
    );
    const finalSnapshot = {
      ...totals,
      completeTokensPerMinute: metrics.timing.completeTokensPerMinute,
      totalToolCalls: metrics.tools.totalCalls,
    };
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
