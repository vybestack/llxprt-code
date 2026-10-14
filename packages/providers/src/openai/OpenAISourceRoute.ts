/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { readsRequestRowsAtTransport } from '../BaseProviderNormalization.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import { openTransportRowsMedia } from '../utils/transportRows.js';
import type { ResponsesRequest } from '../openai-responses/responses-request.js';
import type {
  PreparedResponsesRequestContext,
  ResponsesExecutorDeps,
} from '../openai-responses/openAIResponsesExecutor.js';
import {
  assertDiskTextShape,
  assertPreparedStatefulUnchanged,
  buildDiskTextResponsesContext,
} from '../openai-responses/responses-disk-text-projection.js';
import type {
  OpenAIPromptEnvelopeStore,
  OpenAISourceInputs,
  PreparedOpenAIPromptEnvelope,
} from './OpenAIPromptEnvelopeStore.js';

/**
 * A source-route send is normalized with its prompt inputs blanked because
 * the prepared request already carries them; the response path still needs
 * the tool declarations and instruction, so they come back from the one
 * prepared envelope (issue #854 WP08).
 */
export function restorePreparedSourceInputs(
  options: NormalizedGenerateChatOptions,
  store: OpenAIPromptEnvelopeStore,
): NormalizedGenerateChatOptions {
  const token = options.promptEnvelopeTransportToken;
  if (token === undefined || !readsRequestRowsAtTransport(options)) {
    return options;
  }
  const inputs = store.get(token)?.sourceInputs;
  if (inputs === undefined) {
    throw new Error('Unknown OpenAI prompt-envelope transport token');
  }
  return { ...options, ...inputs };
}

/** The prompt inputs a source-route projection keeps for `restorePreparedSourceInputs`. */
export function preparedSourceInputs(options: NormalizedGenerateChatOptions): {
  readonly sourceInputs?: OpenAISourceInputs;
} {
  return readsRequestRowsAtTransport(options)
    ? {
        sourceInputs: {
          systemInstruction: options.systemInstruction,
          tools: options.tools,
        },
      }
    : {};
}

/**
 * Builds the Responses context a projection keeps for its send. Rows staged
 * from `contents` stay open for the stateful rebuilds until the request's media
 * is released.
 */
export async function buildProjectionResponsesContext(
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  stagedRows: NormalizedGenerateChatOptions['stagedRows'],
): Promise<PreparedResponsesRequestContext> {
  const built = await buildDiskTextResponsesContext(request, deps);
  if (stagedRows === undefined) return built;
  built.mediaRequest.registerCleanup(() => stagedRows.close());
  return { ...built, rowsStagedFromContents: true };
}

/**
 * The prepared Responses context of one send. Responses requests always read
 * their rows from disk (the same disk text route the openai-responses
 * provider uses): the context comes from the projection's token, or is built
 * here when the caller sent rows without a projection.
 */
export async function resolveResponsesSendContext(
  options: NormalizedGenerateChatOptions,
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  prepared: PreparedResponsesRequestContext | undefined,
): Promise<PreparedResponsesRequestContext> {
  if (prepared === undefined) {
    return buildDiskTextResponsesContext(request, deps);
  }
  if (
    options.stagedRows !== undefined &&
    prepared.rowsStagedFromContents !== true
  ) {
    throw new Error('Source token requires its transport-read request rows');
  }
  assertDiskTextShape(request, deps);
  assertPreparedStatefulUnchanged(request, deps, prepared);
  return prepared;
}

/** The media request of one chat send: prepared, rows-backed or array-backed. */
export async function resolveChatMediaRequest(
  options: NormalizedGenerateChatOptions,
  prepared: PreparedOpenAIPromptEnvelope | undefined,
  media: Parameters<typeof resolveRequestMedia>[0],
): Promise<ResolvedMediaRequest> {
  if (prepared?.protocol === 'openai-chat') return prepared.mediaRequest;
  if (readsRequestRowsAtTransport(options)) {
    return openTransportRowsMedia(options, media);
  }
  return resolveRequestMedia(
    media,
    options.contents,
    options.invocation.signal,
  );
}
