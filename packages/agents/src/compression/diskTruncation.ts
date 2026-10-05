/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type { DetachedHistoryOptions } from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import { CompressionSpanIndex } from '@vybestack/llxprt-code-core/services/history/compression-span-index.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
  type ContentMetadata,
  type ChronologyReplacedSpan,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { shouldRetryCompressionError } from '@vybestack/llxprt-code-core/core/compression/types.js';

export async function replacedSpan(
  previous: HistoryDumpSource,
  candidate: HistoryIndexedRows,
  start: number,
  signal?: AbortSignal,
): Promise<{
  span: ChronologyReplacedSpan;
  frontier: ContentMetadata['semanticMediaPurgeFrontier'];
  hasFrontier: boolean;
}> {
  const index = new CompressionSpanIndex();
  let fromSeq = Number.POSITIVE_INFINITY;
  let toSeq = Number.NEGATIVE_INFINITY;
  let itemCount = 0;
  let frontier: ContentMetadata['semanticMediaPurgeFrontier'];
  let captured = false;
  let hasFrontier = false;
  try {
    for (let position = start; position < candidate.length; position++) {
      signal?.throwIfAborted();
      const row = candidate.readRow(position);
      const seq = row.metadata?.chronology?.seq;
      if (typeof seq === 'number') index.preserve(seq);
      if (row.metadata?.semanticMediaPurgeFrontier !== undefined)
        hasFrontier = true;
    }
    for await (const row of previous.rows()) {
      signal?.throwIfAborted();
      if (!captured && row.metadata?.semanticMediaPurgeFrontier !== undefined) {
        captured = true;
        frontier = row.metadata.semanticMediaPurgeFrontier;
      }
      const seq = row.metadata?.chronology?.seq;
      if (typeof seq === 'number' && index.destroy(seq)) {
        itemCount++;
        fromSeq = Math.min(fromSeq, seq);
        toSeq = Math.max(toSeq, seq);
      }
    }
    return { span: { fromSeq, toSeq, itemCount }, frontier, hasFrontier };
  } finally {
    index.close();
  }
}

export async function publishCandidate(
  history: HistoryService,
  previous: HistoryDumpSource,
  curated: HistoryIndexedRows,
  start: number,
  model: string,
  top = 0,
  options: DetachedHistoryOptions = {},
): Promise<IContent | undefined> {
  options.signal?.throwIfAborted();
  const anchor =
    top > 0
      ? curated.readRow(start + top - 1).metadata?.chronology?.seq
      : undefined;
  if (
    top > 0 &&
    (anchor === undefined || !Number.isInteger(anchor) || anchor <= 0)
  )
    throw new Error('Preserved cache-anchor entry has no valid chronology seq');
  const { span, frontier, hasFrontier } = await replacedSpan(
    previous,
    curated,
    start,
    options.signal,
  );
  let summary: IContent | undefined;
  let marked = false;
  await history.detachedValues.transform(
    async (_source, sink) => {
      for (let position = start; position < curated.length; position++) {
        options.signal?.throwIfAborted();
        const row = curated.readRow(position);
        const metadata = { ...row.metadata };
        if (
          span.itemCount > 0 &&
          metadata.isSummary === true &&
          metadata.chronologyReplaced === undefined
        )
          metadata.chronologyReplaced = span;
        if (position === start && !hasFrontier && frontier !== undefined)
          metadata.semanticMediaPurgeFrontier = frontier;
        delete metadata.cacheAnchor;
        if (position === start + top - 1) metadata.cacheAnchor = true;
        const [clean] = invalidateResponsesStatefulChain([
          { ...row, metadata },
        ]);
        sink.appendValue(sanitizeProviderContentForSerialization(clean));
        if (
          !marked &&
          clean.metadata?.reason === 'compression-state-snapshot'
        ) {
          summary = clean;
          marked = true;
        } else if (
          summary === undefined &&
          (clean.metadata?.isSummary === true ||
            (clean.metadata?.synthetic === true &&
              clean.blocks.some(
                (block) =>
                  block.type === 'text' &&
                  block.text.includes('<state_snapshot>'),
              )))
        ) {
          summary = clean;
        }
      }
    },
    model,
    options,
  );
  if (anchor === undefined) history.resetCacheAnchorSeq();
  else history.setCacheAnchorSeq(anchor);
  return summary;
}

export async function runDiskTruncation(
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<{
  readonly outcome: 'applied' | 'noop';
  readonly summary?: IContent;
}> {
  const metadata = await buildCompressionMetadata(...args);
  const history = args[2];
  return history.detachedValues.withCheckpoint(async (previous) => {
    const curated = new DetachedHistoryJournal();
    try {
      for (const row of previous)
        if (isCuratedContent(row)) curated.append(row);
      const strategy = new TopDownTruncationStrategy();
      const result = await retryWithBackoff(
        () => strategy.compressDisk({ ...metadata, history: curated }),
        {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 10000,
          shouldRetryOnError: shouldRetryCompressionError,
        },
      );
      if (result.kind === 'noop') return { outcome: 'noop' };
      const summary = await publishCandidate(
        history,
        {
          async *rows() {
            yield* previous;
          },
        },
        curated,
        result.start,
        metadata.runtimeState.model,
      );
      return { outcome: 'applied', summary };
    } finally {
      curated.close();
    }
  });
}
