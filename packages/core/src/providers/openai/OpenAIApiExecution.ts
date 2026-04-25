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
  const {
    client,
    requestBody,
    abortSignal,
    mergedHeaders,
    dumpMode,
    baseURL,
    model,
    formattedTools,
    streamingEnabled,
    logger,
    getBaseURL,
  } = opts;

  const shouldDumpSuccess = shouldDumpSDKContext(dumpMode, false);
  const shouldDumpError = shouldDumpSDKContext(dumpMode, true);

  if (streamingEnabled) {
    try {
      const response = await client.chat.completions.create(requestBody, {
        ...(abortSignal ? { signal: abortSignal } : {}),
        ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      });

      // Dump successful streaming request if enabled
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
      // Special handling for Cerebras/Qwen "Tool not present" errors
      const errorMessage = String(error);
      if (
        errorMessage.includes('Tool is not present in the tools list') &&
        (model.toLowerCase().includes('qwen') ||
          getBaseURL()?.includes('cerebras'))
      ) {
        logger.error(
          'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
          {
            error,
            model,
            toolsProvided: formattedTools?.length ?? 0,
            toolNames: formattedTools?.map((t) => t.function.name),
            streamingEnabled,
          },
        );
        const enhancedError = new Error(
          `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length ?? 0} tools. Known API issue.`,
        );
        (enhancedError as Error & { originalError?: unknown }).originalError =
          error;
        throw enhancedError;
      }

      // Dump error if enabled
      if (shouldDumpError) {
        const dumpErrorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'openai',
          '/chat/completions',
          requestBody,
          { error: dumpErrorMessage },
          true,
          baseURL ?? 'https://api.openai.com/v1',
        );
      }

      // Re-throw other errors
      const capturedErrorMessage =
        error instanceof Error ? error.message : String(error);
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;

      logger.error(
        () =>
          `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
        {
          model,
          baseURL: baseURL ?? getBaseURL(),
          streamingEnabled,
          hasTools: formattedTools?.length ?? 0,
          status,
        },
      );
      throw error;
    }
  } else {
    try {
      const response = (await client.chat.completions.create(requestBody, {
        ...(abortSignal ? { signal: abortSignal } : {}),
        ...(mergedHeaders ? { headers: mergedHeaders } : {}),
      })) as OpenAI.Chat.Completions.ChatCompletion;

      // Dump successful non-streaming request if enabled
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
      logger.debug(() => `[OpenAIProvider] Chat request error`, {
        errorType: error?.constructor?.name,
        status:
          typeof error === 'object' && error && 'status' in error
            ? (error as { status?: number }).status
            : undefined,
        errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
      });

      const isCerebrasToolError =
        errorMessage.includes('Tool is not present in the tools list') &&
        (model.toLowerCase().includes('qwen') ||
          getBaseURL()?.includes('cerebras'));

      if (isCerebrasToolError) {
        logger.error(
          'Cerebras/Qwen API error: Tool not found despite being in request. This is a known API issue.',
          {
            error,
            model,
            toolsProvided: formattedTools?.length ?? 0,
            toolNames: formattedTools?.map((t) => t.function.name),
            streamingEnabled,
          },
        );
        const enhancedError = new Error(
          `Cerebras/Qwen API bug: Tool not found in list. We sent ${formattedTools?.length ?? 0} tools. Known API issue.`,
        );
        (enhancedError as Error & { originalError?: unknown }).originalError =
          error;
        throw enhancedError;
      }

      // Dump error if enabled
      if (shouldDumpError) {
        const dumpErrorMessage =
          error instanceof Error ? error.message : String(error);
        await dumpSDKContext(
          'openai',
          '/chat/completions',
          requestBody,
          { error: dumpErrorMessage },
          true,
          baseURL ?? 'https://api.openai.com/v1',
        );
      }

      const capturedErrorMessage =
        error instanceof Error ? error.message : String(error);
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status: unknown }).status === 'number'
          ? (error as { status: number }).status
          : undefined;

      logger.error(
        () =>
          `[OpenAIProvider] Chat completion failed for model '${model}' at '${baseURL ?? getBaseURL() ?? 'default'}': ${capturedErrorMessage}`,
        {
          model,
          baseURL: baseURL ?? getBaseURL(),
          streamingEnabled,
          hasTools: formattedTools?.length ?? 0,
          status,
        },
      );
      throw error;
    }
  }
}
