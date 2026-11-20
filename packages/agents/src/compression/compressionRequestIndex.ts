/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestIndex } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { HistoryReaderScope } from '@vybestack/llxprt-code-core/services/history/historyReaderScope.js';

/**
 * Sanitization projects every journal tool occurrence into text. Its selected
 * occurrence index is therefore empty, independent of the source range. Only
 * framing rows need checking: production compression framing is ordinary text.
 */
export function compressionRequestIndex(
  count: number,
  framing: readonly IContent[],
  scope: HistoryReaderScope,
): ProviderRequestIndex {
  if (
    framing.some((row) =>
      row.blocks.some(
        (block) => block.type === 'tool_call' || block.type === 'tool_response',
      ),
    )
  )
    throw new Error('Compression framing must not contain structural tools');
  return {
    count,
    toolFree: true,
    normalizedCount: (_family, _kind, _id, range) =>
      scope.read(async () => {
        if (range !== undefined) {
          if (!Number.isInteger(range.from) || !Number.isInteger(range.to))
            throw new RangeError('Occurrence range requires integer indices');
          if (range.from < 0 || range.to < range.from || range.to > count)
            throw new RangeError('Occurrence range is outside the request');
        }
        return 0;
      }),
    normalizedPosition: (_family, _kind, _id, ordinal) =>
      scope.read(async () => {
        if (!Number.isInteger(ordinal) || ordinal < 1)
          throw new RangeError('Occurrence ordinal must be positive');
        return undefined;
      }),
  };
}
