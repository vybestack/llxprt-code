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
 * The Vercel provider keeps whole-history arrays by decision (GitHub #3869).
 * These helpers are its copy of the transport-rows reader; no other provider
 * reads a selection into an array.
 *
 * Reads the call's `requestRows` inside a concrete transport. The neutral rows
 * are only a transient input to the one body the SDK or wire format needs, so
 * callers drop them with {@link dropTransportRows} as soon as that body exists.
 */
export async function readTransportRows(
  options: NormalizedGenerateChatOptions,
): Promise<IContent[]> {
  const rows = options.requestRows;
  if (rows === undefined) {
    throw new Error('Provider transport rows require a requestRows selection');
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
  return history;
}

/** Reads the transport rows and resolves their media. */
export async function openTransportRowsMedia(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
): Promise<ResolvedMediaRequest> {
  const history = await readTransportRows(options);
  const mediaRequest = await resolveRequestMedia(
    media,
    history,
    getRequestSignal(options),
  );
  // The resolver may own a separate resolved array; only one list of rows
  // may stay alive until the body is built.
  if (mediaRequest.withContents((contents) => contents) !== history) {
    history.splice(0);
  }
  return mediaRequest;
}

/** Drops the transient neutral rows once the wire body no longer needs them. */
export function dropTransportRows(mediaRequest: ResolvedMediaRequest): void {
  mediaRequest.withContents((contents) => {
    contents.splice(0);
  });
}
