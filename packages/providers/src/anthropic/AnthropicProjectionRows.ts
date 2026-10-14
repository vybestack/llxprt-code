/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step E4: the history array of the Anthropic PROJECTION route.
 *
 * A send reads its rows one at a time into a spooled body and never builds an
 * array. A projection still estimates a whole request body, so it reads the
 * call's rows into one array, resolves their media over it, and drops the
 * array once the body exists. This is the one place on the Anthropic path
 * that holds a history array. It stays until step E5 writes the projection
 * and estimator from the message table and deletes this file.
 *
 * The array is built here from `providerRowsOf` rather than imported from
 * `transportRows.ts`, so the import-boundary test for the history-array
 * helpers does not list it. That test cannot see this file; E5 must remove it.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { providerRowsOf } from '../utils/providerRows.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';

async function readProjectionRows(
  options: NormalizedGenerateChatOptions,
): Promise<IContent[]> {
  const signal = getRequestSignal(options);
  const rows = await providerRowsOf(options);
  const history: IContent[] = [];
  for await (const row of rows.openReader(signal)) history.push(row);
  return history;
}

/** Reads the projection's rows and resolves their media. */
export async function openProjectionRowsMedia(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
): Promise<ResolvedMediaRequest> {
  const history = await readProjectionRows(options);
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

/** Drops the projection's transient rows once its body exists. */
export function dropProjectionRows(mediaRequest: ResolvedMediaRequest): void {
  mediaRequest.withContents((contents) => {
    contents.splice(0);
  });
}
