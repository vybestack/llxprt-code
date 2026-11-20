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
  wrapStreamWithOutcomeDump,
  wrapStreamWithSDKErrorDump,
  bestEffortDump,
  dumpSDKErrorRequestResponse,
  type DumpOutcome,
  type RequestDumpMetadata,
  type StreamedDumpBody,
} from '../utils/dumpSDKContext.js';
import { type DumpMode } from '../utils/dumpContext.js';
import { type OpenAITool } from './schemaConverter.js';
import {
  withChatHttpBody,
  type ChatHttpBody,
} from '../utils/chat-http-body.js';

import type { DumpAttemptContext } from '../utils/dumpAttemptContext.js';
import { mapFinishReason } from './finishReasonMapping.js';
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
  spool: ChatHttpBody;
  /** What a request dump records. Required when `dumpMode` asks for a dump. */
  dumpBody?: StreamedDumpBody | undefined;
  abortSignal: AbortSignal | undefined;
  mergedHeaders: Record<string, string> | undefined;
  dumpMode: DumpMode | undefined;
  baseURL: string | undefined;
  model: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  attemptContext?: DumpAttemptContext;
  retentionLimits?: { readonly maxBytes: number; readonly maxAgeDays: number };
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
  attemptContext?: DumpAttemptContext,
  outcome?: string,
  retentionLimits?: { readonly maxBytes: number; readonly maxAgeDays: number },
): RequestDumpMetadata {
  const limits = attemptContext?.retentionLimits ?? retentionLimits;
  const correlation =
    attemptContext === undefined && limits === undefined
      ? undefined
      : {
          promptId: attemptContext?.promptId ?? null,
          attemptIndex: attemptContext?.attemptIndex ?? null,
          runtimeId: attemptContext?.runtimeId ?? null,
          ...(attemptContext === undefined
            ? {}
            : { retentionCoordinator: attemptContext.retentionCoordinator }),
          ...(limits === undefined ? {} : { retentionLimits: limits }),
          ...(outcome === undefined ? {} : { outcome }),
        };
  // The SDK sends Authorization from the client api key; synthesize the
  // header for the dump unless the caller already supplied one (#3159).
  // A null/empty key means the SDK sends no Authorization header, so the
  // dump must not invent one.
  if (
    !apiKey ||
    (mergedHeaders !== undefined &&
      hasHeaderName(mergedHeaders, 'Authorization'))
  ) {
    return {
      headers: mergedHeaders,
      transport: { type: 'http' },
      ...(correlation === undefined ? {} : { correlation }),
    };
  }
  return {
    headers: { ...mergedHeaders, Authorization: `Bearer ${apiKey}` },
    transport: { type: 'http' },
    ...(correlation === undefined ? {} : { correlation }),
  };
}

interface ErrorContext {
  /** Present only when error dumps are on. */
  errorDumpBody: StreamedDumpBody | undefined;
  requestBaseId: string | undefined;
  baseURL: string | undefined;
  mergedHeaders: Record<string, string> | undefined;
  apiKey: string | undefined;
  model: string;
  formattedTools: OpenAITool[] | undefined;
  streamingEnabled: boolean;
  attemptContext?: DumpAttemptContext;
  retentionLimits?: { readonly maxBytes: number; readonly maxAgeDays: number };
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
      chatDumpMetadata(ctx.mergedHeaders, ctx.apiKey, ctx.attemptContext),
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

function selectOpenAIDumpOutcome(value: unknown): DumpOutcome {
  if (typeof value !== 'object' || value === null || !('choices' in value))
    return undefined;
  const choices = value.choices;
  if (!Array.isArray(choices)) return undefined;
  const lastChoice = choices[choices.length - 1];
  if (
    typeof lastChoice !== 'object' ||
    lastChoice === null ||
    !('finish_reason' in lastChoice)
  )
    return undefined;
  const rawReason = lastChoice.finish_reason;
  if (typeof rawReason !== 'string') return undefined;
  const finishReason = mapFinishReason(rawReason).finishReason;
  if (finishReason === 'refusal' || finishReason === 'safety') return 'refusal';
  if (
    finishReason === 'stop' ||
    finishReason === 'tool_calls' ||
    finishReason === 'max_tokens'
  )
    return 'success';
  return undefined;
}

function selectOpenAIStreamingDumpOutcome(
  response: Record<string, unknown>,
): DumpOutcome {
  if (response['completed'] !== true || !Array.isArray(response['chunks']))
    return undefined;
  const chunks = response['chunks'];
  return selectOpenAIDumpOutcome(chunks[chunks.length - 1]);
}

/** Posts a sealed body as a streaming chat request (also the continuation). */
export async function executeSpooledStreamingChatRequest(
  client: OpenAIRawPostClient,
  spool: ChatHttpBody,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const response = await withChatHttpBody(spool, (stream, byteLength) =>
    client.post('/chat/completions', {
      body: stream,
      headers: boundedJsonHeaders(byteLength, mergedHeaders),
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
  spool: ChatHttpBody,
  abortSignal: AbortSignal | undefined,
  mergedHeaders: Record<string, string> | undefined,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const response = await withChatHttpBody(spool, (stream, byteLength) =>
    client.post('/chat/completions', {
      body: stream,
      headers: boundedJsonHeaders(byteLength, mergedHeaders),
      stream: false,
      ...(abortSignal === undefined ? {} : { signal: abortSignal }),
    }),
  );
  if (!isChatCompletion(response)) {
    throw new TypeError('OpenAI response does not contain a choices array');
  }
  return response;
}

/** The dump body, resolved once for the success dump and for the error dump. */
interface DumpBodies {
  readonly success: StreamedDumpBody | undefined;
  readonly error: StreamedDumpBody | undefined;
}

function resolveDumpBodies(opts: ApiExecutionOptions): DumpBodies {
  const wantsSuccess = shouldDumpSDKContext(opts.dumpMode, false);
  const wantsError = shouldDumpSDKContext(opts.dumpMode, true);
  if (!wantsSuccess && !wantsError) {
    return { success: undefined, error: undefined };
  }
  const body = opts.dumpBody;
  if (body === undefined) {
    throw new Error(
      'Chat dump requested but the request was prepared without a dump form',
    );
  }
  return {
    success: wantsSuccess ? body : undefined,
    error: wantsError ? body : undefined,
  };
}

/**
 * Execute streaming API request with dump and error handling.
 */
async function dumpOpenAIRequest(
  opts: ApiExecutionOptions,
  body: StreamedDumpBody,
): Promise<string | undefined> {
  const result = await bestEffortDump(
    'request',
    'openai',
    () =>
      dumpSDKRequestContext(
        'openai',
        '/chat/completions',
        body,
        opts.baseURL ?? 'https://api.openai.com/v1',
        chatDumpMetadata(
          opts.mergedHeaders,
          opts.client.apiKey,
          opts.attemptContext,
          undefined,
          opts.retentionLimits,
        ),
      ),
    opts.logger,
  );
  return result?.baseId;
}

function wrapOpenAIErrorStreamingResponse(
  response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  opts: ApiExecutionOptions,
  requestBody: StreamedDumpBody,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const { client, mergedHeaders, baseURL, attemptContext, retentionLimits } =
    opts;
  const metadata = chatDumpMetadata(
    mergedHeaders,
    client.apiKey,
    attemptContext,
    undefined,
    retentionLimits,
  );
  const errorWrapped = wrapStreamWithSDKErrorDump(
    response,
    'openai',
    '/chat/completions',
    requestBody,
    baseURL ?? 'https://api.openai.com/v1',
    dumpSDKRequestContext,
    dumpSDKResponseContext,
    metadata,
  );
  const correlation = metadata.correlation ?? {
    promptId: null,
    attemptIndex: null,
    runtimeId: null,
    ...(retentionLimits === undefined ? {} : { retentionLimits }),
  };
  return wrapStreamWithOutcomeDump(
    errorWrapped,
    'openai',
    '/chat/completions',
    requestBody,
    baseURL,
    { ...metadata, correlation },
    attemptContext?.pairedSuccess ?? false,
    selectOpenAIDumpOutcome,
    (outcome, baseId) => attemptContext?.recordDump(outcome, baseId),
  );
}

function wrapOpenAIStreamingResponse(
  response: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  opts: ApiExecutionOptions,
  requestBaseId: string | undefined,
  dump: DumpBodies,
): AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> {
  const { client, mergedHeaders, baseURL, attemptContext, retentionLimits } =
    opts;
  const { success: successBody, error: errorBody } = dump;
  if (errorBody !== undefined && successBody === undefined)
    return wrapOpenAIErrorStreamingResponse(response, opts, errorBody);
  if (successBody !== undefined && requestBaseId !== undefined) {
    const correlation = chatDumpMetadata(
      mergedHeaders,
      client.apiKey,
      attemptContext,
      undefined,
      retentionLimits,
    ).correlation;
    return wrapStreamWithDump(
      response,
      requestBaseId,
      'openai',
      dumpSDKResponseContext,
      correlation,
      attemptContext === undefined
        ? undefined
        : (baseId, responseBody) => {
            const outcome = selectOpenAIStreamingDumpOutcome(responseBody);
            if (outcome !== undefined)
              attemptContext.recordDump(outcome, baseId);
          },
    );
  }
  if (errorBody === undefined) return response;
  return wrapStreamWithSDKErrorDump(
    response,
    'openai',
    '/chat/completions',
    errorBody,
    baseURL ?? 'https://api.openai.com/v1',
    dumpSDKRequestContext,
    dumpSDKResponseContext,
    chatDumpMetadata(
      mergedHeaders,
      client.apiKey,
      attemptContext,
      undefined,
      retentionLimits,
    ),
  );
}

async function executeStreamingRequest(
  opts: ApiExecutionOptions,
  dump: DumpBodies,
): Promise<AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>> {
  const { client, spool, abortSignal, mergedHeaders, baseURL } = opts;
  const { error: errorBody } = dump;
  const requestBaseId =
    dump.success === undefined
      ? undefined
      : await dumpOpenAIRequest(opts, dump.success);

  try {
    const response = await executeSpooledStreamingChatRequest(
      client,
      spool,
      abortSignal,
      mergedHeaders,
    );

    return wrapOpenAIStreamingResponse(response, opts, requestBaseId, dump);
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
      attemptContext: opts.attemptContext,
      retentionLimits: opts.retentionLimits,
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

async function dumpSuccessfulNonStreamingResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
  opts: ApiExecutionOptions,
  requestBaseId: string,
): Promise<void> {
  const attempt = opts.attemptContext;
  const correlation = chatDumpMetadata(
    opts.mergedHeaders,
    opts.client.apiKey,
    attempt,
  ).correlation;
  const written = await bestEffortDump('response', 'openai', () =>
    dumpSDKResponseContext(
      requestBaseId,
      'openai',
      { status: 200, streaming: false, response },
      false,
      correlation,
    ),
  );
  const outcome = selectOpenAIDumpOutcome(response);
  if (written !== undefined && attempt !== undefined && outcome !== undefined)
    attempt.recordDump(outcome, requestBaseId);
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
  const requestBaseId =
    successBody === undefined
      ? undefined
      : await dumpOpenAIRequest(opts, successBody);

  try {
    const response = await executeSpooledNonStreamingChatRequest(
      client,
      spool,
      abortSignal,
      mergedHeaders,
    );

    if (errorBody !== undefined && successBody === undefined) {
      await dumpOpenAIOutcomeResponse(response, opts, errorBody);
    }

    if (successBody !== undefined && requestBaseId) {
      await dumpSuccessfulNonStreamingResponse(response, opts, requestBaseId);
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
      attemptContext: opts.attemptContext,
      retentionLimits: opts.retentionLimits,
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

async function dumpOpenAIOutcomeResponse(
  response: OpenAI.Chat.Completions.ChatCompletion,
  opts: ApiExecutionOptions,
  requestBody: StreamedDumpBody,
): Promise<void> {
  const attempt = opts.attemptContext;
  const outcome = selectOpenAIDumpOutcome(response);
  if (
    outcome !== 'refusal' &&
    !(outcome === 'success' && attempt?.pairedSuccess === true)
  )
    return;
  const dumpOutcome = outcome === 'refusal' ? 'refusal' : 'paired-success';
  const metadata: RequestDumpMetadata = {
    ...chatDumpMetadata(opts.mergedHeaders, opts.client.apiKey, attempt),
    correlation: {
      promptId: attempt?.promptId ?? null,
      attemptIndex: attempt?.attemptIndex ?? null,
      runtimeId: attempt?.runtimeId ?? null,
      ...(attempt === undefined
        ? {}
        : { retentionCoordinator: attempt.retentionCoordinator }),
      ...(attempt?.retentionLimits === undefined
        ? {}
        : { retentionLimits: attempt.retentionLimits }),
      outcome: dumpOutcome,
    },
  };
  const request = await bestEffortDump('outcome-request', 'openai', () =>
    dumpSDKRequestContext(
      'openai',
      '/chat/completions',
      requestBody,
      opts.baseURL ?? 'https://api.openai.com/v1',
      metadata,
      true,
    ),
  );
  if (request === undefined) return;
  const dumpResponse = await bestEffortDump('outcome-response', 'openai', () =>
    dumpSDKResponseContext(
      request.baseId,
      'openai',
      { status: 200, streaming: false, response },
      false,
      metadata.correlation,
    ),
  );
  if (dumpResponse !== undefined)
    attempt?.recordDump(dumpOutcome, request.baseId);
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
  const dump = resolveDumpBodies(opts);

  if (opts.streamingEnabled) {
    return executeStreamingRequest(opts, dump);
  }
  return executeNonStreamingRequest(opts, dump);
}
