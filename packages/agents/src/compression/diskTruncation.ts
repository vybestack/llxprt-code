/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { CompressionIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { DetachedHistoryOptions } from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import { CompressionSpanIndex } from '@vybestack/llxprt-code-core/services/history/compression-span-index.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
  type ContentMetadata,
  type ChronologyReplacedSpan,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { appendCandidateRow, curatedCandidate } from './curatedCandidate.js';
import {
  TopDownTruncationStrategy,
  type DiskTruncationResult,
} from './TopDownTruncationStrategy.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import { shouldRetryCompressionError } from '@vybestack/llxprt-code-core/core/compression/types.js';

export async function replacedSpan(
  previous: HistoryDumpSource,
  candidate: CompressionIndexedRows,
  start: number,
  signal?: AbortSignal,
): Promise<{
  span: ChronologyReplacedSpan;
  frontier: ContentMetadata['semanticMediaPurgeFrontier'];
  hasFrontier: boolean;
}> {
  if (
    previous.compressionSpan !== undefined &&
    candidate.chronologySelection !== undefined
  ) {
    signal?.throwIfAborted();
    let hasFrontier = false;
    for (let position = start; position < candidate.length; position++) {
      signal?.throwIfAborted();
      if (
        (await candidate.readRow(position)).metadata
          ?.semanticMediaPurgeFrontier !== undefined
      )
        hasFrontier = true;
    }
    return previous.compressionSpan(
      await candidate.chronologySelection(start),
      hasFrontier,
      signal,
    );
  }
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
      const row = await candidate.readRow(position);
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

interface CandidateAnnotation {
  readonly start: number;
  readonly top: number;
  readonly span: ChronologyReplacedSpan;
  /** The semantic purge frontier the first candidate row takes; undefined when the history has one. */
  readonly frontier: ContentMetadata['semanticMediaPurgeFrontier'];
}

function annotateCandidateRow(
  row: IContent,
  position: number,
  { start, top, span, frontier }: CandidateAnnotation,
): IContent {
  const metadata = { ...row.metadata };
  if (
    span.itemCount > 0 &&
    metadata.isSummary === true &&
    metadata.chronologyReplaced === undefined
  )
    metadata.chronologyReplaced = span;
  if (position === start && frontier !== undefined)
    metadata.semanticMediaPurgeFrontier = frontier;
  delete metadata.cacheAnchor;
  if (position === start + top - 1) metadata.cacheAnchor = true;
  return { ...row, metadata };
}

export async function publishCandidate(
  history: Pick<
    HistoryService,
    'detachedValues' | 'setCacheAnchorSeq' | 'resetCacheAnchorSeq'
  >,
  previous: HistoryDumpSource,
  curated: CompressionIndexedRows,
  start: number,
  model: string,
  top = 0,
  options: DetachedHistoryOptions = {},
  sourceOrdinalAt?: (
    position: number,
  ) => number | undefined | Promise<number | undefined>,
): Promise<IContent | undefined> {
  options.signal?.throwIfAborted();
  const anchor =
    top > 0
      ? (await curated.readRow(start + top - 1)).metadata?.chronology?.seq
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
        const [clean] = invalidateResponsesStatefulChain([
          annotateCandidateRow(await curated.readRow(position), position, {
            start,
            top,
            span,
            frontier: hasFrontier ? undefined : frontier,
          }),
        ]);
        await appendCandidateRow(
          sink,
          sanitizeProviderContentForSerialization(clean),
          await sourceOrdinalAt?.(position),
        );
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
  const origin = args[7]?.historyOrigin;
  const compress = (
    rows: CompressionIndexedRows,
  ): Promise<DiskTruncationResult> =>
    retryWithBackoff(
      () =>
        new TopDownTruncationStrategy().compressDisk({
          ...metadata,
          history: rows,
        }),
      {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        shouldRetryOnError: shouldRetryCompressionError,
      },
    );
  return history.detachedValues.withCheckpoint(async (previous) => {
    if (
      'compressionInput' in previous &&
      previous.compressionInput !== undefined
    ) {
      const input = previous.compressionInput;
      const result = await compress(input.rows);
      if (result.kind === 'noop') return { outcome: 'noop' };
      const summary = await publishCandidate(
        history,
        input.previous,
        input.rows,
        result.start,
        metadata.runtimeState.model,
        0,
        { origin },
        (position) => input.rows.sourceOrdinalAt(position),
      );
      return { outcome: 'applied', summary };
    }
    const curated = await curatedCandidate(checkpointRows(previous));
    try {
      const result = await compress(curated);
      if (result.kind === 'noop') return { outcome: 'noop' };
      const summary = await publishCandidate(
        history,
        {
          async *rows() {
            yield* checkpointRows(previous);
          },
        },
        curated,
        result.start,
        metadata.runtimeState.model,
        0,
        { origin },
        (position) => curated.sourceOrdinalAt(position),
      );
      return { outcome: 'applied', summary };
    } finally {
      curated.close();
    }
  });
}
