/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { observeRequestRepresentation } from '../utils/requestScopedBody.js';
import type { ModelMessage } from 'ai';
import type { ResolvedMediaRequest } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { getRequestSignal } from '../utils/abortSignal.js';
import { resolveRequestMedia } from '../utils/request-media-resolution.js';
import { resolveRowsMedia } from '../openai-responses/responses-row-media.js';
import { convertToVercelMessages } from './messageConversion.js';
import { filterThinkingForContext } from '../reasoning/reasoningUtils.js';
import type { ReasoningSettings } from './vercelStreamTypes.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import { transportToolIds } from './transport-tool-ids.js';

/** History stays in the selection; this owner holds only media reservations. */
export function openTransportRowsMedia(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
): Promise<ResolvedMediaRequest> {
  return resolveRequestMedia(media, [], getRequestSignal(options));
}

export async function* transportMessages(
  options: NormalizedGenerateChatOptions,
  media: Parameters<typeof resolveRequestMedia>[0],
  owner: ResolvedMediaRequest,
  reasoning: ReasoningSettings,
  toolFormat: ToolFormat,
): AsyncIterable<ModelMessage> {
  const rows = options.requestRows;
  if (rows === undefined)
    throw new Error('Provider transport rows require a requestRows selection');
  const signal = getRequestSignal(options);
  const strip = reasoning.enabled ? reasoning.stripFromContext : 'all';
  let lastThinking = -1;
  if (strip === 'allButLast') {
    for (let index = rows.count - 1; index >= 0; index--) {
      if (
        (await rows.readAt(index, signal)).blocks.some(
          (block) => block.type === 'thinking',
        )
      ) {
        lastThinking = index;
        break;
      }
    }
  }
  const mapping = await transportToolIds(options, toolFormat);
  try {
    let count = 0;
    for await (const row of resolveRowsMedia(
      rows.openReader(signal),
      media,
      owner,
      signal,
      rows.native,
    )) {
      signal?.throwIfAborted();
      const rowStrip = strip === 'allButLast' ? 'all' : strip;
      const contents = filterThinkingForContext(
        [row],
        count === lastThinking ? 'none' : rowStrip,
      );
      const mapper = await mapping.rowIds?.(row, count);
      observeRequestRepresentation('neutral', row);
      yield* observeRequestRepresentation(
        'converted',
        convertToVercelMessages(contents, mapper?.(), {
          includeReasoningInContext: reasoning.includeInContext,
        }),
      );
      count++;
    }
    if (count !== rows.count)
      throw new Error('Provider request rows count changed');
  } finally {
    await mapping.release();
  }
}
