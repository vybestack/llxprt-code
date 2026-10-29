/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import {
  streamCompressionOutputRows,
  type CompressionOutputRows,
} from './summaryOutput.js';
import type {
  DetachedHistoryOptions,
  DetachedHistorySink,
} from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import { validateHistoryEntry } from '@vybestack/llxprt-code-core/services/history/historyBatchContracts.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { appendCandidateRow } from './curatedCandidate.js';
import { replacedSpan } from './diskTruncation.js';

type Span = Awaited<ReturnType<typeof replacedSpan>>;

async function writeCompressionValues(
  sink: DetachedHistorySink,
  candidate: CompressionOutputRows,
  start: number,
  top: number,
  annotation: Span,
  selectSummary: (row: IContent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let index = 0;
  for await (const {
    row,
    position,
    sourceOrdinal,
  } of streamCompressionOutputRows(candidate, start, signal)) {
    if (row.speaker === 'ai' && row.blocks.length === 0) continue;
    const metadata = { ...row.metadata };
    if (
      annotation.span.itemCount > 0 &&
      metadata.isSummary === true &&
      metadata.chronologyReplaced === undefined
    )
      metadata.chronologyReplaced = annotation.span;
    if (
      position === start &&
      !annotation.hasFrontier &&
      annotation.frontier !== undefined
    )
      metadata.semanticMediaPurgeFrontier = annotation.frontier;
    delete metadata.cacheAnchor;
    if (position === start + top - 1) metadata.cacheAnchor = true;
    const [clean] = invalidateResponsesStatefulChain([{ ...row, metadata }]);
    validateHistoryEntry(clean, index++);
    selectSummary(clean);
    await appendCandidateRow(sink, clean, sourceOrdinal);
  }
}

export async function applyCompressionValuesWithAnchor(
  history: Pick<
    HistoryService,
    'detachedValues' | 'setCacheAnchorSeq' | 'resetCacheAnchorSeq'
  >,
  previous: HistoryDumpSource,
  candidate: CompressionOutputRows,
  start: number,
  model: string,
  top = 0,
  options: DetachedHistoryOptions = {},
): Promise<IContent | undefined> {
  options.signal?.throwIfAborted();
  if (top > candidate.length - start)
    throw new Error('Preserved cache-anchor position exceeds candidate length');
  const anchor =
    top > 0
      ? (await candidate.readRow(start + top - 1)).metadata?.chronology?.seq
      : undefined;
  if (
    top > 0 &&
    (anchor === undefined || !Number.isInteger(anchor) || anchor <= 0)
  )
    throw new Error('Preserved cache-anchor entry has no valid chronology seq');
  const annotation = await replacedSpan(previous, candidate, start);
  let summary: IContent | undefined;
  let marked = false;
  const selectSummary = (row: IContent): void => {
    if (!marked && row.metadata?.reason === 'compression-state-snapshot') {
      summary = row;
      marked = true;
    } else if (
      summary === undefined &&
      (row.metadata?.isSummary === true ||
        (row.metadata?.synthetic === true &&
          row.blocks.some(
            (block) =>
              block.type === 'text' && block.text.includes('<state_snapshot>'),
          )))
    )
      summary = row;
  };
  await history.detachedValues.transform(
    (_source, sink) =>
      writeCompressionValues(
        sink,
        candidate,
        start,
        top,
        annotation,
        selectSummary,
        options.signal,
      ),
    model,
    options,
  );
  if (anchor === undefined) history.resetCacheAnchorSeq();
  else history.setCacheAnchorSeq(anchor);
  return summary;
}
