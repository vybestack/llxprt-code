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
import { type DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  shouldDumpSDKContext,
  dumpSDKRequestContext,
  dumpSDKResponseContext,
  wrapStreamWithDump,
  wrapStreamWithSDKErrorDump,
  bestEffortDump,
  dumpSDKErrorRequestResponse,
  type RequestDumpMetadata,
} from '../utils/dumpSDKContext.js';
import { type DumpMode } from '../utils/dumpContext.js';
import { type OpenAITool } from './schemaConverter.js';
import { withBoundedJsonHttpBody } from '../utils/boundedJsonBody.js';
import {
  withSpooledJsonHttpBody,
  type WireBodySpool,
} from '../utils/wire-body-spool.js';
import { readSpooledChatBody } from './OpenAIChatSpooledBody.js';

interface OpenAIRawPostOptions {
  readonly body: unknown;
  readonly headers: Record<string, string>;
  readonly signal?: AbortSignal;
  readonly stream: boolean;
}

export interface OpenAIRawPostClient {
  post(path: string, options: OpenAIRawPostOptions): Promise<unknown>;
  /**
   * #3159 synthesizes the Authorization header for dumps from the client key,
   * which the narrowed raw-post surface would otherwise hide.
   */
  readonly apiKey?: string | undefined;
}

export interface ApiExecutionOptions {
  client: OpenAIRawPostClient;
  /** The sealed request body; it is streamed with Content-Length equal to its size. */
  spool: WireBodySpool;
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

/** #3159: the OpenAI SDK sends Authorization from the client api key; record
 * the header NAME in dump metadata (shared redaction replaces the value).
 */
function hasHeaderName(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function chatDumpMetadata(
  mergedHeaders: Record<string, string> | undefined,
  apiKey: string | undefined,
): RequestDumpMetadata {
  // The SDK sends Authorization from the client api key; synthesize the
  // header for the dump unless the caller already supplied one (#3159).
  // A null/empty key means the SDK sends no Authorization header, so the
  // dump must not invent one.
  if (
    !apiKey ||
    (mergedHeaders !== undefined &&
      hasHeaderName(mergedHeaders, 'Authorization'))
  ) {
    return { headers: mergedHeaders, transport: { type: 'http' } };
  }
  return {
    headers: { ...mergedHeaders, Authorization: `Bearer ${apiKey}` },
    transport: { type: 'http' },
  };
}

interface ErrorContext {
  /** Present only when error dumps are on. */
  errorDumpBody: OpenAI.Chat.ChatCompletionCreateParams | undefined;
  requestBaseId: string | undefined;
  baseURL: string | undefined;
  mergedHeaders: Record<string, string> | undefined;
  apiKey: string | undefined;
  model: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  logger: DebugLogger;
  getBaseURL: () => string | undefined;
}

/**
 * Write OpenAI request/response error dumps when error-mode dumping is enabled.
 */
async function dumpOpenAIErrorContext(
  error: unknown,
  resolvedBaseURL: string | undefined,
  ctx: ErrorContext,
): Promise<void> {
  const errorDumpBody = ctx.errorDumpBody;
  if (errorDumpBody === undefined) {
    return;
  }

  const dumpErrorMessage =
    error instanceof Error ? error.message : String(error);
  if (ctx.requestBaseId) {
    await bestEffortDump('error-response', 'openai', () =>
      dumpSDKResponseContext(
        ctx.requestBaseId,
        'openai',
        { error: dumpErrorMessage },
        true,
      ),
    );
  } else {
    await dumpSDKErrorRequestResponse(
      'openai',
      '/chat/completions',
      errorDumpBody,
      { error: dumpErrorMessage },
      resolvedBaseURL ?? 'https://api.openai.com/v1',
      dumpSDKRequestContext,
      dumpSDKResponseContext,
      chatDumpMetadata(ctx.mergedHeaders, ctx.apiKey),
    );
  }
}

/**
 * Extract a numeric HTTP status from an unknown error object, if present.
 */
function resolveErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }
  const status = (error as { status: unknown }).status;
  return typeof status === 'number' ? status : undefined;
}

/**
 * Check for Cerebras/Qwen "Tool not present" errors and throw enhanced error.
 * Returns true if the error was a Cerebras tool error (caller should not continue).
 */
async function handleCerebrasToolError(
  error: unknown,
  errorMessage: string,
  resolvedBaseURL: string | undefined,
  ctx: ErrorContext,
): Promise<boolean> {
  if (
    !errorMessage.includes('Tool is not present in the tools list') ||
    (!ctx.model.toLowerCase().includes('qwen') &&
      !(resolvedBaseURL?.includes('cerebras') ?? false))
  ) {
    return false;
  }

  await dumpOpenAIErrorContext(error, resolvedBaseURL, ctx);

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

  await dumpOpenAIErrorContext(error, resolvedBaseURL, ctx);

  const capturedErrorMessage =
    error instanceof Error ? error.message : String(error);
  const status = resolveErrorStatus(error);

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

function boundedJsonHeaders(
  byteLength: number,
  customHeaders: Record<string, string> | undefined,
): Record<string, string> {
  return {
    ...(customHeaders ?? {}),
    'content-type': 'application/json',
    'content-length': String(byteLength),
  };
}

function isAsyncChatCompletionStream(
  value: unknown,
): value is AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === 'function'
  );
}

function isChatCompletion(
  value: unknown,
): value is OpenAI.Chat.Completions.ChatCompletion {
  return (
    typeof value === 'object' &&
    value !== null &&
    'choices' in value &&
    Array.isArray(value.choices)
  );
}

/**
 * Posts a body that exists as an object. Only the continuation request does
 * this, because it rewrites the messages of the first request (issue #854 D4).
 */
export async function executeBoundedStreamingChatRequest(
  client: OpenAIRawPostClient,
  requestBody: OpenAI.Chat.ChatCompletionCreateParams,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const response = await withBoundedJsonHttpBody(requestBody, (body) =>
    client.post('/chat/completions', {
      body: body.stream,
      headers: boundedJsonHeaders(body.byteLength, mergedHeaders),
      stream: true,
      ...(abortSignal === undefined ? {} : { signal: abortSignal }),
    }),
  );
  if (!isAsyncChatCompletionStream(response)) {
    throw new TypeError('OpenAI streaming response is not async iterable');
  }
  return response;
}

async function executeSpooledStreamingChatRequest(
  client: OpenAIRawPostClient,
  spool: WireBodySpool,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const response = await withSpooledJsonHttpBody(spool, (body) =>
    client.post('/chat/completions', {
      body: body.stream,
      headers: boundedJsonHeaders(body.byteLength, mergedHeaders),
      stream: true,
      ...(abortSignal === undefined ? {} : { signal: abortSignal }),
    }),
  );
  if (!isAsyncChatCompletionStream(response)) {
    throw new TypeError('OpenAI streaming response is not async iterable');
  }
  return response;
}

async function executeSpooledNonStreamingChatRequest(
  client: OpenAIRawPostClient,
  spool: WireBodySpool,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await withSpooledJsonHttpBody(spool, (body) =>
    client.post('/chat/completions', {
      body: body.stream,
      headers: boundedJsonHeaders(body.byteLength, mergedHeaders),
      stream: false,
      ...(abortSignal === undefined ? {} : { signal: abortSignal }),
    }),
  );
  if (!isChatCompletion(response)) {
    throw new TypeError('OpenAI response does not contain a choices array');
  }
  return response;
}

/**
 * The body as an object for the dump contexts, read from the spool only when a
 * dump mode needs it (issue #854 D3c moves dumps onto the spool bytes).
 */
interface DumpBodies {
  readonly success: OpenAI.Chat.ChatCompletionCreateParams | undefined;
  readonly error: OpenAI.Chat.ChatCompletionCreateParams | undefined;
}

function readDumpBodies(opts: ApiExecutionOptions): DumpBodies {
  const wantsSuccess = shouldDumpSDKContext(opts.dumpMode, false);
  const wantsError = shouldDumpSDKContext(opts.dumpMode, true);
  if (!wantsSuccess && !wantsError) {
    return { success: undefined, error: undefined };
  }
  const body = readSpooledChatBody(opts.spool);
  return {
    success: wantsSuccess ? body : undefined,
    error: wantsError ? body : undefined,
  };
}

/**
 * Execute streaming API request with dump and error handling.
 */
async function executeStreamingRequest(
  opts: ApiExecutionOptions,
  dump: DumpBodies,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const { client, spool, abortSignal, mergedHeaders, baseURL } = opts;
  const { success: successBody, error: errorBody } = dump;

  let requestBaseId: string | undefined;

  if (successBody !== undefined) {
    const reqResult = await bestEffortDump(
      'request',
      'openai',
      () =>
        dumpSDKRequestContext(
          'openai',
          '/chat/completions',
          successBody,
          baseURL ?? 'https://api.openai.com/v1',
          chatDumpMetadata(mergedHeaders, client.apiKey),
        ),
      opts.logger,
    );
    requestBaseId = reqResult?.baseId;
  }

  try {
    const response = await executeSpooledStreamingChatRequest(
      client,
      spool,
      abortSignal,
      mergedHeaders,
    );

    if (successBody !== undefined && requestBaseId) {
      return wrapStreamWithDump(
        response,
        requestBaseId,
        'openai',
        dumpSDKResponseContext,
      );
    }

    if (errorBody !== undefined) {
      return wrapStreamWithSDKErrorDump(
        response,
        'openai',
        '/chat/completions',
        errorBody,
        baseURL ?? 'https://api.openai.com/v1',
        dumpSDKRequestContext,
        dumpSDKResponseContext,
        chatDumpMetadata(mergedHeaders, client.apiKey),
      );
    }

    return response;
  } catch (error) {
    const errorMessage = String(error);
    const resolvedBaseURL = opts.baseURL ?? opts.getBaseURL();

    const ctx: ErrorContext = {
      errorDumpBody: errorBody,
      requestBaseId,
      baseURL,
      mergedHeaders: opts.mergedHeaders,
      apiKey: opts.client.apiKey,
      model: opts.model,
      formattedTools: opts.formattedTools,
      streamingEnabled: opts.streamingEnabled,
      logger: opts.logger,
      getBaseURL: opts.getBaseURL,
    };

    if (
      !(await handleCerebrasToolError(
        error,
        errorMessage,
        resolvedBaseURL,
        ctx,
      ))
    ) {
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
  dump: DumpBodies,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const { client, spool, abortSignal, mergedHeaders, baseURL } = opts;
  const { success: successBody, error: errorBody } = dump;

  let requestBaseId: string | undefined;

  if (successBody !== undefined) {
    const reqResult = await bestEffortDump(
      'request',
      'openai',
      () =>
        dumpSDKRequestContext(
          'openai',
          '/chat/completions',
          successBody,
          baseURL ?? 'https://api.openai.com/v1',
          chatDumpMetadata(mergedHeaders, client.apiKey),
        ),
      opts.logger,
    );
    requestBaseId = reqResult?.baseId;
  }

  try {
    const response = await executeSpooledNonStreamingChatRequest(
      client,
      spool,
      abortSignal,
      mergedHeaders,
    );

    if (successBody !== undefined && requestBaseId) {
      await bestEffortDump(
        'response',
        'openai',
        () => dumpSDKResponseContext(requestBaseId, 'openai', response, false),
        opts.logger,
      );
    }

    return response;
  } catch (error) {
    const errorMessage = String(error);
    const resolvedBaseURL = opts.baseURL ?? opts.getBaseURL();

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
      errorDumpBody: errorBody,
      requestBaseId,
      baseURL,
      mergedHeaders: opts.mergedHeaders,
      apiKey: opts.client.apiKey,
      model: opts.model,
      formattedTools: opts.formattedTools,
      streamingEnabled: opts.streamingEnabled,
      logger: opts.logger,
      getBaseURL: opts.getBaseURL,
    };

    if (
      !(await handleCerebrasToolError(
        error,
        errorMessage,
        resolvedBaseURL,
        ctx,
      ))
    ) {
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
  const dump = readDumpBodies(opts);

  if (opts.streamingEnabled) {
    return executeStreamingRequest(opts, dump);
  }
  return executeNonStreamingRequest(opts, dump);
}
