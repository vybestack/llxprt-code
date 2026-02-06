/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:openai:codex:usage');

/**
 * Schema for a single rate limit window from Codex usage endpoint
 */
export const CodexRateLimitWindowSchema = z.object({
  used_percent: z.number().min(0).describe('Usage percentage (0 = unused)'),
  limit_window_seconds: z
    .number()
    .int()
    .positive()
    .describe('Length of rate limit window in seconds'),
  reset_after_seconds: z
    .number()
    .int()
    .nonnegative()
    .describe('Seconds until reset'),
  reset_at: z.number().int().positive().describe('Unix timestamp for reset'),
});

/**
 * Schema for rate limit details
 */
export const CodexRateLimitDetailsSchema = z.object({
  allowed: z.boolean().describe('Whether requests are currently allowed'),
  limit_reached: z
    .boolean()
    .describe('Whether the rate limit has been reached'),
  primary_window: CodexRateLimitWindowSchema.nullable()
    .optional()
    .describe('5-hour rate limit window'),
  secondary_window: CodexRateLimitWindowSchema.nullable()
    .optional()
    .describe('Weekly rate limit window'),
});

/**
 * Schema for credits information
 */
export const CodexCreditsSchema = z.object({
  has_credits: z.boolean().describe('Whether the account has credits'),
  unlimited: z.boolean().describe('Whether the account has unlimited credits'),
  balance: z
    .string()
    .nullable()
    .optional()
    .describe('Credit balance as string, null if N/A'),
});

/**
 * Schema for Codex usage response
 * Based on https://api.openai.com/api/codex/usage endpoint
 */
export const CodexUsageInfoSchema = z
  .object({
    plan_type: z.string().describe('Plan type for the account'),
    rate_limit: CodexRateLimitDetailsSchema.nullable()
      .optional()
      .describe('Rate limit information'),
    credits: CodexCreditsSchema.nullable()
      .optional()
      .describe('Credits information'),
  })
  .passthrough();

/**
 * Single rate limit window information (may be null)
 */
export type CodexRateLimitWindow = z.infer<
  typeof CodexRateLimitWindowSchema
> | null;

/**
 * Credits information
 */
export type CodexCredits = z.infer<typeof CodexCreditsSchema> | null;

/**
 * Codex usage information from API endpoint
 */
export type CodexUsageInfo = z.infer<typeof CodexUsageInfoSchema>;

const DEFAULT_CODEX_USAGE_ENDPOINT = 'https://api.openai.com/api/codex/usage';
const CHATGPT_BACKEND_USAGE_ENDPOINT =
  'https://chatgpt.com/backend-api/wham/usage';

function normalizeBaseUrl(baseUrl?: string): string {
  if (typeof baseUrl !== 'string') {
    return '';
  }

  let normalized = baseUrl.trim();
  while (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function buildCodexUsageEndpoints(baseUrl?: string): string[] {
  const endpoints: string[] = [];
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (normalizedBaseUrl) {
    // Match Codex upstream path style behavior:
    // - /backend-api* uses /wham/usage rooted at /backend-api
    // - otherwise use /api/codex/usage
    if (normalizedBaseUrl.includes('/backend-api')) {
      const backendApiBase = normalizedBaseUrl.includes('/backend-api/codex')
        ? normalizedBaseUrl.replace('/backend-api/codex', '/backend-api')
        : normalizedBaseUrl;
      endpoints.push(`${backendApiBase}/wham/usage`);
    } else {
      endpoints.push(`${normalizedBaseUrl}/api/codex/usage`);
    }
  }

  endpoints.push(CHATGPT_BACKEND_USAGE_ENDPOINT);
  endpoints.push(DEFAULT_CODEX_USAGE_ENDPOINT);
  return Array.from(new Set(endpoints));
}

/**
 * Fetch usage information from Codex usage endpoint
 * Requires an OAuth access token and account_id from Codex authentication
 *
 * @param accessToken - OAuth access token
 * @param accountId - Account ID for ChatGPT-Account-Id header
 * @param baseUrl - Optional Codex base URL for ChatGPT path-style usage endpoint
 * @returns Usage info if available, null on error
 */
export async function fetchCodexUsage(
  accessToken: string,
  accountId: string,
  baseUrl?: string,
): Promise<CodexUsageInfo | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    logger.debug(() => 'Invalid access token provided');
    return null;
  }

  if (!accountId || typeof accountId !== 'string') {
    logger.debug(() => 'Invalid account ID provided');
    return null;
  }

  const endpoints = buildCodexUsageEndpoints(baseUrl);

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'ChatGPT-Account-Id': accountId,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.debug(
          () =>
            `Usage endpoint ${endpoint} returned ${response.status}: ${response.statusText}`,
        );
        continue;
      }

      const data = await response.json();

      const parsedData = CodexUsageInfoSchema.safeParse(data);
      if (!parsedData.success) {
        logger.debug(
          () =>
            `Failed to parse usage response from ${endpoint}: ${JSON.stringify(parsedData.error)}`,
        );
        continue;
      }

      logger.debug(
        () =>
          `Fetched Codex usage info from ${endpoint}: ${JSON.stringify(parsedData.data)}`,
      );

      return parsedData.data;
    } catch (error) {
      logger.debug(
        () =>
          `Error fetching Codex usage info from ${endpoint}: ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }

  return null;
}

/**
 * Format a rate limit window for display
 */
export function formatCodexRateLimitWindow(
  window: CodexRateLimitWindow,
  label: string,
): string | null {
  if (!window || typeof window.used_percent !== 'number') {
    return null;
  }

  const usedPercent = window.used_percent;
  const resetDate = new Date(window.reset_at * 1000); // Convert unix timestamp to milliseconds

  let timeUntilReset: string;
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    const remainingMins = diffMins % 60;
    timeUntilReset = `in ${diffHours}h ${remainingMins}m`;
  } else if (diffMins > 0) {
    timeUntilReset = `in ${diffMins}m`;
  } else {
    timeUntilReset = 'soon';
  }

  return `  ${label}: ${usedPercent}% used (resets ${timeUntilReset})`;
}

/**
 * Format all available Codex usage information for display
 */
export function formatCodexUsage(usage: CodexUsageInfo): string[] {
  const lines: string[] = [];

  // Format rate limit windows
  if (usage.rate_limit) {
    if (usage.rate_limit.primary_window) {
      const formatted = formatCodexRateLimitWindow(
        usage.rate_limit.primary_window,
        '5-hour limit',
      );
      if (formatted) lines.push(formatted);
    }

    if (usage.rate_limit.secondary_window) {
      const formatted = formatCodexRateLimitWindow(
        usage.rate_limit.secondary_window,
        'Weekly limit',
      );
      if (formatted) lines.push(formatted);
    }
  }

  // Format credits
  if (usage.credits) {
    if (usage.credits.unlimited) {
      lines.push('  Credits: Unlimited');
    } else if (usage.credits.has_credits && usage.credits.balance) {
      lines.push(`  Credits: ${usage.credits.balance}`);
    } else if (!usage.credits.has_credits) {
      lines.push('  Credits: None');
    }
  }

  return lines;
}
