/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:anthropic:usage');

/**
 * Schema for a single usage period from Anthropic OAuth usage endpoint
 */
export const UsagePeriodSchema = z.object({
  utilization: z.number().describe('Usage percentage (0-100)'),
  resets_at: z
    .string()
    .nullable()
    .optional()
    .describe('ISO 8601 timestamp for reset time, or null if not applicable'),
});

/**
 * Schema for Anthropic OAuth usage response
 * Based on https://api.anthropic.com/api/oauth/usage endpoint
 *
 * The response includes multiple quota types:
 * - five_hour: 5-hour rolling window usage
 * - seven_day: 7-day rolling window usage (general)
 * - seven_day_oauth_apps: OAuth apps specific quota
 * - seven_day_opus: Opus model specific quota
 * - seven_day_sonnet: Sonnet model specific quota (if applicable)
 *
 * Uses passthrough() to allow for unknown fields from the API
 */
export const AnthropicUsageInfoSchema = z
  .object({
    five_hour: UsagePeriodSchema.nullable().optional(),
    seven_day: UsagePeriodSchema.nullable().optional(),
    seven_day_oauth_apps: UsagePeriodSchema.nullable().optional(),
    seven_day_opus: UsagePeriodSchema.nullable().optional(),
    seven_day_sonnet: UsagePeriodSchema.nullable().optional(),
  })
  .passthrough();

/**
 * Single usage period information (may be null)
 */
export type UsagePeriod = z.infer<typeof UsagePeriodSchema> | null;

/**
 * Anthropic usage information from OAuth endpoint
 */
export type AnthropicUsageInfo = z.infer<typeof AnthropicUsageInfoSchema>;

const USAGE_ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

/**
 * Fetch usage information from Anthropic OAuth endpoint
 * Requires an OAuth token (sk-ant-oat01-...) from Claude Code/Max authentication
 *
 * @param accessToken - OAuth access token
 * @returns Usage info if available, null on error
 */
export async function fetchAnthropicUsage(
  accessToken: string,
): Promise<AnthropicUsageInfo | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    logger.debug(() => 'Invalid access token provided');
    return null;
  }

  // OAuth tokens start with sk-ant-oat01-
  if (!accessToken.startsWith('sk-ant-oat01-')) {
    logger.debug(() => 'Not an OAuth token, skipping usage fetch');
    return null;
  }

  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `Usage endpoint returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    const parsedData = AnthropicUsageInfoSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse usage response: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () => `Fetched usage info: ${JSON.stringify(parsedData.data)}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching usage info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format a usage period for display
 */
export function formatUsagePeriod(
  period: UsagePeriod,
  label: string,
): string | null {
  if (!period || typeof period.utilization !== 'number') {
    return null;
  }

  const utilization = period.utilization.toFixed(1);
  const resetDate = period.resets_at ? new Date(period.resets_at) : null;

  let timeUntilReset: string;
  if (resetDate) {
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
  } else {
    timeUntilReset = 'N/A';
  }

  return `  ${label}: ${utilization}% used (resets ${timeUntilReset})`;
}

/**
 * Known quota period labels for display
 */
const KNOWN_PERIOD_LABELS: Record<string, string> = {
  five_hour: '5-hour window',
  seven_day: '7-day window',
  seven_day_oauth_apps: '7-day OAuth apps',
  seven_day_opus: '7-day Opus',
  seven_day_sonnet: '7-day Sonnet',
};

/**
 * Check if a value looks like a valid usage period object
 */
function isValidUsagePeriod(
  value: unknown,
): value is { utilization: number; resets_at?: string | null } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'utilization' in value &&
    typeof (value as { utilization: unknown }).utilization === 'number'
  );
}

/**
 * Format all available usage periods for display
 * Handles both known and unknown quota types from the API
 */
export function formatAllUsagePeriods(usage: AnthropicUsageInfo): string[] {
  const lines: string[] = [];

  // Process all fields in the usage object, not just known ones
  for (const [key, value] of Object.entries(usage)) {
    if (isValidUsagePeriod(value)) {
      // Use known label or generate one from the key
      const label =
        KNOWN_PERIOD_LABELS[key] ||
        key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const formatted = formatUsagePeriod(value as UsagePeriod, label);
      if (formatted) lines.push(formatted);
    }
  }

  return lines;
}
