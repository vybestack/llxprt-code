/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P06
 * @plan PLAN-20260214-SESSIONBROWSER.P24
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
  CodexUsageInfoSchema,
  DebugLogger,
  detectApiKeyProvider,
  detectApiKeyProviderFromName,
  fetchApiKeyQuota,
  formatAllUsagePeriods,
  formatCodexUsage,
} from '@vybestack/llxprt-code-core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { formatSessionSection } from './formatSessionSection.js';
import type { SessionRecordingMetadata } from '../types/SessionRecordingMetadata.js';

const logger = new DebugLogger('llxprt:cli:stats');

/** Sort bucket names with 'default' first, then lexicographic. */
function defaultFirstSort(a: string, b: string): number {
  if (a === 'default') return -1;
  if (b === 'default') return 1;
  return a.localeCompare(b);
}

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
 *
 * Detection strategy (in priority order):
 * 1. Ephemeral base-url setting (most specific, user override)
 * 2. Provider config base-url (from providerConfig) - uses kebab-case per PR #1491
 * 3. Base provider config base-url (from baseProviderConfig) - uses kebab-case per PR #1491
 * 4. Provider name detection (least specific, fallback only)
 */
async function fetchApiKeyProviderQuota(
  runtimeApi: ReturnType<typeof getRuntimeApi>,
): Promise<{ provider: string; lines: string[] } | null> {
  let provider: 'zai' | 'synthetic' | 'chutes' | 'kimi' | null = null;
  let baseUrlForFetch: string | undefined;
  const activeProviderName = runtimeApi.getActiveProviderName?.();

  // Strategy 1: Check ephemeral base-url setting (highest priority)
  const ephemeralBaseUrl = runtimeApi.getEphemeralSetting('base-url');
  if (typeof ephemeralBaseUrl === 'string') {
    provider = detectApiKeyProvider(ephemeralBaseUrl);
    baseUrlForFetch = ephemeralBaseUrl;
    if (provider) {
      logger.debug(() => `Detected ${provider} from ephemeral base-url`);
    }
  }

  // Strategy 2 & 3: If not found, try provider config base URLs
  if (!provider && activeProviderName) {
    const providerManager = runtimeApi.getCliProviderManager?.();
    if (providerManager) {
      const providerInstance =
        providerManager.getProviderByName?.(activeProviderName);
      if (providerInstance) {
        // Try providerConfig['base-url'] first (kebab-case per PR #1491)
        const providerConfig = (
          providerInstance as {
            providerConfig?: { 'base-url'?: string };
          }
        ).providerConfig;
        if (providerConfig) {
          const configBaseUrl = providerConfig['base-url']?.trim() || undefined;
          if (configBaseUrl) {
            provider = detectApiKeyProvider(configBaseUrl);
            baseUrlForFetch = configBaseUrl;
            if (provider) {
              logger.debug(
                () => `Detected ${provider} from provider config base-url`,
              );
            }
          }
        }

        // Try baseProviderConfig['base-url'] if still not found (kebab-case per PR #1491)
        if (!provider) {
          const baseProviderConfig = (
            providerInstance as {
              baseProviderConfig?: { 'base-url'?: string };
            }
          ).baseProviderConfig;
          if (baseProviderConfig) {
            const baseConfigUrl =
              baseProviderConfig['base-url']?.trim() || undefined;
            if (baseConfigUrl) {
              provider = detectApiKeyProvider(baseConfigUrl);
              baseUrlForFetch = baseConfigUrl;
              if (provider) {
                logger.debug(
                  () =>
                    `Detected ${provider} from base provider config base-url`,
                );
              }
            }
          }
        }
      }
    }
  }

  // Strategy 4: If still not found, try active provider name (fallback only)
  if (!provider && activeProviderName) {
    provider = detectApiKeyProviderFromName(activeProviderName);
    // Note: baseUrlForFetch remains undefined for name-based detection
    if (provider) {
      logger.debug(() => `Detected ${provider} from active provider name`);
    }
  }

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

  return fetchApiKeyQuota(provider, apiKey, baseUrlForFetch);
}

function formatQuotaResetTime(resetTime: string): string {
  try {
    const reset = new Date(resetTime);
    if (Number.isNaN(reset.getTime())) {
      return resetTime;
    }
    const now = new Date();
    const diffMs = reset.getTime() - now.getTime();
    if (diffMs <= 0) {
      return 'now';
    }
    const diffMin = Math.ceil(diffMs / 60000);
    if (diffMin < 60) {
      return `${diffMin}m`;
    }
    const diffHr = Math.floor(diffMin / 60);
    const remainMin = diffMin % 60;
    return remainMin > 0 ? `${diffHr}h ${remainMin}m` : `${diffHr}h`;
  } catch {
    return resetTime;
  }
}

function formatGeminiQuotaLines(quotaData: Record<string, unknown>): string[] {
  const buckets = quotaData.buckets;
  if (!Array.isArray(buckets) || buckets.length === 0) {
    return [];
  }

  const lines: string[] = [];
  for (const bucket of buckets) {
    const b = bucket as Record<string, unknown>;
    const model = (b.modelId as string) ?? 'unknown';
    const tokenType = (b.tokenType as string) ?? 'tokens';
    const remaining = (b.remainingAmount as string) ?? '?';
    const fraction =
      typeof b.remainingFraction === 'number'
        ? ` (${Math.round(b.remainingFraction * 100)}%)`
        : '';
    const resetStr =
      typeof b.resetTime === 'string'
        ? ` · resets in ${formatQuotaResetTime(b.resetTime)}`
        : '';
    lines.push(`  ${model} ${tokenType}: ${remaining}${fraction}${resetStr}`);
  }
  return lines;
}

/**
 * Fetch all available quota information for the default stats view.
 * Returns formatted lines ready for display, or empty array if no quota available.
 */
async function fetchAllQuotaInfo(
  runtimeApi: ReturnType<typeof getRuntimeApi>,
): Promise<string[]> {
  const output: string[] = [];
  const oauthManager = runtimeApi.getCliOAuthManager();

  try {
    // 1. Fetch OAuth provider quotas (Anthropic + Codex + Gemini)
    if (oauthManager) {
      const [anthropicResult, codexResult, geminiResult] =
        await Promise.allSettled([
          oauthManager.getAllAnthropicUsageInfo(),
          oauthManager.getAllCodexUsageInfo(),
          oauthManager.getAllGeminiUsageInfo(),
        ]);

      if (anthropicResult.status === 'rejected') {
        logger.warn(
          'Failed to fetch Anthropic usage info:',
          anthropicResult.reason,
        );
      }
      if (codexResult.status === 'rejected') {
        logger.warn('Failed to fetch Codex usage info:', codexResult.reason);
      }

      const anthropicUsageInfo =
        anthropicResult.status === 'fulfilled'
          ? anthropicResult.value
          : new Map<string, Record<string, unknown>>();
      const codexUsageInfo =
        codexResult.status === 'fulfilled'
          ? codexResult.value
          : new Map<string, Record<string, unknown>>();
      const geminiUsageInfo =
        geminiResult.status === 'fulfilled'
          ? geminiResult.value
          : new Map<string, Record<string, unknown>>();

      // Collect Anthropic lines
      if (anthropicUsageInfo.size > 0) {
        const anthropicLines: string[] = [];

        const sortedBuckets = Array.from(anthropicUsageInfo.keys()).sort(
          defaultFirstSort,
        );

        for (const bucket of sortedBuckets) {
          const usageInfo = anthropicUsageInfo.get(bucket)!;
          const lines = formatAllUsagePeriods(usageInfo);

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
          defaultFirstSort,
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

      // Collect Gemini quota lines (from CodeAssist retrieveUserQuota API)
      if (geminiUsageInfo.size > 0) {
        const geminiLines: string[] = [];

        const sortedBuckets = Array.from(geminiUsageInfo.keys()).sort(
          defaultFirstSort,
        );

        for (const bucket of sortedBuckets) {
          const quotaData = geminiUsageInfo.get(bucket)!;
          const lines = formatGeminiQuotaLines(quotaData);

          if (lines.length > 0) {
            if (geminiUsageInfo.size > 1) {
              geminiLines.push(`### Bucket: ${bucket}\n`);
            }
            geminiLines.push(...lines);
            geminiLines.push('');
          }
        }

        if (geminiLines[geminiLines.length - 1] === '') {
          geminiLines.pop();
        }

        if (geminiLines.length > 0) {
          if (output.length > 0) {
            output.push('');
          }
          output.push('## Gemini Quota Information\n');
          output.push(...geminiLines);
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
  } catch (error) {
    logger.warn(
      'Error fetching quota info for default stats view:',
      error instanceof Error ? error.message : String(error),
    );
  }

  return output;
}

async function defaultSessionView(context: CommandContext): Promise<void> {
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
      action: async (context: CommandContext) => {
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
