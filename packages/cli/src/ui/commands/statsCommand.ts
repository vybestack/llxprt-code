/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20260214-SESSIONBROWSER.P24
 */

/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode consumer-migration.md lines 10-15
 */

import type { HistoryItemStats } from '../types.js';
import { MessageType } from '../types.js';
import { formatDuration } from '../utils/formatters.js';
import {
  type CommandContext,
  type SlashCommand,
  CommandKind,
} from './types.js';
import { getRuntimeApi } from '../contexts/RuntimeContext.js';
import { fetchAllQuotaInfo } from './statsQuota.js';
import { formatSessionSection } from './formatSessionSection.js';
import type { SessionRecordingMetadata } from '../types/SessionRecordingMetadata.js';

async function defaultSessionView(context: CommandContext): Promise<void> {
  const now = new Date();
  // Runtime stats may be incomplete before session initialization, so the
  // declared non-null type is narrowed at the boundary to reflect that
  // the value can legitimately be missing.
  const rawStartTime = context.session.stats.sessionStartTime as
    | Date
    | null
    | undefined;
  if (rawStartTime == null) {
    context.ui.addItem(
      {
        type: MessageType.ERROR,
        text: 'Session start time is unavailable, cannot calculate stats.',
      },
      Date.now(),
    );
    return;
  }
  const wallDuration = now.getTime() - rawStartTime.getTime();

  // Fetch quota information
  const runtimeApi = getRuntimeApi();
  const quotaLines = await fetchAllQuotaInfo(runtimeApi);

  const statsItem: HistoryItemStats = {
    type: MessageType.STATS,
    duration: formatDuration(wallDuration),
    quotaLines: quotaLines.length > 0 ? quotaLines : undefined,
  };

  context.ui.addItem(statsItem);

  // Session recording section (stub - result currently discarded)
  // @plan PLAN-20260214-SESSIONBROWSER.P24
  const _sessionMetadata: SessionRecordingMetadata | null = null;
  await formatSessionSection(_sessionMetadata);
}

async function quotaSubcommandAction(context: CommandContext): Promise<void> {
  const runtimeApi = getRuntimeApi();

  try {
    const quotaLines = await fetchAllQuotaInfo(runtimeApi);

    if (quotaLines.length === 0) {
      context.ui.addItem(
        {
          type: MessageType.INFO,
          text: 'No quota information available. Supported providers: Anthropic (OAuth), Codex (OAuth), Gemini (Google OAuth), Z.ai, Synthetic, Chutes, Kimi.',
        },
        Date.now(),
      );
      return;
    }

    context.ui.addItem(
      {
        type: MessageType.INFO,
        text: quotaLines.join('\n'),
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
}

function formatBucketLastUsed(stats: { lastUsed?: number }): string {
  if (
    stats.lastUsed != null &&
    stats.lastUsed !== 0 &&
    !Number.isNaN(stats.lastUsed)
  ) {
    return new Date(stats.lastUsed).toISOString().split('T')[0];
  }
  return 'Never';
}

function formatBucketLines(
  bucket: string,
  stats: {
    requestCount: number;
    percentage: number;
    lastUsed?: number;
  },
): string[] {
  return [
    `- ${bucket}:`,
    `  - ${stats.requestCount} requests (${stats.percentage.toFixed(1)}%)`,
    `  - Last used: ${formatBucketLastUsed(stats)}`,
  ];
}

async function collectProviderBuckets(
  tokenStore: NonNullable<
    NonNullable<CommandContext['services']['oauthManager']>['getTokenStore']
  > extends () => infer T
    ? T
    : never,
  provider: string,
  output: string[],
): Promise<void> {
  const buckets = await tokenStore.listBuckets(provider);
  if (buckets.length === 0) {
    return;
  }

  output.push(`### ${provider}\n`);

  for (const bucket of buckets) {
    const stats = await tokenStore.getBucketStats(provider, bucket);
    if (stats) {
      output.push(...formatBucketLines(bucket, stats));
    }
  }

  output.push('');
}

async function bucketsSubcommandAction(
  context: CommandContext,
  _args: string,
): Promise<void> {
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
      const beforeLength = output.length;
      await collectProviderBuckets(tokenStore, provider, output);
      if (output.length > beforeLength) {
        hasAnyBuckets = true;
      }
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
}

export const statsCommand: SlashCommand = {
  name: 'stats',
  altNames: ['usage'],
  description:
    'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    await defaultSessionView(context);
  },
  subCommands: [
    {
      name: 'session',
      description: 'Show session-specific usage statistics.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
      action: async (context: CommandContext) => {
        await defaultSessionView(context);
      },
    },
    {
      name: 'model',
      description: 'Show model-specific usage statistics.',
      kind: CommandKind.BUILT_IN,
      autoExecute: true,
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
      autoExecute: true,
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
        'Show quota/usage information for OAuth providers (Anthropic, Codex) and API-key providers (Z.ai, Synthetic, Chutes, Kimi).',
      kind: CommandKind.BUILT_IN,
      action: quotaSubcommandAction,
    },
    {
      name: 'buckets',
      description: 'Show OAuth bucket usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: bucketsSubcommandAction,
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
