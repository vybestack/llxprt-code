/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:chutes:usage');

/**
 * Schema for a single quota entry from Chutes quota endpoint
 * chute_id can be null for default quotas, quota can be a number or object
 */
export const ChutesQuotaEntrySchema = z
  .object({
    chute_id: z
      .string()
      .nullable()
      .optional()
      .describe('Chute identifier, null for default/global'),
    is_default: z.boolean().describe('Whether this is the default quota'),
    user_id: z.string().nullable().optional().describe('User identifier'),
    updated_at: z
      .string()
      .nullable()
      .optional()
      .describe('Last update timestamp'),
    payment_refresh_date: z
      .string()
      .nullable()
      .optional()
      .describe('Payment refresh date'),
    quota: z.unknown().describe('Quota value (number or object)'),
  })
  .passthrough();

/**
 * Schema for Chutes user info response
 */
export const ChutesUserInfoSchema = z
  .object({
    username: z.string().describe('Username'),
    user_id: z.string().nullable().optional().describe('User identifier'),
    balance: z.number().describe('Account balance'),
  })
  .passthrough();

/**
 * Combined Chutes usage information
 */
export const ChutesUsageInfoSchema = z.object({
  quotas: z.array(ChutesQuotaEntrySchema).describe('Quota entries'),
  balance: z.number().describe('Account balance'),
  username: z.string().describe('Username'),
});

/**
 * Single quota entry
 */
export type ChutesQuotaEntry = z.infer<typeof ChutesQuotaEntrySchema>;

/**
 * User info
 */
export type ChutesUserInfo = z.infer<typeof ChutesUserInfoSchema>;

/**
 * Combined Chutes usage information
 */
export type ChutesUsageInfo = z.infer<typeof ChutesUsageInfoSchema>;

const CHUTES_QUOTAS_ENDPOINT = 'https://api.chutes.ai/users/me/quotas';
const CHUTES_USER_ENDPOINT = 'https://api.chutes.ai/users/me';

/**
 * Fetch usage information from Chutes API
 * Fetches both quota and user info in parallel
 *
 * @param apiKey - Chutes API key
 * @returns Combined usage info if available, null on error
 */
export async function fetchChutesUsage(
  apiKey: string,
): Promise<ChutesUsageInfo | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => 'Invalid API key provided');
    return null;
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  try {
    const [quotasResponse, userResponse] = await Promise.all([
      fetch(CHUTES_QUOTAS_ENDPOINT, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(CHUTES_USER_ENDPOINT, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    if (!quotasResponse.ok) {
      logger.debug(
        () =>
          `Quotas endpoint returned ${quotasResponse.status}: ${quotasResponse.statusText}`,
      );
      return null;
    }

    if (!userResponse.ok) {
      logger.debug(
        () =>
          `User endpoint returned ${userResponse.status}: ${userResponse.statusText}`,
      );
      return null;
    }

    const quotasData = await quotasResponse.json();
    const userData = await userResponse.json();

    const parsedQuotas = z.array(ChutesQuotaEntrySchema).safeParse(quotasData);
    if (!parsedQuotas.success) {
      logger.debug(
        () =>
          `Failed to parse quotas response: ${JSON.stringify(parsedQuotas.error)}`,
      );
      return null;
    }

    const parsedUser = ChutesUserInfoSchema.pick({
      balance: true,
      username: true,
    })
      .passthrough()
      .safeParse(userData);
    if (!parsedUser.success) {
      logger.debug(
        () =>
          `Failed to parse user response: ${JSON.stringify(parsedUser.error)}`,
      );
      return null;
    }

    const result: ChutesUsageInfo = {
      quotas: parsedQuotas.data,
      balance: parsedUser.data.balance,
      username: parsedUser.data.username,
    };

    logger.debug(
      () =>
        `Fetched Chutes usage info: quotas=${result.quotas.length}, username=${result.username}`,
    );

    return result;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Chutes usage info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format quota value for display.
 * Handles both numeric quotas and object quotas (with rate limits).
 */
function formatQuotaValue(quota: unknown): string {
  if (typeof quota === 'number') {
    return `${quota} requests/day`;
  }
  if (quota && typeof quota === 'object') {
    const q = quota as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof q['usd_cents_per_hour'] === 'number') {
      parts.push(`$${(q['usd_cents_per_hour'] / 100).toFixed(2)}/hr`);
    }
    if (typeof q['usd_cents_per_day'] === 'number') {
      parts.push(`$${(q['usd_cents_per_day'] / 100).toFixed(2)}/day`);
    }
    if (parts.length > 0) {
      return parts.join(', ');
    }
    return JSON.stringify(quota);
  }
  return String(quota);
}

/**
 * Format all available Chutes usage information for display
 */
export function formatChutesUsage(usage: ChutesUsageInfo): string[] {
  const lines: string[] = [];

  // Show balance
  lines.push(`  Balance: $${usage.balance.toFixed(2)}`);

  // Show quota info
  for (const entry of usage.quotas) {
    const chuteId = entry.chute_id;
    const label =
      chuteId === null || chuteId === undefined || chuteId === '*'
        ? 'Quota (default)'
        : `Quota (${chuteId})`;
    lines.push(`  ${label}: ${formatQuotaValue(entry.quota)}`);
  }

  return lines;
}
