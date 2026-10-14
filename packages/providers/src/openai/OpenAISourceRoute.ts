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

/**
 * The prepared Responses context of one send. On the source route the rows
 * are read by the disk text route (the same one the openai-responses provider
 * uses), either from the projection's token or built here when the caller
 * sent rows without a projection; array-backed sends carry no context unless
 * a projection prepared one.
 */
export async function resolveResponsesSendContext(
  options: NormalizedGenerateChatOptions,
  request: ResponsesRequest,
  deps: ResponsesExecutorDeps,
  prepared: PreparedResponsesRequestContext | undefined,
): Promise<PreparedResponsesRequestContext | undefined> {
  const sourceRoute = readsRequestRowsAtTransport(options);
  if (!sourceRoute) {
    if (prepared?.sourcePrompt !== undefined) {
      throw new Error('Source token requires its transport-read request rows');
    }
    return prepared;
  }
  if (prepared === undefined) {
    return buildDiskTextResponsesContext(request, deps);
  }
  if (prepared.sourcePrompt === undefined) {
    throw new Error(
      'Disk text selection requires a source-backed prepared token',
    );
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
