/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';

/**
 * Reads the call's `requestRows` inside the Anthropic transport and resolves
 * their media. The Messages SDK needs the complete structured body, so the
 * neutral rows are only a transient input to that one body build: the caller
 * drops them with {@link dropTransportRows} as soon as the body exists.
 */
export async function openTransportRowsMedia(
  options: NormalizedGenerateChatOptions,
): Promise<ResolvedMediaRequest> {
  const rows = options.requestRows;
  if (rows === undefined) {
    throw new Error('Anthropic transport rows require a requestRows selection');
  }
  const signal = getRequestSignal(options);
  signal?.throwIfAborted();
  const history: IContent[] = [];
  for await (const row of rows.openReader(signal)) {
    signal?.throwIfAborted();
    history.push(row);
  }
  if (history.length !== rows.count) {
    throw new Error('Provider request rows count changed');
  }
  const mediaRequest = await resolveRequestMedia(
    options.runtime,
    history,
    signal,
  );
  // The resolver may own a separate resolved array; only one list of rows
  // may stay alive until the body is built.
  if (mediaRequest.withContents((contents) => contents) !== history) {
    history.splice(0);
  }
  return mediaRequest;
}

/** Drops the transient neutral rows once the SDK body no longer needs them. */
export function dropTransportRows(mediaRequest: ResolvedMediaRequest): void {
  mediaRequest.withContents((contents) => {
    contents.splice(0);
  });
}
