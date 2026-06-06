/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from 'zod';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { fetchWithTimeout } from '@vybestack/llxprt-code-core/utils/fetch.js';

const logger = new DebugLogger('llxprt:gemini:usage');

const CODE_ASSIST_ENDPOINT = 'https://cloudcode-pa.googleapis.com';
const CODE_ASSIST_API_VERSION = 'v1internal';

/**
 * Schema for a single quota bucket from the CodeAssist retrieveUserQuota API
 */
export const GeminiBucketInfoSchema = z.object({
  remainingAmount: z.string().optional(),
  remainingFraction: z.number().optional(),
  resetTime: z.string().optional(),
  tokenType: z.string().optional(),
  modelId: z.string().optional(),
});

/**
 * Schema for the full retrieveUserQuota response
 */
export const GeminiQuotaResponseSchema = z.object({
  buckets: z.array(GeminiBucketInfoSchema).optional(),
});

export type GeminiBucketInfo = z.infer<typeof GeminiBucketInfoSchema>;
export type GeminiQuotaResponse = z.infer<typeof GeminiQuotaResponseSchema>;

/**
 * Fetch the user's project ID from the CodeAssist loadCodeAssist endpoint.
 * This is needed before calling retrieveUserQuota.
 */
async function fetchProjectId(accessToken: string): Promise<string | null> {
  const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`;

  try {
    const response = await fetchWithTimeout(url, 10_000, undefined, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
        },
      }),
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `loadCodeAssist returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = (await response.json()) as Record<string, unknown>;
    const projectId = data.cloudaicompanionProject;
    if (typeof projectId === 'string' && projectId.length > 0) {
      return projectId;
    }

    logger.debug(() => 'loadCodeAssist returned no cloudaicompanionProject');
    return null;
  } catch (error) {
    logger.debug(
      () =>
        `loadCodeAssist error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Fetch Gemini quota information from the CodeAssist retrieveUserQuota endpoint.
 * Requires a Google OAuth access token from the token store.
 *
 * Two-step process:
 * 1. Call loadCodeAssist to obtain the user's projectId
 * 2. Call retrieveUserQuota with that projectId to get per-model bucket quota info
 *
 * @param accessToken - Google OAuth access token
 * @returns Quota info if available, null on error
 */
export async function fetchGeminiQuota(
  accessToken: string,
): Promise<GeminiQuotaResponse | null> {
  if (!accessToken || typeof accessToken !== 'string') {
    logger.debug(() => 'Invalid access token provided');
    return null;
  }

  try {
    // Step 1: Get the projectId
    const projectId = await fetchProjectId(accessToken);
    if (!projectId) {
      logger.debug(() => 'Could not obtain projectId, skipping quota fetch');
      return null;
    }

    // Step 2: Fetch quota
    const url = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:retrieveUserQuota`;
    const response = await fetchWithTimeout(url, 10_000, undefined, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project: projectId }),
    });

    if (!response.ok) {
      logger.debug(
        () =>
          `retrieveUserQuota returned ${response.status}: ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();
    const parsed = GeminiQuotaResponseSchema.safeParse(data);

    if (!parsed.success) {
      logger.debug(
        () => `Failed to parse quota response: ${parsed.error.message}`,
      );
      return null;
    }

    return parsed.data;
  } catch (error) {
    logger.debug(
      () =>
        `fetchGeminiQuota error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
