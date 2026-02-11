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
      .describe('Total available balance (cash + voucher) in USD'),
    voucher_balance: z
      .number()
      .optional()
      .describe('Balance from vouchers in USD'),
    cash_balance: z
      .number()
      .optional()
      .describe('Cash balance in USD (can be negative)'),
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
 * Check if an API key is a Kimi Code subscription key (sk-kimi- prefix)
 * These keys do not work with the balance endpoint
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

  lines.push(`  Available balance: $${usage.available_balance.toFixed(2)}`);

  if (typeof usage.cash_balance === 'number') {
    lines.push(`  Cash balance: $${usage.cash_balance.toFixed(2)}`);
  }

  if (typeof usage.voucher_balance === 'number' && usage.voucher_balance > 0) {
    lines.push(`  Voucher balance: $${usage.voucher_balance.toFixed(2)}`);
  }

  if (usage.available_balance <= 0) {
    lines.push('  WARNING: Balance depleted - API calls may be restricted');
  }

  return lines;
}

/**
 * Format a message for Kimi Code subscription keys (no balance endpoint)
 */
export function formatKimiCodeKeyMessage(): string[] {
  return [
    '  Kimi Code subscription detected (sk-kimi- key)',
    '  Quota checking is not available for Kimi Code subscription keys',
    '  Check your quota at https://kimi.com/code/settings',
  ];
}
