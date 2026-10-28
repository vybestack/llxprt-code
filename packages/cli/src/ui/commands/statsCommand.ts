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
import { DebugLogger } from '@vybestack/llxprt-code-telemetry';
import { type SlashCommand, CommandKind } from './types.js';
import type { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import type { OAuthControl } from '../contexts/OAuthControlContext.js';
import { formatSessionSection } from './formatSessionSection.js';
import type { SessionRecordingMetadata } from '../types/SessionRecordingMetadata.js';

const logger = new DebugLogger('llxprt:cli:stats');
export interface StatsCommandOperations {
  readonly readStartTime: () => Date | null | undefined;
  readonly readQuota: () => Promise<string[]>;
  readonly isOAuthAvailable: () => boolean;
  readonly discoverBuckets: OAuthControl['discoverBuckets'];
  readonly addItem: UseHistoryManagerReturn['addItem'];
}

async function defaultSessionView(
  context: StatsCommandOperations,
): Promise<void> {
  const now = new Date();
  // Runtime stats may be incomplete before session initialization, so the
  // declared non-null type is narrowed at the boundary to reflect that
  // the value can legitimately be missing.
  const rawStartTime = context.readStartTime();
  if (rawStartTime == null) {
    context.addItem(
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
  const quotaLines = await context.readQuota();

  const statsItem: HistoryItemStats = {
    type: MessageType.STATS,
    duration: formatDuration(wallDuration),
    quotaLines: quotaLines.length > 0 ? quotaLines : undefined,
  };

  context.addItem(statsItem);

  // Session recording section (stub - result currently discarded)
  // @plan PLAN-20260214-SESSIONBROWSER.P24
  const _sessionMetadata: SessionRecordingMetadata | null = null;
  await formatSessionSection(_sessionMetadata);
}

async function quotaSubcommandAction(
  context: StatsCommandOperations,
): Promise<void> {
  try {
    const quotaLines = await context.readQuota();

    if (quotaLines.length === 0) {
      context.addItem(
        {
          type: MessageType.INFO,
          text: 'No quota information available. Supported providers: Claude Code (OAuth), Codex (OAuth), Z.ai, Synthetic, Chutes, Kimi.',
        },
        Date.now(),
      );
      return;
    }

    context.addItem(
      {
        type: MessageType.INFO,
        text: quotaLines.join('\n'),
      },
      Date.now(),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    context.addItem(
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
  return 'unavailable';
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

function formatUnavailableBucketLines(bucket: string): string[] {
  return [`- ${bucket}:`, `  - Usage data unavailable`];
}

function formatDiscoveredProviders(
  providers: ReadonlyArray<{
    provider: string;
    buckets: ReadonlyArray<{
      bucket: string;
      stats: {
        requestCount: number;
        percentage: number;
        lastUsed?: number;
      } | null;
    }>;
  }>,
): string[] {
  const output: string[] = ['## OAuth Bucket Statistics\n'];
  for (const { provider, buckets } of providers) {
    output.push(`### ${provider}\n`);
    for (const { bucket, stats } of buckets) {
      if (stats !== null) {
        output.push(...formatBucketLines(bucket, stats));
      } else {
        output.push(...formatUnavailableBucketLines(bucket));
      }
    }
    output.push('');
  }
  return output;
}

async function bucketsSubcommandAction(
  context: StatsCommandOperations,
  _args: string,
): Promise<void> {
  if (!context.isOAuthAvailable()) {
    context.addItem(
      {
        type: MessageType.INFO,
        text: 'OAuth is not available or configured',
      },
      Date.now(),
    );
    return;
  }

  try {
    const discovered = await context.discoverBuckets(logger);

    if (discovered.length === 0) {
      context.addItem(
        {
          type: MessageType.INFO,
          text: 'No OAuth buckets available',
        },
        Date.now(),
      );
      return;
    }

    const output = formatDiscoveredProviders(discovered);
    context.addItem(
      {
        type: MessageType.INFO,
        text: output.join('\n'),
      },
      Date.now(),
    );
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    context.addItem(
      {
        type: MessageType.ERROR,
        text: `Failed to retrieve bucket statistics: ${errorMessage}`,
      },
      Date.now(),
    );
  }
}

function createStatsView(
  name: string,
  description: string,
  type:
    | MessageType.MODEL_STATS
    | MessageType.TOOL_STATS
    | MessageType.CACHE_STATS
    | MessageType.LB_STATS,
  addItem: UseHistoryManagerReturn['addItem'],
  autoExecute = false,
): SlashCommand {
  return {
    name,
    description,
    kind: CommandKind.BUILT_IN,
    ...(autoExecute ? { autoExecute: true } : {}),
    action: () => {
      addItem({ type }, Date.now());
    },
  };
}
export function createStatsCommand(
  operations: StatsCommandOperations,
): SlashCommand {
  return {
    name: 'stats',
    altNames: ['usage'],
    description:
      'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
    kind: CommandKind.BUILT_IN,
    action: async () => defaultSessionView(operations),
    subCommands: [
      {
        name: 'session',
        description: 'Show session-specific usage statistics.',
        kind: CommandKind.BUILT_IN,
        autoExecute: true,
        action: async () => defaultSessionView(operations),
      },
      createStatsView(
        'model',
        'Show model-specific usage statistics.',
        MessageType.MODEL_STATS,
        operations.addItem,
        true,
      ),
      createStatsView(
        'tools',
        'Show tool-specific usage statistics.',
        MessageType.TOOL_STATS,
        operations.addItem,
        true,
      ),
      createStatsView(
        'cache',
        'Show cache usage statistics.',
        MessageType.CACHE_STATS,
        operations.addItem,
      ),
      {
        name: 'quota',
        description:
          'Show quota/usage information for OAuth providers (Claude Code, Codex) and API-key providers (Z.ai, Synthetic, Chutes, Kimi).',
        kind: CommandKind.BUILT_IN,
        action: async () => quotaSubcommandAction(operations),
      },
      {
        name: 'buckets',
        description: 'Show OAuth bucket usage statistics.',
        kind: CommandKind.BUILT_IN,
        action: async () => bucketsSubcommandAction(operations, ''),
      },
      {
        ...createStatsView(
          'lb',
          'Show load balancer usage statistics.',
          MessageType.LB_STATS,
          operations.addItem,
        ),
        altNames: ['loadbalancer'],
      },
    ],
  };
}
