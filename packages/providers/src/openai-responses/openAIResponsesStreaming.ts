/**
 * Copyright 2026 Vybestack LLC
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

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
} from '../utils/request-media-resolution.js';
import {
  streamOverHttp,
  type StreamResponsesParams,
} from './openAIResponsesHttpStream.js';
import {
  CODEX_WEBSOCKET_BETA_HEADER,
  streamOverWebSocketOrFallback,
  type StreamResponseOptions,
} from './openAIResponsesWebSocketTransport.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';

export async function* streamResponses(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const transport = deps.getWebSocketTransport?.();
  if (params.isCodex && transport !== undefined) {
    const headers = await buildWebSocketHandshakeHeaders(params, deps);
    const streamOptions: StreamResponseOptions = {
      responsesURL: `${params.baseURL}/responses`,
      headers,
      abortSignal: params.abortSignal,
      includeThinkingInResponse: params.includeThinkingInResponse,
      responsesStored: params.responsesStored,
      onStreamLiveness: params.normalizedOptions.onStreamLiveness,
    };
    yield* streamOverWebSocketOrFallback(
      transport,
      params.request,
      streamOptions,
      () => streamOverHttpWithoutStatefulness(params, deps),
      deps.onWebSocketFallback,
      deps.logger,
      deps.onWebSocketSuccess,
    );
    return;
  }

  yield* streamOverHttp(params, deps);
}

async function* streamOverHttpWithoutStatefulness(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  if (
    params.rebuildStateless === undefined ||
    params.request.previous_response_id === undefined
  ) {
    yield* streamOverHttp(params, deps);
    return;
  }
  deps.logger.debug(
    () =>
      'Codex WebSocket fallback: rebuilding the request without previous_response_id for HTTP.',
  );
  const rebuilt = await params.rebuildStateless();
  let outcome: MediaRequestOutcome = { status: 'succeeded' };
  try {
    yield* streamOverHttp(rebuilt, deps);
  } catch (error) {
    outcome = { status: 'failed', error };
  } finally {
    await finishMediaRequest(rebuilt.mediaRequest, outcome);
  }
}

async function buildWebSocketHandshakeHeaders(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
    ...(deps.getCustomHeaders(params.normalizedOptions) ?? {}),
  };
  headers['ChatGPT-Account-ID'] = await deps.getCodexAccountId();
  headers['originator'] = 'codex_cli_rs';
  const invocationSessionId = params.normalizedOptions.invocation.runtimeId;
  const sessionId =
    typeof invocationSessionId === 'string' && invocationSessionId.trim() !== ''
      ? invocationSessionId
      : params.normalizedOptions.runtime?.runtimeId;
  if (typeof sessionId === 'string' && sessionId.trim() !== '') {
    headers['session_id'] = sessionId;
  }
  headers['OpenAI-Beta'] = CODEX_WEBSOCKET_BETA_HEADER;
  return headers;
}
