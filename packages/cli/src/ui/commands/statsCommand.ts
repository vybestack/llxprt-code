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
import {
  DebugLogger,
  detectApiKeyProvider,
  fetchApiKeyQuota,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const logger = new DebugLogger('llxprt:cli:stats');

/**
 * Read API key from a keyfile path, handling tilde expansion
 */
async function readKeyFile(filePath: string): Promise<string | null> {
  try {
    const expandedPath = filePath.startsWith('~')
      ? path.join(os.homedir(), filePath.slice(1))
      : filePath;

    const resolvedPath = path.isAbsolute(expandedPath)
      ? expandedPath
      : path.resolve(process.cwd(), expandedPath);

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const key = content.trim();
    return key || null;
  } catch {
    return null;
  }
}

/**
 * Resolve the API key for the current profile.
 * Checks ephemeral settings for auth-keyfile first, then falls back to auth-key.
 */
async function resolveApiKey(
  runtimeApi: ReturnType<typeof getRuntimeApi>,
): Promise<string | null> {
  // Try auth-keyfile first
  const keyfilePath = runtimeApi.getEphemeralSetting('auth-keyfile');
  if (typeof keyfilePath === 'string' && keyfilePath.trim() !== '') {
    const key = await readKeyFile(keyfilePath.trim());
    if (key) return key;
  }

  // Try auth-key directly
  const authKey = runtimeApi.getEphemeralSetting('auth-key');
  if (typeof authKey === 'string' && authKey.trim() !== '') {
    return authKey.trim();
  }

  return null;
}

/**
 * Attempt to fetch quota for the current profile's API-key-based provider.
 * Returns null if the profile doesn't use a supported API-key provider.
 */
async function fetchApiKeyProviderQuota(
  runtimeApi: ReturnType<typeof getRuntimeApi>,
): Promise<{ provider: string; lines: string[] } | null> {
  const baseUrl = runtimeApi.getEphemeralSetting('base-url');

  const provider = detectApiKeyProvider(
    typeof baseUrl === 'string' ? baseUrl : undefined,
  );
  if (!provider) {
    return null;
  }

  const apiKey = await resolveApiKey(runtimeApi);
  if (!apiKey) {
    logger.debug(
      () => `Detected ${provider} provider but no API key available`,
    );
    return null;
  }

  return fetchApiKeyQuota(
    provider,
    apiKey,
    typeof baseUrl === 'string' ? baseUrl : undefined,
  );
}

function defaultSessionView(context: CommandContext): void {
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
}

export const statsCommand: SlashCommand = {
  name: 'stats',
  altNames: ['usage'],
  description:
    'check session stats. Usage: /stats [session|model|tools|cache|buckets|quota|lb]',
  kind: CommandKind.BUILT_IN,
  action: (context: CommandContext) => {
    defaultSessionView(context);
  },
  subCommands: [
    {
      name: 'session',
      description: 'Show session-specific usage statistics.',
      kind: CommandKind.BUILT_IN,
      action: (context: CommandContext) => {
        defaultSessionView(context);
      },
    },
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
        'Show quota/usage information for OAuth providers (Anthropic, Codex) and API-key providers (Z.ai, Synthetic, Chutes, Kimi).',
      kind: CommandKind.BUILT_IN,
      action: async (context: CommandContext) => {
        const runtimeApi = getRuntimeApi();
        const oauthManager = runtimeApi.getCliOAuthManager();

        try {
          const output: string[] = [];

          // 1. Fetch OAuth provider quotas (Anthropic + Codex)
          if (oauthManager) {
            const [anthropicResult, codexResult] = await Promise.allSettled([
              oauthManager.getAllAnthropicUsageInfo(),
              oauthManager.getAllCodexUsageInfo(),
            ]);

            if (anthropicResult.status === 'rejected') {
              logger.warn(
                'Failed to fetch Anthropic usage info:',
                anthropicResult.reason,
              );
            }
            if (codexResult.status === 'rejected') {
              logger.warn(
                'Failed to fetch Codex usage info:',
                codexResult.reason,
              );
            }

            const anthropicUsageInfo =
              anthropicResult.status === 'fulfilled'
                ? anthropicResult.value
                : new Map<string, Record<string, unknown>>();
            const codexUsageInfo =
              codexResult.status === 'fulfilled'
                ? codexResult.value
                : new Map<string, Record<string, unknown>>();

            const {
              formatAllUsagePeriods,
              formatCodexUsage,
              CodexUsageInfoSchema,
            } = await import('@vybestack/llxprt-code-core');

            // Collect Anthropic lines
            if (anthropicUsageInfo.size > 0) {
              const anthropicLines: string[] = [];

              const sortedBuckets = Array.from(anthropicUsageInfo.keys()).sort(
                (a, b) => {
                  if (a === 'default') return -1;
                  if (b === 'default') return 1;
                  return a.localeCompare(b);
                },
              );

              for (const bucket of sortedBuckets) {
                const usageInfo = anthropicUsageInfo.get(bucket)!;
                const lines = formatAllUsagePeriods(
                  usageInfo as Record<string, unknown>,
                );

                if (lines.length > 0) {
                  if (anthropicUsageInfo.size > 1) {
                    anthropicLines.push(`### Bucket: ${bucket}\n`);
                  }
                  anthropicLines.push(...lines);
                  anthropicLines.push('');
                }
              }

              if (anthropicLines[anthropicLines.length - 1] === '') {
                anthropicLines.pop();
              }

              if (anthropicLines.length > 0) {
                output.push('## Anthropic Quota Information\n');
                output.push(...anthropicLines);
              }
            }

            // Collect Codex lines
            if (codexUsageInfo.size > 0) {
              const codexLines: string[] = [];

              const sortedBuckets = Array.from(codexUsageInfo.keys()).sort(
                (a, b) => {
                  if (a === 'default') return -1;
                  if (b === 'default') return 1;
                  return a.localeCompare(b);
                },
              );

              for (const bucket of sortedBuckets) {
                const usageInfo = codexUsageInfo.get(bucket)!;

                const parsed = CodexUsageInfoSchema.safeParse(usageInfo);
                if (!parsed.success) {
                  logger.warn(
                    `Invalid Codex usage info for bucket ${bucket}:`,
                    parsed.error,
                  );
                  continue;
                }

                const lines = formatCodexUsage(parsed.data);

                if (lines.length > 0) {
                  if (codexUsageInfo.size > 1) {
                    codexLines.push(`### Bucket: ${bucket}\n`);
                  }
                  codexLines.push(...lines);
                  codexLines.push('');
                }
              }

              if (codexLines[codexLines.length - 1] === '') {
                codexLines.pop();
              }

              if (codexLines.length > 0) {
                if (output.length > 0) {
                  output.push('');
                }
                output.push('## Codex Quota Information\n');
                output.push(...codexLines);
              }
            }
          }

          // 2. Fetch API-key provider quota (Z.ai, Synthetic, Chutes, Kimi)
          const apiKeyQuotaResult = await fetchApiKeyProviderQuota(runtimeApi);
          if (apiKeyQuotaResult) {
            if (output.length > 0) {
              output.push('');
            }
            output.push(`## ${apiKeyQuotaResult.provider} Quota Information\n`);
            output.push(...apiKeyQuotaResult.lines);
          }

          if (output.length === 0) {
            context.ui.addItem(
              {
                type: MessageType.INFO,
                text: 'No quota information available. Supported providers: Anthropic (OAuth), Codex (OAuth), Z.ai, Synthetic, Chutes, Kimi.',
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
