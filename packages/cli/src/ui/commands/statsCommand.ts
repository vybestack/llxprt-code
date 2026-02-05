/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 */

import { MessageType, HistoryItemStats } from '../types.js';
import { formatDuration } from '../utils/formatters.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';

export const statsCommand: SlashCommand = {
  name: 'stats',
  altNames: ['usage'],
  description:
    'check session stats. Usage: /stats [model|tools|cache|buckets|quota|lb]',
  kind: CommandKind.BUILT_IN,
  action: (context: CommandContext) => {
    const now = new Date();
    const { sessionStartTime } = context.session.stats;
    if (!sessionStartTime) {
      context.ui.addItem(
        {
          type: MessageType.ERROR,
          text: 'Session start time is unavailable, cannot calculate stats.',
        },
        Date.now(),
      );
      return;
    }
    const wallDuration = now.getTime() - sessionStartTime.getTime();

    const statsItem: HistoryItemStats = {
      type: MessageType.STATS,
      duration: formatDuration(wallDuration),
    };

    context.ui.addItem(statsItem, Date.now());
  },
  subCommands: [
    {
      name: 'model',
      description: 'Show model-specific usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        context.ui.addItem(
          {
            type: MessageType.MODEL_STATS,
          },
          Date.now(),
        );
      },
    },
    {
      name: 'tools',
      description: 'Show tool-specific usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        context.ui.addItem(
          {
            type: MessageType.TOOL_STATS,
          },
          Date.now(),
        );
      },
    },
    {
      name: 'cache',
      description: 'Show cache usage statistics (Anthropic only).',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        context.ui.addItem(
          {
            type: MessageType.CACHE_STATS,
          },
          Date.now(),
        );
      },
    },
    {
      name: 'quota',
      description:
        'Show Anthropic OAuth usage quota information for all authenticated buckets.',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext) => {
        const oauthManager = getRuntimeApi().getCliOAuthManager();

        if (!oauthManager) {
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: 'OAuth is not available or configured',
            },
            Date.now(),
          );
          return;
        }

        try {
          // Get usage info for ALL authenticated buckets
          const allUsageInfo = await oauthManager.getAllAnthropicUsageInfo();

          if (allUsageInfo.size === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No quota information available. This feature requires Anthropic OAuth authentication (not API keys).\n\nUse /auth anthropic to authenticate with OAuth.',
              },
              Date.now(),
            );
            return;
          }

          const { formatAllUsagePeriods } = await import(
            '@vybestack/llxprt-code-core'
          );

          const output: string[] = ['## Anthropic Quota Information\n'];

          // Sort buckets: 'default' first, then alphabetical
          const sortedBuckets = Array.from(allUsageInfo.keys()).sort((a, b) => {
            if (a === 'default') return -1;
            if (b === 'default') return 1;
            return a.localeCompare(b);
          });

          // Format usage for each bucket
          for (const bucket of sortedBuckets) {
            const usageInfo = allUsageInfo.get(bucket)!;
            const lines = formatAllUsagePeriods(
              usageInfo as Record<string, unknown>,
            );

            if (lines.length > 0) {
              // Only show bucket name if there are multiple buckets
              if (allUsageInfo.size > 1) {
                output.push(`### Bucket: ${bucket}\n`);
              }
              output.push(...lines);
              output.push(''); // Add spacing between buckets
            }
          }

          // Remove trailing empty line
          if (output[output.length - 1] === '') {
            output.pop();
          }

          if (output.length === 1) {
            // Only header, no actual quota data
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No quota information available from the usage endpoint.',
              },
              Date.now(),
            );
            return;
          }

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: output.join('\n'),
            },
            Date.now(),
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Failed to retrieve quota information: ${errorMessage}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'buckets',
      description: 'Show OAuth bucket usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext, _args: string) => {
        const { oauthManager } = context.services;

        if (!oauthManager) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: 'OAuth is not available or configured',
            },
            Date.now(),
          );
          return;
        }

        try {
          const tokenStore = oauthManager.getTokenStore();
          const supportedProviders = oauthManager.getSupportedProviders();
          const output: string[] = ['## OAuth Bucket Statistics\n'];
          let hasAnyBuckets = false;

          for (const provider of supportedProviders) {
            const buckets = await tokenStore.listBuckets(provider);

            if (buckets.length === 0) {
              continue;
            }

            hasAnyBuckets = true;
            output.push(`### ${provider}\n`);

            for (const bucket of buckets) {
              const stats = await tokenStore.getBucketStats(provider, bucket);

              if (stats) {
                const lastUsedStr = stats.lastUsed
                  ? new Date(stats.lastUsed).toISOString().split('T')[0]
                  : 'Never';

                output.push(`- ${bucket}:`);
                output.push(
                  `  - ${stats.requestCount} requests (${stats.percentage.toFixed(1)}%)`,
                );
                output.push(`  - Last used: ${lastUsedStr}`);
              }
            }

            output.push('');
          }

          if (!hasAnyBuckets) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No OAuth buckets available',
              },
              Date.now(),
            );
            return;
          }

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: output.join('\n'),
            },
            Date.now(),
          );
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error';
          context.ui.addItem(
            {
              type: MessageType.ERROR,
              text: `Failed to retrieve bucket statistics: ${errorMessage}`,
            },
            Date.now(),
          );
        }
      },
    },
    {
      name: 'lb',
      altNames: ['loadbalancer'],
      description: 'Show load balancer usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        context.ui.addItem(
          {
            type: MessageType.LB_STATS,
          },
          Date.now(),
        );
      },
    },
  ],
};
