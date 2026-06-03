/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* eslint-disable complexity, sonarjs/cognitive-complexity -- Phase 5: legacy provider boundary retained while larger decomposition continues. */

import type OpenAI from 'openai';
import { type DebugLogger } from '../../debug/index.js';
import {
  shouldDumpSDKContext,
  dumpSDKContext,
} from '../utils/dumpSDKContext.js';
import { type DumpMode } from '../utils/dumpContext.js';
import { type OpenAITool } from './schemaConverter.js';

export interface ApiExecutionOptions {
  client: OpenAI;
  requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  abortSignal: AbortSignal | undefined;
  mergedHeaders: Record<string, string> | undefined;
  dumpMode: DumpMode | undefined;
  baseURL: string | undefined;
  model: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  logger: DebugLogger;
  getBaseURL: () => string | undefined;
}

interface ErrorContext {
  requestBody: OpenAI.Chat.ChatCompletionCreateParams;
  shouldDumpError: boolean;
  baseURL: string | undefined;
  model: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  logger: DebugLogger;
  getBaseURL: () => string | undefined;
}

/**
 * Check for Cerebras/Qwen "Tool not present" errors and throw enhanced error.
 * Returns true if the error was a Cerebras tool error (caller should not continue).
 */
function handleCerebrasToolError(
  error: unknown,
  errorMessage: string,
  resolvedBaseURL: string | undefined,
  ctx: ErrorContext,
): boolean {
  if (
    !errorMessage.includes('Tool is not present in the tools list') ||
    (!ctx.model.toLowerCase().includes('qwen') &&
      !(resolvedBaseURL?.includes('cerebras') ?? false))
  ) {
    return false;
  }
  ctx.logger.error(
    'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
    {
      error,
      model: ctx.model,
      toolsProvided: ctx.formattedTools?.length ?? 0,
      toolNames: ctx.formattedTools?.map((t) => t.function.name),
      streamingEnabled: ctx.streamingEnabled,
    },
  );
  const enhancedError = new Error(
    `Cerebras/Qwen API bug: Tool not found in list. We sent ${ctx.formattedTools?.length ?? 0} tools. Known API issue.`,
  );
  (enhancedError as Error & { originalError?: unknown }).originalError = error;
  throw enhancedError;
}

/**
 * Dump error context, log the failure, and re-throw.
 */
async function handleApiError(
  error: unknown,
  ctx: ErrorContext,
): Promise<never> {
  const resolvedBaseURL = ctx.baseURL ?? ctx.getBaseURL();

  if (ctx.shouldDumpError) {
    const dumpErrorMessage =
      error instanceof Error ? error.message : String(error);
    await dumpSDKContext(
      'openai',
      '/chat/completions',
      ctx.requestBody,
      { error: dumpErrorMessage },
      true,
      resolvedBaseURL ?? 'https://api.openai.com/v1',
    );
  }

  const capturedErrorMessage =
    error instanceof Error ? error.message : String(error);
  const status =
    // eslint-disable-next-line sonarjs/expression-complexity -- Existing structure is intentionally preserved; refactoring this boundary is outside the lint slice.
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    typeof (error as { status: unknown }).status === 'number'
      ? (error as { status: number }).status
      : undefined;

  ctx.logger.error(
    () =>
      `[OpenAIProvider] Chat completion failed for model '${ctx.model}' at '${resolvedBaseURL ?? 'default'}': ${capturedErrorMessage}`,
    {
      model: ctx.model,
      baseURL: resolvedBaseURL,
      streamingEnabled: ctx.streamingEnabled,
      hasTools: ctx.formattedTools?.length ?? 0,
      status,
    },
  );
  throw error;
}

/**
 * Execute streaming API request with dump and error handling.
 */
async function executeStreamingRequest(
  opts: ApiExecutionOptions,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const { client, requestBody, abortSignal, mergedHeaders, baseURL } = opts;

  try {
    const response = (await client.chat.completions.create(requestBody, {
      ...(abortSignal ? { signal: abortSignal } : {}),
      ...(mergedHeaders ? { headers: mergedHeaders } : {}),
    })) as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;

    if (shouldDumpSuccess) {
      await dumpSDKContext(
        'openai',
        '/chat/completions',
        requestBody,
        { streaming: true },
        false,
        baseURL ?? 'https://api.openai.com/v1',
      );
    }

    return response;
  } catch (error) {
    const errorMessage = String(error);
    const resolvedBaseURL = opts.getBaseURL();

    const ctx: ErrorContext = {
      requestBody,
      shouldDumpError,
      baseURL,
      model: opts.model,
      formattedTools: opts.formattedTools,
      streamingEnabled: opts.streamingEnabled,
      logger: opts.logger,
      getBaseURL: opts.getBaseURL,
    };

    if (!handleCerebrasToolError(error, errorMessage, resolvedBaseURL, ctx)) {
      await handleApiError(error, ctx);
    }
    // handleApiError always throws; handleCerebrasToolError throws on match
    // This line is unreachable but satisfies the type system.
    throw error;
  }
}

/**
 * Execute non-streaming API request with dump and error handling.
 */
async function executeNonStreamingRequest(
  opts: ApiExecutionOptions,
  shouldDumpSuccess: boolean,
  shouldDumpError: boolean,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { client, requestBody, abortSignal, mergedHeaders, baseURL } = opts;

  try {
    const response = (await client.chat.completions.create(requestBody, {
      ...(abortSignal ? { signal: abortSignal } : {}),
      ...(mergedHeaders ? { headers: mergedHeaders } : {}),
    })) as OpenAI.Chat.Completions.ChatCompletion;

    if (shouldDumpSuccess) {
      await dumpSDKContext(
        'openai',
        '/chat/completions',
        requestBody,
        response,
        false,
        baseURL ?? 'https://api.openai.com/v1',
      );
    }

    return response;
  } catch (error) {
    const errorMessage = String(error);
    const resolvedBaseURL = opts.getBaseURL();

    opts.logger.debug(() => `[OpenAIProvider] Chat request error`, {
      errorType: error?.constructor?.name,
      status:
        typeof error === 'object' && error !== null && 'status' in error
          ? (error as { status?: number }).status
          : undefined,
      errorKeys:
        error !== null && typeof error === 'object' ? Object.keys(error) : [],
    });

    const ctx: ErrorContext = {
      requestBody,
      shouldDumpError,
      baseURL,
      model: opts.model,
      formattedTools: opts.formattedTools,
      streamingEnabled: opts.streamingEnabled,
      logger: opts.logger,
      getBaseURL: opts.getBaseURL,
    };

    if (!handleCerebrasToolError(error, errorMessage, resolvedBaseURL, ctx)) {
      await handleApiError(error, ctx);
    }
    // handleApiError always throws; handleCerebrasToolError throws on match
    // This line is unreachable but satisfies the type system.
    throw error;
  }
}

/**
 * Execute OpenAI API request with error handling
 * Handles both streaming and non-streaming calls
 */
export async function executeApiRequest(
  opts: ApiExecutionOptions,
): Promise<
  | AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>
  | OpenAI.Chat.Completions.ChatCompletion
> {
  const { dumpMode, streamingEnabled } = opts;

  const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
  const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

  if (streamingEnabled) {
    return executeStreamingRequest(opts, shouldDumpSuccess, shouldDumpError);
  }
  return executeNonStreamingRequest(opts, shouldDumpSuccess, shouldDumpError);
}
