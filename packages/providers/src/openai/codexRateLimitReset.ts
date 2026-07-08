/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';

const logger = new DebugLogger('llxprt:openai:codex:reset');

/**
 * Schema for a single rate-limit-reset credit.
 * Uses passthrough to tolerate additional fields from upstream.
 */
export const CodexRateLimitResetCreditSchema = z
  .object({
    id: z.string(),
  })
  .passthrough();

/**
 * Schema for the GET /wham/rate-limit-reset-credits response.
 * The rate_limit_reset_credits object is optional at the schema layer so a
 * response that omits it can degrade gracefully (see normalizeResetCredits);
 * downstream consumers always receive a populated object.
 */
export const CodexRateLimitResetCreditsResponseSchema = z
  .object({
    rate_limit_reset_credits: z
      .object({
        available_count: z.number().int().nonnegative(),
        credits: z.array(CodexRateLimitResetCreditSchema),
      })
      .optional(),
  })
  .passthrough();

/**
 * Schema for the POST /wham/rate-limit-reset-credits/consume response.
 */
export const CodexConsumeResetCreditResponseSchema = z
  .object({
    code: z.enum(['reset', 'already_redeemed']),
    credit: z.object({ id: z.string() }).passthrough().optional(),
  })
  .passthrough();

/**
 * A single rate-limit-reset credit.
 */
export type CodexRateLimitResetCredit = z.infer<
  typeof CodexRateLimitResetCreditSchema
>;

/**
 * Response shape for the list reset-credits endpoint.
 */
export type CodexRateLimitResetCreditsResponse = z.infer<
  typeof CodexRateLimitResetCreditsResponseSchema
>;

/**
 * Response shape for the consume reset-credit endpoint.
 */
export type CodexConsumeResetCreditResponse = z.infer<
  typeof CodexConsumeResetCreditResponseSchema
>;

const DEFAULT_BACKEND_API_ROOT = 'https://chatgpt.com/backend-api';

/**
 * Normalize a base URL by trimming and removing trailing slashes.
 * Mirrors the behavior of normalizeBaseUrl in codexUsageInfo.ts so that
 * base-url resolution stays consistent across both modules.
 */
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

/**
 * Derive the backend-api root for the reset-credits endpoints.
 * Matches buildCodexUsageEndpoints: a /backend-api/codex segment is reduced
 * to /backend-api; any other /backend-api URL is used as-is. Falls back to
 * the ChatGPT backend-api root when no usable base URL is provided.
 */
function resolveBackendApiRoot(baseUrl?: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);

  if (normalizedBaseUrl) {
    if (normalizedBaseUrl.includes('/backend-api/codex')) {
      return normalizedBaseUrl.replace('/backend-api/codex', '/backend-api');
    }
    if (normalizedBaseUrl.includes('/backend-api')) {
      return normalizedBaseUrl;
    }
    logger.debug(
      () =>
        `Base URL "${normalizedBaseUrl}" does not contain /backend-api; falling back to ${DEFAULT_BACKEND_API_ROOT}`,
    );
  }

  return DEFAULT_BACKEND_API_ROOT;
}

/**
 * Build the list + consume endpoint URLs from an optional base URL.
 */
function buildResetEndpoints(baseUrl?: string): {
  list: string;
  consume: string;
} {
  const root = resolveBackendApiRoot(baseUrl);
  return {
    list: `${root}/wham/rate-limit-reset-credits`,
    consume: `${root}/wham/rate-limit-reset-credits/consume`,
  };
}

/**
 * Defensive normalization: a response missing the rate_limit_reset_credits
 * object degrades to available_count 0 / empty credits rather than throwing,
 * mirroring the null-handling approach in codexUsageInfo.
 */
function normalizeResetCredits(
  parsed: CodexRateLimitResetCreditsResponse,
): CodexRateLimitResetCreditsResponse {
  const credits = parsed.rate_limit_reset_credits ?? {
    available_count: 0,
    credits: [],
  };
  return {
    ...parsed,
    rate_limit_reset_credits: {
      available_count: credits.available_count,
      credits: credits.credits,
    },
  };
}

/**
 * Fetch available rate-limit-reset credits from Codex.
 * Requires an OAuth access token and account_id from Codex authentication.
 *
 * @param accessToken - OAuth access token
 * @param accountId - Account ID for the ChatGPT-Account-Id header
 * @param baseUrl - Optional Codex base URL for endpoint resolution
 * @returns Reset-credits response if available, null on error
 */
export async function fetchCodexRateLimitResetCredits(
  accessToken: string,
  accountId: string,
  baseUrl?: string,
): Promise<CodexRateLimitResetCreditsResponse | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    logger.debug(() => 'Invalid access token provided');
    return null;
  }

  if (!accountId || typeof accountId !== 'string') {
    logger.debug(() => 'Invalid account ID provided');
    return null;
  }

  const endpoints = buildResetEndpoints(baseUrl);

  try {
    const response = await fetch(endpoints.list, {
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
          `Reset credits endpoint ${endpoints.list} returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    const parsedData = CodexRateLimitResetCreditsResponseSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse reset credits response from ${endpoints.list}: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    const normalized = normalizeResetCredits(parsedData.data);
    logger.debug(
      () =>
        `Fetched Codex reset credits from ${endpoints.list}: ${JSON.stringify(normalized)}`,
    );

    return normalized;
  } catch (error) {
    logger.debug(
      () =>
        `Error fetching Codex reset credits from ${endpoints.list}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Consume (redeem) a single rate-limit-reset credit to reset the rate-limit window.
 *
 * @param accessToken - OAuth access token
 * @param accountId - Account ID for the ChatGPT-Account-Id header
 * @param creditId - The id of the credit to redeem
 * @param redeemRequestId - Idempotency id for the redemption request
 * @param baseUrl - Optional Codex base URL for endpoint resolution
 * @returns Consume response if successful, null on error
 */
export async function consumeCodexRateLimitResetCredit(
  accessToken: string,
  accountId: string,
  creditId: string,
  redeemRequestId: string,
  baseUrl?: string,
): Promise<CodexConsumeResetCreditResponse | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    logger.debug(() => 'Invalid access token provided');
    return null;
  }

  if (!accountId || typeof accountId !== 'string') {
    logger.debug(() => 'Invalid account ID provided');
    return null;
  }

  if (!creditId || typeof creditId !== 'string') {
    logger.debug(() => 'Invalid credit ID provided');
    return null;
  }

  if (!redeemRequestId || typeof redeemRequestId !== 'string') {
    logger.debug(() => 'Invalid redeem request ID provided');
    return null;
  }

  const endpoints = buildResetEndpoints(baseUrl);

  try {
    const response = await fetch(endpoints.consume, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'ChatGPT-Account-Id': accountId,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        credit_id: creditId,
        redeem_request_id: redeemRequestId,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `Consume reset credit endpoint ${endpoints.consume} returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    const parsedData = CodexConsumeResetCreditResponseSchema.safeParse(data);
    if (!parsedData.success) {
      logger.debug(
        () =>
          `Failed to parse consume reset credit response from ${endpoints.consume}: ${JSON.stringify(parsedData.error)}`,
      );
      return null;
    }

    logger.debug(
      () =>
        `Consumed Codex reset credit from ${endpoints.consume}: ${JSON.stringify(parsedData.data)}`,
    );

    return parsedData.data;
  } catch (error) {
    logger.debug(
      () =>
        `Error consuming Codex reset credit from ${endpoints.consume}: ${
          error instanceof Error ? error.message : String(error)
        }`,
    );
    return null;
  }
}

/**
 * Format available rate-limit-reset credits for display.
 * Returns lines using the two-space-indent style of formatCodexUsage.
 *
 * @param data - Parsed reset-credits response
 * @returns Formatted lines, or an empty array when no credits are available
 */
export function formatCodexResetCredits(
  data: CodexRateLimitResetCreditsResponse,
): string[] {
  const lines: string[] = [];
  const resetCredits = data.rate_limit_reset_credits;
  if (!resetCredits) {
    return lines;
  }
  const { available_count: availableCount, credits } = resetCredits;

  if (availableCount === 0 || credits.length === 0) {
    return lines;
  }

  lines.push(`  Available reset credits: ${availableCount}`);

  for (const credit of credits) {
    lines.push(`  - ${credit.id}`);
  }

  return lines;
}
