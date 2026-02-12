/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:synthetic:usage');

/**
 * Schema for a single quota bucket (subscription, search, toolCallDiscounts)
 */
export const SyntheticQuotaBucketSchema = z.object({
  limit: z.number().describe('Maximum allowed in the window'),
  requests: z.number().describe('Number of requests used'),
  renewsAt: z
    .string()
    .nullable()
    .optional()
    .describe('ISO 8601 timestamp when the quota resets, or null'),
});

/**
 * Schema for search quota (nested hourly bucket)
 */
export const SyntheticSearchQuotaSchema = z
  .object({
    hourly: SyntheticQuotaBucketSchema.nullable()
      .optional()
      .describe('Hourly search quota'),
  })
  .passthrough();

/**
 * Schema for Synthetic usage response
 * Based on https://api.synthetic.new/v2/quotas endpoint
 */
export const SyntheticQuotaResponseSchema = z
  .object({
    subscription: SyntheticQuotaBucketSchema.nullable()
      .optional()
      .describe('Subscription quota information'),
    search: SyntheticSearchQuotaSchema.nullable()
      .optional()
      .describe('Search quota information'),
    toolCallDiscounts: SyntheticQuotaBucketSchema.nullable()
      .optional()
      .describe('Tool call discount quota information'),
  })
  .passthrough();

/**
 * Single quota bucket
 */
export type SyntheticQuotaBucket = z.infer<typeof SyntheticQuotaBucketSchema>;

/**
 * Synthetic usage information from quota endpoint
 */
export type SyntheticUsageInfo = z.infer<typeof SyntheticQuotaResponseSchema>;

const SYNTHETIC_USAGE_ENDPOINT = 'https://api.synthetic.new/v2/quotas';

/**
 * Fetch usage information from Synthetic quota endpoint
 * Requires a Synthetic API key
 *
 * @param apiKey - Synthetic API key
 * @returns Usage info if available, null on error
 */
export async function fetchSyntheticUsage(
  apiKey: string,
): Promise<SyntheticUsageInfo | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => 'Invalid API key provided');
    return null;
  }

  try {
    const response = await fetch(SYNTHETIC_USAGE_ENDPOINT, {
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

    const parsedData = SyntheticQuotaResponseSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse Synthetic response: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () =>
        `Fetched Synthetic usage info: hasSubscription=${!!parsedData.data.subscription}, hasToolCalls=${!!parsedData.data.toolCallDiscounts}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Synthetic usage info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format a reset time from ISO string for display
 */
function formatResetTime(renewsAt: string): string {
  const resetDate = new Date(renewsAt);
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
 * Format a quota bucket for display
 */
function formatBucket(
  bucket: SyntheticQuotaBucket,
  label: string,
): string | null {
  if (typeof bucket.limit !== 'number' || typeof bucket.requests !== 'number') {
    return null;
  }

  const remaining = Math.max(0, bucket.limit - bucket.requests);
  const resetStr = bucket.renewsAt ? formatResetTime(bucket.renewsAt) : 'N/A';
  const remainingStr =
    remaining === Math.floor(remaining)
      ? String(remaining)
      : remaining.toFixed(1);

  return `  ${label}: ${bucket.requests}/${bucket.limit} used (${remainingStr} remaining, resets ${resetStr})`;
}

/**
 * Format all available Synthetic usage information for display
 */
export function formatSyntheticUsage(usage: SyntheticUsageInfo): string[] {
  const lines: string[] = [];

  if (usage.subscription) {
    const formatted = formatBucket(usage.subscription, 'Subscription');
    if (formatted) lines.push(formatted);
  }

  if (usage.toolCallDiscounts) {
    const formatted = formatBucket(usage.toolCallDiscounts, 'Tool calls');
    if (formatted) lines.push(formatted);
  }

  if (usage.search?.hourly) {
    const formatted = formatBucket(usage.search.hourly, 'Search (hourly)');
    if (formatted) lines.push(formatted);
  }

  return lines;
}
