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
  isStatefulConnectionRenewalError,
  streamOverWebSocketOrFallback,
  type StreamResponseOptions,
  type WebSocketTransport,
} from './openAIResponsesWebSocketTransport.js';
import type { ResponsesExecutorDeps } from './openAIResponsesExecutor.js';

export async function* streamResponses(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): AsyncIterableIterator<IContent> {
  const transport = deps.getWebSocketTransport?.();
  if (params.isCodex && transport !== undefined) {
    yield* streamOverWebSocketWithRenewal(params, deps, transport);
    return;
  }

  yield* streamOverHttp(params, deps);
}

/**
 * WebSocket branch with the #3446 stateful connection renewal.
 *
 * When the transport reports that a connection-scoped parent cannot be replayed
 * (lifecycle limit reached with a `previous_response_id` in flight), the
 * recovery stays on the WebSocket transport: retire the dead id, rebuild the
 * turn statelessly (full history, no parent), and stream the rebuilt request
 * over a fresh connection. A mid-chain renewal is transport health, not a
 * transport failure, so it must not invoke `onWebSocketFallback` or the HTTP
 * fallback (which would hide the dead id and degrade the provider to sticky
 * HTTP).
 */
async function* streamOverWebSocketWithRenewal(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
  transport: WebSocketTransport,
): AsyncIterableIterator<IContent> {
  const streamOptions = await buildWebSocketStreamOptions(params, deps);
  try {
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
  } catch (error) {
    const parentId = params.request.previous_response_id;
    if (
      !isStatefulConnectionRenewalError(error) ||
      parentId === undefined ||
      params.rebuildStateless === undefined
    ) {
      throw error;
    }
    deps.markStatefulParentRejected?.(parentId);
    deps.logger.debug(
      () =>
        `Codex WebSocket renewal: retiring rejected previous_response_id ${parentId} and retrying once statelessly over WebSocket (#3446).`,
    );
    const rebuilt = await params.rebuildStateless();
    let outcome: MediaRequestOutcome = { status: 'succeeded' };
    try {
      yield* streamOverWebSocketOrFallback(
        transport,
        rebuilt.request,
        streamOptions,
        () => streamOverHttp(rebuilt, deps),
        deps.onWebSocketFallback,
        deps.logger,
        deps.onWebSocketSuccess,
      );
    } catch (renewalError) {
      outcome = { status: 'failed', error: renewalError };
      throw renewalError;
    } finally {
      await finishMediaRequest(rebuilt.mediaRequest, outcome);
    }
  }
}

async function buildWebSocketStreamOptions(
  params: StreamResponsesParams,
  deps: ResponsesExecutorDeps,
): Promise<StreamResponseOptions> {
  const headers = await buildWebSocketHandshakeHeaders(params, deps);
  return {
    responsesURL: `${params.baseURL}/responses`,
    headers,
    abortSignal: params.abortSignal,
    includeThinkingInResponse: params.includeThinkingInResponse,
    responsesStored: params.responsesStored,
    onStreamLiveness: params.normalizedOptions.onStreamLiveness,
  };
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
