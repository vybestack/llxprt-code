/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '../../debug/index.js';

const logger = new DebugLogger('llxprt:zai:usage');

/**
 * Schema for a single usage detail entry (tool-level breakdown)
 */
export const ZaiUsageDetailSchema = z.object({
  modelCode: z.string().describe('Tool/model identifier'),
  usage: z.number().describe('Usage count for this tool'),
});

/**
 * Schema for a single limit entry from Z.ai quota endpoint
 *
 * Limits can be:
 * - TOKENS_LIMIT: Token-based rolling window (e.g., 5-hour)
 * - TIME_LIMIT: Time/call-based limit (e.g., monthly MCP usage)
 */
export const ZaiLimitSchema = z
  .object({
    type: z.string().describe('Limit type (e.g., TOKENS_LIMIT, TIME_LIMIT)'),
    unit: z.number().describe('Unit type identifier'),
    number: z.number().describe('Window size in units'),
    usage: z.number().optional().describe('Total quota amount'),
    currentValue: z.number().optional().describe('Current usage amount'),
    remaining: z.number().optional().describe('Remaining quota'),
    percentage: z.number().describe('Usage percentage (0-100)'),
    nextResetTime: z
      .number()
      .optional()
      .describe('Unix timestamp in milliseconds for next reset'),
    usageDetails: z
      .array(ZaiUsageDetailSchema)
      .optional()
      .describe('Per-tool usage breakdown'),
  })
  .passthrough();

/**
 * Schema for Z.ai quota response
 * Based on https://api.z.ai/api/monitor/usage/quota/limit endpoint
 */
export const ZaiQuotaResponseSchema = z
  .object({
    code: z.number().describe('Response status code'),
    msg: z.string().describe('Response message'),
    data: z
      .object({
        limits: z.array(ZaiLimitSchema).describe('Array of quota limits'),
        level: z.string().describe('Plan level (e.g., max, pro, free)'),
      })
      .passthrough(),
    success: z.boolean().describe('Whether the request was successful'),
  })
  .passthrough();

/**
 * Single usage detail entry
 */
export type ZaiUsageDetail = z.infer<typeof ZaiUsageDetailSchema>;

/**
 * Single limit entry
 */
export type ZaiLimit = z.infer<typeof ZaiLimitSchema>;

/**
 * Z.ai usage information from quota endpoint
 */
export type ZaiUsageInfo = z.infer<typeof ZaiQuotaResponseSchema>;

const DEFAULT_ZAI_USAGE_ENDPOINT =
  'https://api.z.ai/api/monitor/usage/quota/limit';

/**
 * Build the Z.ai usage endpoint URL from an optional base URL.
 * If baseUrl is provided, extract the origin and append the quota path.
 */
function buildZaiUsageEndpoint(baseUrl?: string): string {
  if (!baseUrl || typeof baseUrl !== 'string') {
    return DEFAULT_ZAI_USAGE_ENDPOINT;
  }

  try {
    const url = new URL(baseUrl.trim());
    return `${url.origin}/api/monitor/usage/quota/limit`;
  } catch {
    return DEFAULT_ZAI_USAGE_ENDPOINT;
  }
}

/**
 * Fetch usage information from Z.ai quota endpoint
 * Requires a Z.ai API key (raw key, NOT Bearer token)
 *
 * @param apiKey - Z.ai API key
 * @param baseUrl - Optional base URL to derive endpoint from
 * @returns Usage info if available, null on error
 */
export async function fetchZaiUsage(
  apiKey: string,
  baseUrl?: string,
): Promise<ZaiUsageInfo | null> {
  if (!apiKey || typeof apiKey !== 'string') {
    logger.debug(() => 'Invalid API key provided');
    return null;
  }

  const endpoint = buildZaiUsageEndpoint(baseUrl);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        Authorization: apiKey,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
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

    const parsedData = ZaiQuotaResponseSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse usage response: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () =>
        `Fetched Z.ai usage info: level=${parsedData.data.data.level}, limits=${parsedData.data.data.limits.length}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Z.ai usage info: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format a reset time relative to now for display
 */
function formatResetTime(nextResetTime: number | undefined): string {
  if (!nextResetTime) {
    return 'N/A';
  }

  const now = Date.now();
  const diffMs = nextResetTime - now;
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
 * Format all available Z.ai usage information for display
 */
export function formatZaiUsage(usage: ZaiUsageInfo): string[] {
  const lines: string[] = [];

  // Show plan level
  const level = usage.data.level;
  const capitalizedLevel = level.charAt(0).toUpperCase() + level.slice(1);
  lines.push(`  Plan: ${capitalizedLevel}`);

  for (const limit of usage.data.limits) {
    if (limit.type === 'TOKENS_LIMIT') {
      const resetStr = formatResetTime(limit.nextResetTime);
      lines.push(
        `  5-hour token usage: ${limit.percentage}% used (resets ${resetStr})`,
      );
    } else if (limit.type === 'TIME_LIMIT') {
      const currentValue = limit.currentValue ?? 0;
      const total = limit.usage ?? 0;
      const remaining = limit.remaining ?? 0;
      lines.push(
        `  MCP usage (monthly): ${currentValue}/${total} used (${remaining} remaining)`,
      );

      // Show tool breakdown if usage details are present
      if (limit.usageDetails) {
        for (const detail of limit.usageDetails) {
          if (detail.usage > 0) {
            lines.push(`    ${detail.modelCode}: ${detail.usage}`);
          }
        }
      }
    }
  }

  return lines;
}
