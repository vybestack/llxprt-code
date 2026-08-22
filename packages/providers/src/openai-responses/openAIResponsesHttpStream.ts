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

/**
 * HTTP/SSE streaming path for the OpenAI Responses executor.
 *
 * Extracted from openAIResponsesExecutor.ts to keep that module within the
 * project's max-lines budget. This module owns fetch retries, SSE body
 * parsing, and API-error translation. The Codex WebSocket transport calls
 * back into `streamOverHttp` as its one-shot pre-event fallback (issue #2041).
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  parseResponsesStream,
  parseErrorResponse,
  type ParseResponsesStreamOptions,
} from '../openai/parseResponsesStream.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import {
  getErrorStatus,
  isNetworkTransientError,
} from '@vybestack/llxprt-code-core/utils/retry.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';
import { getDelayDuration, hasRetryAfterHeader } from '../retryDelayPolicy.js';
import {
  shouldDumpSDKContext,
  dumpSDKRequestContext,
  dumpSDKResponseContext,
  dumpSDKErrorRequestResponse,
  bestEffortDump,
  type RequestDumpMetadata,
} from '../utils/dumpSDKContext.js';
import { redactSensitiveHeaders, type DumpMode } from '../utils/dumpContext.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';
import type { OpenAIResponsesRequest } from './OpenAIResponsesTypes.js';

/** Per-request context shared by the executor and the HTTP stream path. */
export interface StreamResponsesParams {
  /**
   * Rebuilds this request with statefulness suppressed (full history, no
   * `previous_response_id`).
   *
   * The Codex WebSocket->HTTP fallback happens mid-turn with an already-built
   * request. That request may carry a socket-scoped parent id, which the HTTP
   * endpoint cannot resolve (verified live: the backend rejects it), so the
   * fallback must re-derive a stateless request rather than replay the
   * WebSocket one (#3134).
   */
  rebuildStateless?: () => Promise<StreamResponsesParams>;
  apiKey: string;
  baseURL: string;
  isCodex: boolean;
  request: OpenAIResponsesRequest;
  includeThinkingInResponse: boolean;
  responsesStored: boolean;
  abortSignal?: AbortSignal;
  maxStreamingAttempts: number;
  streamRetryInitialDelayMs: number;
  normalizedOptions: NormalizedGenerateChatOptions;
  dumpBaseId?: string;
  dumpMode?: DumpMode;
}

interface FetchStreamParams {
  responsesURL: string;
  headers: Record<string, string>;
  bodyBlob: Blob;
  abortSignal?: AbortSignal;
  includeThinkingInResponse: boolean;
  responsesStored: boolean;
  maxStreamingAttempts: number;
  streamRetryInitialDelayMs: number;
  normalizedOptions: NormalizedGenerateChatOptions;
  onStreamLiveness?: NormalizedGenerateChatOptions['onStreamLiveness'];
}

function resolveResponsesContentType(params: { isCodex: boolean }): string {
  return params.isCodex
    ? 'application/json'
    : 'application/json; charset=utf-8';
}

/**
 * HTTP dump metadata shared by the pre-transport seam dump and the
 * WebSocket-fallback dump (#3159): both record the same physical HTTP send
 * shape, so both call sites must build headers identically.
 */
export async function buildHttpDumpMetadata(
  params: Pick<
    StreamResponsesParams,
    'apiKey' | 'isCodex' | 'normalizedOptions'
  >,
  deps: ResponsesExecutorDeps,
): Promise<RequestDumpMetadata> {
  return {
    headers: await buildResponsesHeaders(
      params.apiKey,
      resolveResponsesContentType(params),
      params.isCodex,
      params.normalizedOptions,
      deps,
    ),
    transport: { type: 'http' },
  };
}

export async function* streamOverHttp(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const contentType = resolveResponsesContentType(params);
  const bodyBlob = new Blob([JSON.stringify(params.request)], {
    type: contentType,
  });
  const headers = await buildResponsesHeaders(
    params.apiKey,
    contentType,
    params.isCodex,
    params.normalizedOptions,
    deps,
  );
  try {
    yield* fetchStreamWithRetries(
      {
        ...params,
        responsesURL: `${params.baseURL}/responses`,
        headers,
        bodyBlob,
        onStreamLiveness: params.normalizedOptions.onStreamLiveness,
      },
      deps,
    );
  } catch (error) {
    await dumpErrorOnFailure(error, params, deps, headers);
    throw error;
  }
}

export async function buildResponsesHeaders(
  apiKey: string,
  contentType: string,
  isCodex: boolean,
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': contentType,
    ...(deps.getCustomHeaders(options) ?? {}),
  };
  if (isCodex) await addCodexHeaders(headers, options, deps);
  return headers;
}

async function addCodexHeaders(
  headers: Record<string, string>,
  options: NormalizedGenerateChatOptions,
  deps: ResponsesExecutorDeps,
): Promise<void> {
  const accountId = await deps.getCodexAccountId();
  headers['ChatGPT-Account-ID'] = accountId;
  headers['originator'] = 'codex_cli_rs';

  const invocationSessionId = options.invocation.runtimeId;
  const sessionId =
    typeof invocationSessionId === 'string' && invocationSessionId.trim() !== ''
      ? invocationSessionId
      : options.runtime?.runtimeId;
  const validSessionId =
    typeof sessionId === 'string' && sessionId.trim() !== ''
      ? sessionId
      : undefined;
  if (validSessionId !== undefined) headers['session_id'] = validSessionId;

  const sessionIdForLog = validSessionId?.substring(0, 8) ?? 'none';
  deps.logger.debug(
    () =>
      `Codex mode: adding headers for account ${accountId.substring(0, 8)}..., session_id=${sessionIdForLog}...`,
  );
}

async function* fetchStreamWithRetries(
  params: FetchStreamParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  let streamingAttempt = 0;
  let currentDelay = params.streamRetryInitialDelayMs;
  let lastError: unknown;

  while (streamingAttempt < params.maxStreamingAttempts) {
    streamingAttempt += 1;
    // AC2 (#3049): after the first attempt, consume a slot from the shared
    // transport budget so internal retries are bounded by the same `retries`
    // count as the orchestrator, not retries × retries. When no budget is
    // attached (direct unit tests without an orchestrator),
    // tryConsumeTransportAttempt returns true and today's
    // maxStreamingAttempts-only behavior is unchanged.
    if (
      streamingAttempt > 1 &&
      !tryConsumeTransportAttempt(params.normalizedOptions)
    ) {
      throw lastError;
    }

    const yieldedForAttempt: { value: boolean } = { value: false };
    try {
      const response = await fetchResponse(params);
      yield* parseSuccessfulResponse(response, params, deps, yieldedForAttempt);
      return;
    } catch (error) {
      lastError = error;
      // AC1 (#3049): content was already yielded for this attempt, so
      // replaying into the same iterator would concatenate two attempts'
      // text. Rethrow immediately and let the orchestrator decide.
      if (yieldedForAttempt.value) throw error;
      currentDelay = await handleStreamRetry(
        error,
        {
          streamingAttempt,
          maxStreamingAttempts: params.maxStreamingAttempts,
          currentDelay,
          initialDelay: params.streamRetryInitialDelayMs,
        },
        params.abortSignal,
        deps,
      );
    }
  }
}

async function fetchResponse(params: {
  responsesURL: string;
  headers: Record<string, string>;
  bodyBlob: Blob;
  abortSignal?: AbortSignal;
}): Promise<Response> {
  return fetch(params.responsesURL, {
    method: 'POST',
    headers: params.headers,
    body: params.bodyBlob,
    signal: params.abortSignal,
  });
}

async function* parseSuccessfulResponse(
  response: Response,
  params: Pick<
    FetchStreamParams,
    'includeThinkingInResponse' | 'responsesStored' | 'onStreamLiveness'
  >,
  deps: ResponsesExecutorDeps,
  yieldedMarker: { value: boolean },
): AsyncIterableIterator<IContent> {
  if (!response.ok) await throwApiError(response, deps);
  if (!response.body) {
    deps.logger.debug(() => 'Response body missing, returning early');
    return;
  }

  const streamOptions: ParseResponsesStreamOptions = {
    includeThinkingInResponse: params.includeThinkingInResponse,
    responsesStored: params.responsesStored,
    onStreamLiveness: params.onStreamLiveness,
    // AC3 (#3049): an HTTP/SSE body that reaches EOF without an accepted
    // terminal event is a truncated stream, not a complete response.
    requireTerminalEvent: true,
  };
  for await (const message of parseResponsesStream(
    response.body,
    streamOptions,
  )) {
    yieldedMarker.value = true;
    yield message;
  }
}

async function throwApiError(
  response: Response,
  deps: ResponsesExecutorDeps,
): Promise<never> {
  const errorBody = await response.text();
  deps.logger.debug(
    () => `API error ${response.status}: ${errorBody.substring(0, 500)}`,
  );
  const headers = lowercaseHeaders(response.headers);
  throw parseErrorResponse(
    response.status,
    errorBody,
    deps.providerName,
    headers,
  );
}

function lowercaseHeaders(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key.toLowerCase()] = value;
  });
  return record;
}

async function handleStreamRetry(
  error: unknown,
  state: {
    streamingAttempt: number;
    maxStreamingAttempts: number;
    currentDelay: number;
    initialDelay: number;
  },
  abortSignal: AbortSignal | undefined,
  deps: ResponsesExecutorDeps,
): Promise<number> {
  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
  // A definite HTTP status is authoritative. Falling back to message-substring
  // heuristics would let provider prose ("account terminated for non-payment"
  // matches the transient phrase "terminated") re-open a classification that
  // was already made (issue #3140).
  const canRetryStream =
    getErrorStatus(error) !== undefined
      ? deps.shouldRetryOnError(error)
      : isNetworkTransientError(error);
  if (!canRetryStream || state.streamingAttempt >= state.maxStreamingAttempts) {
    deps.logger.debug(
      () =>
        `Stream attempt ${state.streamingAttempt}/${state.maxStreamingAttempts} failed (retryable=${canRetryStream}), throwing: ${String(error)}`,
    );
    throw error;
  }

  const waitMs = getDelayDuration(error, state.currentDelay);
  deps.logger.debug(
    () =>
      `Stream retry attempt ${state.streamingAttempt}/${state.maxStreamingAttempts}: Transient error detected, delay ${waitMs}ms before retry. Error: ${String(error)}`,
  );
  await delay(waitMs, abortSignal);
  return hasRetryAfterHeader(error)
    ? state.initialDelay
    : Math.min(30000, state.currentDelay * 2);
}

interface ErrorResponsePayload {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  error?: string;
}

function buildErrorResponsePayload(error: unknown): ErrorResponsePayload {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    const response = (
      error as {
        response?: {
          status?: number;
          headers?: Record<string, string>;
          body?: string;
        };
      }
    ).response;
    if (response !== undefined) {
      return {
        status: response.status,
        headers: redactSensitiveHeaders(response.headers),
        body: response.body,
      };
    }
  }
  return { error: String(error) };
}

async function dumpErrorOnFailure(
  error: unknown,
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
  headers: Record<string, string>,
): Promise<void> {
  // A user cancellation is not a request failure; dumping it would write a
  // full-prompt request file on every abort without diagnostic value.
  if (error instanceof Error && error.name === 'AbortError') return;
  if (!shouldDumpSDKContext(params.dumpMode, true)) return;
  const payload = buildErrorResponsePayload(error);
  await bestEffortDump('error-response', deps.providerName, async () => {
    if (params.dumpBaseId !== undefined) {
      await dumpSDKResponseContext(
        params.dumpBaseId,
        deps.providerName,
        payload,
        true,
      );
      return;
    }
    await dumpSDKErrorRequestResponse(
      deps.providerName,
      '/responses',
      params.request,
      payload,
      params.baseURL,
      dumpSDKRequestContext,
      dumpSDKResponseContext,
      { headers, transport: { type: 'http' } },
    );
  });
}

/**
 * Records the physical HTTP send when the WebSocket transport falls back
 * mid-turn (#3159). The pre-transport dump already recorded the WebSocket
 * attempt; this best-effort dump makes the fallback visible with the real
 * HTTP headers and the body actually carried. Gated to success-dump mode:
 * error mode already writes an honest HTTP error dump via dumpErrorOnFailure.
 * Returns the dump base id so response/error dumps link to the HTTP request.
 */
export async function dumpFallbackHttpRequest(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): Promise<string | undefined> {
  if (!shouldDumpSDKContext(params.dumpMode, false)) {
    return undefined;
  }
  const result = await bestEffortDump('request', deps.providerName, async () =>
    dumpSDKRequestContext(
      deps.providerName,
      '/responses',
      params.request,
      params.baseURL,
      await buildHttpDumpMetadata(params, deps),
    ),
  );
  return result?.baseId;
}
