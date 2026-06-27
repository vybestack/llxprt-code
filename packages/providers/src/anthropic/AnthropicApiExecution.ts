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
import type { MessageCreateParamsBase } from '@anthropic-ai/sdk/resources/messages/index.js';
import type { DumpMode } from '../utils/dumpContext.js';
import {
  shouldDumpSDKContext,
  dumpSDKRequestContext,
  dumpSDKResponseContext,
  wrapStreamWithDump,
  wrapStreamWithSDKErrorDump,
  bestEffortDump,
  dumpSDKErrorRequestResponse,
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
 * The request body built by buildAnthropicRequestBody, which includes the
 * required SDK base fields (model, messages, max_tokens) plus optional
 * dynamic overrides from modelParams. The index signature preserves the
 * ability to carry dynamic fields at runtime while being assignable to
 * the SDK's create() overload that accepts MessageCreateParamsBase.
 */
type AnthropicRequestBody = MessageCreateParamsBase & {
  [key: string]: unknown;
};

/**
 * Narrows the dynamically-built request body to the SDK-accepted type.
 * The body is constructed by buildAnthropicRequestBody at runtime with
 * valid base fields. Since AnthropicRequestBody includes the index
 * signature, the single `as` narrowing from Record<string, unknown>
 * is structurally justified (the source carries all base fields).
 */
function asMessageCreateParams(
  body: Record<string, unknown>,
): AnthropicRequestBody {
  return body as AnthropicRequestBody;
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
  const params = asMessageCreateParams(requestBody);
  return async () => {
    const apiCall = () =>
      Object.keys(customHeaders).length > 0
        ? client.messages.create(params, { headers: customHeaders })
        : client.messages.create(params);

    const promise = apiCall();
    // The promise has a withResponse() method we can call
    if (typeof promise === 'object' && 'withResponse' in promise) {
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

async function dumpAnthropicRequest(
  params: ApiExecutionParams,
  shouldDumpSuccess: boolean,
): Promise<string | undefined> {
  if (!shouldDumpSuccess) {
    return undefined;
  }
  const reqResult = await bestEffortDump(
    'request',
    'anthropic',
    () =>
      dumpSDKRequestContext(
        'anthropic',
        '/v1/messages',
        params.requestBody,
        params.baseURL,
      ),
    params.rateLimitLogger,
  );
  return reqResult?.baseId;
}

async function dumpAnthropicApiError(
  params: ApiExecutionParams,
  error: unknown,
  requestBaseId: string | undefined,
): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  if (requestBaseId) {
    await bestEffortDump(
      'error-response',
      'anthropic',
      () =>
        dumpSDKResponseContext(
          requestBaseId,
          'anthropic',
          { error: errorMessage },
          true,
        ),
      params.rateLimitLogger,
    );
    return;
  }
  await dumpSDKErrorRequestResponse(
    'anthropic',
    '/v1/messages',
    params.requestBody,
    { error: errorMessage },
    params.baseURL,
    dumpSDKRequestContext,
    dumpSDKResponseContext,
  );
}

async function handleAnthropicSuccessDump(
  params: ApiExecutionParams,
  response: Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
  requestBaseId: string | undefined,
): Promise<Anthropic.Message | AsyncIterable<Anthropic.MessageStreamEvent>> {
  if (shouldDumpSuccess && requestBaseId) {
    if (params.streamingEnabled) {
      return wrapStreamWithDump(
        response as AsyncIterable<Anthropic.MessageStreamEvent>,
        requestBaseId,
        'anthropic',
        dumpSDKResponseContext,
      );
    }
    await bestEffortDump(
      'response',
      'anthropic',
      () => dumpSDKResponseContext(requestBaseId, 'anthropic', response, false),
      params.rateLimitLogger,
    );
    return response;
  }
  if (params.streamingEnabled && shouldDumpError) {
    return wrapStreamWithSDKErrorDump(
      response as AsyncIterable<Anthropic.MessageStreamEvent>,
      'anthropic',
      '/v1/messages',
      params.requestBody,
      params.baseURL,
      dumpSDKRequestContext,
      dumpSDKResponseContext,
    );
  }
  return response;
}

function extractAnthropicRateLimitInfo(
  response: Response | undefined,
  rateLimitLogger: ApiExecutionParams['rateLimitLogger'],
): {
  responseHeaders: Headers | undefined;
  rateLimitInfo: AnthropicRateLimitInfo | undefined;
} {
  if (!response) {
    return { responseHeaders: undefined, rateLimitInfo: undefined };
  }
  const responseHeaders = response.headers;
  const rateLimitInfo = extractRateLimitHeaders(
    responseHeaders,
    rateLimitLogger,
  );
  rateLimitLogger.debug(() => formatRateLimitSummary(rateLimitInfo));
  checkRateLimits(rateLimitInfo, rateLimitLogger);
  return { responseHeaders, rateLimitInfo };
}

/**
 * Execute Anthropic API call with dump context handling and rate limit extraction
 */
export async function executeAnthropicApiCall(
  params: ApiExecutionParams,
): Promise<ApiExecutionResult> {
  const shouldDumpSuccess = shouldDumpSDKContext(params.dumpMode, false);
  const shouldDumpError = shouldDumpSDKContext(params.dumpMode, true);
  const requestBaseId = await dumpAnthropicRequest(params, shouldDumpSuccess);

  try {
    const result = await params.apiCallFn();
    const rawResponse = result.data as
      | Anthropic.Message
      | AsyncIterable<Anthropic.MessageStreamEvent>;
    const response = await handleAnthropicSuccessDump(
      params,
      rawResponse,
      shouldDumpSuccess,
      shouldDumpError,
      requestBaseId,
    );
    return {
      response,
      ...extractAnthropicRateLimitInfo(result.response, params.rateLimitLogger),
    };
  } catch (error) {
    if (shouldDumpError) {
      await dumpAnthropicApiError(params, error, requestBaseId);
    }
    throw error;
  }
}
