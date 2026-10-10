/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { readsRequestRowsAtTransport } from '../BaseProviderNormalization.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import {
  openTransportRowsMedia,
  readTransportRows,
} from '../utils/transportRows.js';
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
 * The Responses transport still builds from a plain history list, so on the
 * source route its rows are read here unless a prepared request already
 * carries them.
 */
export async function withResponsesRows(
  options: NormalizedGenerateChatOptions,
  hasPrepared: boolean,
): Promise<NormalizedGenerateChatOptions> {
  if (hasPrepared || !readsRequestRowsAtTransport(options)) return options;
  return { ...options, contents: await readTransportRows(options) };
}

/** The media request of one chat send: prepared, rows-backed or array-backed. */
export async function resolveChatMediaRequest(
  options: NormalizedGenerateChatOptions,
  prepared: PreparedOpenAIPromptEnvelope | undefined,
): Promise<ResolvedMediaRequest> {
  if (prepared?.protocol === 'openai-chat') return prepared.mediaRequest;
  if (readsRequestRowsAtTransport(options)) {
    return openTransportRowsMedia(options);
  }
  return resolveRequestMedia(
    options.runtime,
    options.contents,
    options.invocation.signal,
  );
}
