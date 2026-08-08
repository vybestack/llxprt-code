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
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import { delay } from '@vybestack/llxprt-code-core/utils/delay.js';
import { tryConsumeTransportAttempt } from '../transportAttemptBudget.js';
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

export async function* streamOverHttp(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const contentType = params.isCodex
    ? 'application/json'
    : 'application/json; charset=utf-8';
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
  deps.logger.debug(
    () => `Request body keys: ${JSON.stringify(Object.keys(params.request))}`,
  );
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
  throw parseErrorResponse(response.status, errorBody, deps.providerName);
}

async function handleStreamRetry(
  error: unknown,
  state: {
    streamingAttempt: number;
    maxStreamingAttempts: number;
    currentDelay: number;
  },
  abortSignal: AbortSignal | undefined,
  deps: ResponsesExecutorDeps,
): Promise<number> {
  if (error instanceof Error && error.name === 'AbortError') {
    throw error;
  }
  const canRetryStream =
    deps.shouldRetryOnError(error) || isNetworkTransientError(error);
  if (!canRetryStream || state.streamingAttempt >= state.maxStreamingAttempts) {
    deps.logger.debug(
      () =>
        `Stream attempt ${state.streamingAttempt}/${state.maxStreamingAttempts} failed (retryable=${canRetryStream}), throwing: ${String(error)}`,
    );
    throw error;
  }

  deps.logger.debug(
    () =>
      `Stream retry attempt ${state.streamingAttempt}/${state.maxStreamingAttempts}: Transient error detected, delay ${state.currentDelay}ms before retry. Error: ${String(error)}`,
  );
  const jitter = state.currentDelay * 0.3 * (Math.random() * 2 - 1);
  await delay(Math.max(0, state.currentDelay + jitter), abortSignal);
  return Math.min(30000, state.currentDelay * 2);
}
