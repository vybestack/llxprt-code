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
  resets_at: z.string().describe('ISO 8601 timestamp for reset time'),
});

/**
 * Schema for Anthropic OAuth usage response
 * Based on https://api.anthropic.com/api/oauth/usage endpoint
 */
export const AnthropicUsageInfoSchema = z.object({
  five_hour: UsagePeriodSchema.optional(),
  seven_day: UsagePeriodSchema.optional(),
});

/**
 * Single usage period information
 */
export type UsagePeriod = z.infer<typeof UsagePeriodSchema>;

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
export function formatUsagePeriod(period: UsagePeriod, label: string): string {
  const utilization = period.utilization.toFixed(1);
  const resetDate = new Date(period.resets_at);
  const now = new Date();
  const diffMs = resetDate.getTime() - now.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  let timeUntilReset: string;
  if (diffHours > 0) {
    const remainingMins = diffMins % 60;
    timeUntilReset = `in ${diffHours}h ${remainingMins}m`;
  } else if (diffMins > 0) {
    timeUntilReset = `in ${diffMins}m`;
  } else {
    timeUntilReset = 'soon';
  }

  return `  ${label}: ${utilization}% used (resets ${timeUntilReset})`;
}
