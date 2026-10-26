/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { DEFAULT_REQUEST_MEDIA_BUDGET_BYTES } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '@vybestack/llxprt-code-providers/BaseProvider.js';
import { getRequestSignal } from '@vybestack/llxprt-code-providers/utils/abortSignal.js';
import { resolveRequestMedia } from '@vybestack/llxprt-code-providers/utils/request-media-resolution.js';
import { parseOutputLimits } from '@vybestack/llxprt-code-core/utils/toolOutputLimiter.js';
import { convertGeminiRow } from './GeminiMessageConverter.js';
import { SYNTHETIC_THOUGHT_SIGNATURE } from './thoughtSignatures.js';
import type { Content } from './geminiWireTypes.js';

export function openTransportRowsMedia(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
): Promise<ResolvedMediaRequest> {
  return resolveRequestMedia(media, [], getRequestSignal(options));
}

/** Resolve, convert and release one row; only scalar active-loop state survives. */
export async function* transportContents(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
  owner: ResolvedMediaRequest,
): AsyncIterable<Content> {
  const rows = options.requestRows;
  if (rows === undefined)
    throw new Error('Provider transport rows require a requestRows selection');
  const signal = getRequestSignal(options);
  const limits = parseOutputLimits(options.invocation.ephemerals);
  let activeLoop = -1;
  for (let index = rows.count - 1; index >= 0; index--) {
    const row = await rows.readAt(index, signal);
    if (
      row.speaker === 'human' &&
      row.blocks.some((block) => block.type === 'text' && block.text.length > 0)
    ) {
      activeLoop = index;
      break;
    }
  }
  const reservations = media.resolver?.openReservations(media.requestId);
  if (reservations !== undefined)
    owner.registerCleanup(() => reservations.release());
  let remaining =
    media.aggregateBudgetBytes ?? DEFAULT_REQUEST_MEDIA_BUDGET_BYTES;
  let count = 0;
  for await (const row of rows.openReader(signal)) {
    signal?.throwIfAborted();
    const resolved = await resolveRequestMedia(
      {
        ...media,
        reservations,
        lease: rows.native?.mediaLease,
        aggregateBudgetBytes: remaining,
      },
      [row],
      signal,
    );
    try {
      for (const block of row.blocks)
        if (block.type === 'media' && block.encoding !== 'url')
          remaining -=
            block.encoding === 'reference'
              ? block.normalizedBase64Length
              : block.data.length;
      for (const content of convertGeminiRow(
        resolved.withContents((contents) => contents[0]),
        options.resolved.model,
        limits,
      )) {
        if (
          activeLoop >= 0 &&
          count >= activeLoop &&
          content.role === 'model'
        ) {
          const first = content.parts.find(
            (part) => part.functionCall !== undefined,
          );
          if (first !== undefined && !first.thoughtSignature)
            first.thoughtSignature = SYNTHETIC_THOUGHT_SIGNATURE;
        }
        yield content;
      }
    } finally {
      await resolved.release();
    }
    count++;
  }
  if (count !== rows.count)
    throw new Error('Provider request rows count changed');
}
