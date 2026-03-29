/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic API Execution Module
 * Handles API call creation, header building, and execution with error handling
 *
 * @issue #1572 - Decomposing AnthropicProvider (Step 5)
 */

import type Anthropic from '@anthropic-ai/sdk';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import {
  type AnthropicRateLimitInfo,
  extractRateLimitHeaders,
  checkRateLimits,
  formatRateLimitSummary,
} from './AnthropicRateLimitHandler.js';

/**
 * Merge beta headers, ensuring no duplicates
 */
export function mergeBetaHeaders(
  existing: string | undefined,
  addition: string,
): string {
  if (!existing) return addition;
  const parts = new Set(
    existing
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  parts.add(addition);
  return Array.from(parts).join(', ');
}

/**
 * Build custom headers for Anthropic API request
 */
export function buildAnthropicCustomHeaders(params: {
  baseHeaders: Record<string, string>;
  isOAuth: boolean;
  wantCaching: boolean;
  ttl: '5m' | '1h';
  cacheLogger: { debug: (fn: () => string) => void };
}): Record<string, string> {
  const { baseHeaders, isOAuth, wantCaching, ttl, cacheLogger } = params;

  let customHeaders = { ...baseHeaders };

  // For OAuth, always include the oauth beta header in customHeaders
  // to ensure it's not overridden by cache headers
  if (isOAuth) {
    const existingBeta = customHeaders['anthropic-beta'] as string | undefined;
    const betaWithOAuth = mergeBetaHeaders(existingBeta, 'oauth-2025-04-20');
    const betaWithThinking = mergeBetaHeaders(
      betaWithOAuth,
      'interleaved-thinking-2025-05-14',
    );
    customHeaders = {
      ...customHeaders,
      'anthropic-beta': betaWithThinking,
      'User-Agent': 'claude-cli/2.1.2 (external, cli)',
    };
  }

  // Add extended-cache-ttl beta header for 1h caching
  if (wantCaching && ttl === '1h') {
    const existingBeta = customHeaders['anthropic-beta'] as string | undefined;
    customHeaders = {
      ...customHeaders,
      'anthropic-beta': mergeBetaHeaders(
        existingBeta,
        'extended-cache-ttl-2025-04-11',
      ),
    };
    cacheLogger.debug(
      () => 'Added extended-cache-ttl-2025-04-11 beta header for 1h caching',
    );
  }

  return customHeaders;
}

/**
 * Create API call closure with response headers
 */
export function createAnthropicApiCall(
  client: Anthropic,
  requestBody: Record<string, unknown>,
  customHeaders: Record<string, string>,
): () => Promise<{
  data: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
  response: Response | undefined;
}> {
  return async () => {
    const apiCall = () =>
      Object.keys(customHeaders).length > 0
        ? client.messages.create(
            requestBody as unknown as Parameters<
              typeof client.messages.create
            >[0],
            { headers: customHeaders },
          )
        : client.messages.create(
            requestBody as unknown as Parameters<
              typeof client.messages.create
            >[0],
          );

    const promise = apiCall();
    // The promise has a withResponse() method we can call
    if (promise && typeof promise === 'object' && 'withResponse' in promise) {
      return (
        promise as {
          withResponse: () => Promise<{
            data:
              | Anthropic.Message
              | AsyncIterable<Anthropic.MessageStreamEvent>;
            response: Response;
          }>;
        }
      ).withResponse();
    }
    // Fallback if withResponse is not available
    return {
      data: await Promise.resolve(promise),
      response: undefined,
    };
  };
}

/**
 * Parameters for API execution
 */
export interface ApiExecutionParams {
  apiCallFn: () => Promise<{
    data: unknown;
    response: Response | undefined;
  }>;
  dumpMode: DumpMode | undefined;
  baseURL: string;
  requestBody: Record<string, unknown>;
  streamingEnabled: boolean;
  rateLimitLogger: { debug: (fn: () => string) => void };
}

/**
 * Result of API execution
 */
export interface ApiExecutionResult {
  response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
  responseHeaders: Headers | undefined;
  rateLimitInfo?: AnthropicRateLimitInfo;
}

/**
 * Execute Anthropic API call with dump context handling and rate limit extraction
 */
export async function executeAnthropicApiCall(
  params: ApiExecutionParams,
): Promise<ApiExecutionResult> {
  const {
    apiCallFn,
    dumpMode,
    baseURL,
    requestBody,
    streamingEnabled,
    rateLimitLogger,
  } = params;

  const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
  const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

  let responseHeaders: Headers | undefined;
  let response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>;
  let rateLimitInfo: AnthropicRateLimitInfo | undefined;

  try {
    // REQ-RETRY-001: Retry logic is now handled by RetryOrchestrator at a higher level
    const result = await apiCallFn();

    response = result.data as
      | Anthropic.Message
      | AsyncIterable<Anthropic.MessageStreamEvent>;

    // Dump successful request if enabled
    if (shouldDumpSuccess) {
      await dumpSDKContext(
        'anthropic',
        '/v1/messages',
        requestBody,
        streamingEnabled ? { streaming: true } : response,
        false,
        baseURL,
      );
    }

    if (result.response != null) {
      responseHeaders = result.response.headers;

      // Extract and process rate limit headers
      rateLimitInfo = extractRateLimitHeaders(responseHeaders, rateLimitLogger);

      if (rateLimitInfo) {
        const info = rateLimitInfo;
        rateLimitLogger.debug(() => formatRateLimitSummary(info));

        // Check and warn if approaching limits
        checkRateLimits(info, rateLimitLogger);
      }
    }
  } catch (error) {
    // Dump error if enabled
    if (shouldDumpError) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await dumpSDKContext(
        'anthropic',
        '/v1/messages',
        requestBody,
        { error: errorMessage },
        true,
        baseURL,
      );
    }

    // Re-throw the error
    throw error;
  }

  return { response, responseHeaders, rateLimitInfo };
}
