/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:kimi:usage');

/**
 * Schema for Kimi/Moonshot balance response
 * Based on https://api.moonshot.ai/v1/users/me/balance endpoint
 */
export const KimiBalanceSchema = z
  .object({
    available_balance: z
      .number()
      .describe('Total available balance (cash + voucher) in CNY'),
    voucher_balance: z
      .number()
      .optional()
      .describe('Balance from vouchers in CNY'),
    cash_balance: z
      .number()
      .optional()
      .describe('Cash balance in CNY (can be negative)'),
  })
  .passthrough();

/**
 * Kimi balance information
 */
export type KimiBalanceInfo = z.infer<typeof KimiBalanceSchema>;

const DEFAULT_KIMI_BALANCE_ENDPOINT =
  'https://api.moonshot.ai/v1/users/me/balance';

/**
 * Build the Kimi balance endpoint URL from an optional base URL.
 * Supports both api.moonshot.ai and api.moonshot.cn domains.
 */
function buildKimiBalanceEndpoint(baseUrl?: string): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return DEFAULT_KIMI_BALANCE_ENDPOINT;
  }

  try {
    const url = new URL(baseUrl.trim());
    const hostname = url.hostname.toLowerCase();
    // For kimi.com coding endpoint, use the moonshot.ai balance endpoint
    if (hostname === 'kimi.com' || hostname.endsWith('.kimi.com')) {
      return DEFAULT_KIMI_BALANCE_ENDPOINT;
    }
    // For moonshot domains, derive from the base URL
    return `${url.origin}/v1/users/me/balance`;
  } catch {
    return DEFAULT_KIMI_BALANCE_ENDPOINT;
  }
}

/**
 * Schemas for Kimi Code /usages endpoint response
 */
const KimiCodeMembershipSchema = z.object({
  level: z.string(),
});

const KimiCodeUserSchema = z.object({
  userId: z.string(),
  region: z.string().optional(),
  membership: KimiCodeMembershipSchema.optional(),
});

const KimiCodeUsageDetailSchema = z.object({
  limit: z.string(),
  remaining: z.string(),
  resetTime: z.string().optional(),
});

const KimiCodeWindowSchema = z.object({
  duration: z.number(),
  timeUnit: z.string(),
});

const KimiCodeLimitSchema = z.object({
  window: KimiCodeWindowSchema.optional(),
  detail: KimiCodeUsageDetailSchema,
});

export const KimiCodeUsageResponseSchema = z
  .object({
    user: KimiCodeUserSchema.optional(),
    usage: KimiCodeUsageDetailSchema.optional(),
    limits: z.array(KimiCodeLimitSchema).optional(),
  })
  .passthrough();

/**
 * Kimi Code usage information
 */
export type KimiCodeUsageInfo = z.infer<typeof KimiCodeUsageResponseSchema>;

const DEFAULT_KIMI_CODE_USAGE_ENDPOINT =
  'https://api.kimi.com/coding/v1/usages';

/**
 * Build the Kimi Code usage endpoint URL from an optional base URL.
 */
function buildKimiCodeUsageEndpoint(baseUrl?: string): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return DEFAULT_KIMI_CODE_USAGE_ENDPOINT;
  }

  try {
    const url = new URL(baseUrl.trim());
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'kimi.com' || hostname.endsWith('.kimi.com')) {
      // Derive from base URL: strip trailing slashes without regex (avoid ReDoS)
      let base = baseUrl.trim();
      while (base.endsWith('/')) {
        base = base.slice(0, -1);
      }
      return `${base}/usages`;
    }
    return DEFAULT_KIMI_CODE_USAGE_ENDPOINT;
  } catch {
    return DEFAULT_KIMI_CODE_USAGE_ENDPOINT;
  }
}

/**
 * Check if an API key is a Kimi Code subscription key (sk-kimi- prefix)
 */
function isKimiCodeKey(apiKey: string): boolean {
  return apiKey.startsWith('sk-kimi-');
}

/**
 * Fetch balance information from Kimi/Moonshot API
 * Only works with standard Moonshot API keys (not Kimi Code subscription keys)
 *
 * @param apiKey - Moonshot API key
 * @param baseUrl - Optional base URL to derive endpoint from
 * @returns Balance info if available, null on error
 */
export async function fetchKimiUsage(
  apiKey: string,
  baseUrl?: string,
): Promise<KimiBalanceInfo | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => 'Invalid API key provided');
    return null;
  }

  // Kimi Code subscription keys (sk-kimi-) don't support the balance endpoint
  if (isKimiCodeKey(apiKey)) {
    logger.debug(
      () =>
        'Kimi Code subscription key detected; balance endpoint not supported',
    );
    return null;
  }

  const endpoint = buildKimiBalanceEndpoint(baseUrl);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `Balance endpoint returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    const parsedData = KimiBalanceSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse Kimi balance response: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () =>
        `Fetched Kimi balance info: available=${parsedData.data.available_balance}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Kimi balance info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format all available Kimi balance information for display
 */
export function formatKimiUsage(usage: KimiBalanceInfo): string[] {
  const lines: string[] = [];

  lines.push(`  Available balance: ¥${usage.available_balance.toFixed(2)}`);

  if (typeof usage.cash_balance === 'number') {
    lines.push(`  Cash balance: ¥${usage.cash_balance.toFixed(2)}`);
  }

  if (typeof usage.voucher_balance === 'number' && usage.voucher_balance > 0) {
    lines.push(`  Voucher balance: ¥${usage.voucher_balance.toFixed(2)}`);
  }

  if (usage.available_balance <= 0) {
    lines.push('  WARNING: Balance depleted - API calls may be restricted');
  }

  return lines;
}

/**
 * Fetch usage information from Kimi Code /usages endpoint
 * Works with Kimi Code subscription keys (sk-kimi- prefix)
 *
 * @param apiKey - Kimi Code API key
 * @param baseUrl - Optional base URL to derive endpoint from
 * @returns Usage info if available, null on error
 */
export async function fetchKimiCodeUsage(
  apiKey: string,
  baseUrl?: string,
): Promise<KimiCodeUsageInfo | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => 'Invalid API key provided');
    return null;
  }

  const endpoint = buildKimiCodeUsageEndpoint(baseUrl);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `Usage endpoint returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    const parsedData = KimiCodeUsageResponseSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse Kimi Code usage response: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () =>
        `Fetched Kimi Code usage info: limit=${parsedData.data.usage?.limit}, remaining=${parsedData.data.usage?.remaining}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Kimi Code usage info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format a reset time from ISO string relative to now for display
 */
function formatResetTime(resetTimeStr: string): string {
  const resetDate = new Date(resetTimeStr);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffHours > 0) {
    const remainingMins = diffMins % 60;
    return `in ${diffHours}h ${remainingMins}m`;
  } else if (diffMins > 0) {
    return `in ${diffMins}m`;
  } else {
    return 'soon';
  }
}

/**
 * Format a window duration in minutes to a human-readable label
 */
function formatWindowLabel(durationMinutes: number): string {
  if (durationMinutes >= 60) {
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
  return `${durationMinutes}m`;
}

/**
 * Format a membership level string for display
 * e.g. "LEVEL_INTERMEDIATE" -> "Intermediate"
 */
function formatMembershipLevel(level: string): string {
  const stripped = level.replace(/^LEVEL_/, '');
  return stripped.charAt(0).toUpperCase() + stripped.slice(1).toLowerCase();
}

/**
 * Format all available Kimi Code usage information for display
 */
export function formatKimiCodeUsage(usage: KimiCodeUsageInfo): string[] {
  const lines: string[] = [];

  // Show membership level if available
  if (usage.user?.membership?.level) {
    lines.push(
      `  Membership: ${formatMembershipLevel(usage.user.membership.level)}`,
    );
  }

  // Show weekly usage from usage field
  if (usage.usage) {
    const limit = parseInt(usage.usage.limit, 10);
    const remaining = parseInt(usage.usage.remaining, 10);
    const used = limit - remaining;
    let line = `  Weekly quota: ${used}/${limit} used (${remaining} remaining`;
    if (usage.usage.resetTime) {
      line += `, resets ${formatResetTime(usage.usage.resetTime)}`;
    }
    line += ')';
    lines.push(line);
  }

  // Show rolling window limits
  if (usage.limits) {
    for (const entry of usage.limits) {
      const limit = parseInt(entry.detail.limit, 10);
      const remaining = parseInt(entry.detail.remaining, 10);
      const used = limit - remaining;

      let windowLabel = 'Window';
      if (entry.window) {
        windowLabel = `${formatWindowLabel(entry.window.duration)} limit`;
      }

      let line = `  ${windowLabel}: ${used}/${limit} used (${remaining} remaining`;
      if (entry.detail.resetTime) {
        line += `, resets ${formatResetTime(entry.detail.resetTime)}`;
      }
      line += ')';
      lines.push(line);
    }
  }

  return lines;
}
