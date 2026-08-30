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
import { buildWebSocketHandshakeHeaders } from './openAIResponsesRequestDump.js';
import {
  finishMediaRequest,
  type MediaRequestOutcome,
} from '../utils/request-media-resolution.js';
import {
  dumpFallbackHttpRequest,
  streamOverHttp,
  type StreamResponsesParams,
} from './openAIResponsesHttpStream.js';
import {
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
    // Link later response/error dumps to the HTTP request that was actually
    // sent, not to the WebSocket attempt that preceded it (#3159).
    const fallbackBaseId = await dumpFallbackHttpRequest(params, deps);
    yield* streamOverHttp(
      fallbackBaseId === undefined
        ? params
        : { ...params, dumpBaseId: fallbackBaseId },
      deps,
    );
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
