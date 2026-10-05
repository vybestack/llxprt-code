/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { DetachedHistoryOptions } from '@vybestack/llxprt-code-core/services/history/detachedHistoryAPI.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { replacedSpan } from './diskTruncation.js';

type Span = Awaited<ReturnType<typeof replacedSpan>>;

function* compressionValues(
  candidate: HistoryDensityRows,
  start: number,
  top: number,
  annotation: Span,
  selectSummary: (row: IContent) => void,
  signal?: AbortSignal,
): Generator<IContent, void, unknown> {
  for (let position = start; position < candidate.length; position++) {
    signal?.throwIfAborted();
    const row = candidate.readRow(position);
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
    selectSummary(clean);
    yield clean;
  }
}

export async function applyCompressionValuesWithAnchor(
  history: HistoryService,
  previous: HistoryDumpSource,
  candidate: HistoryDensityRows,
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
      ? candidate.readRow(start + top - 1).metadata?.chronology?.seq
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
  const rows = compressionValues(
    candidate,
    start,
    top,
    annotation,
    selectSummary,
    options.signal,
  );
  await history.detachedValues.replace(rows, model, options);
  if (anchor === undefined) history.resetCacheAnchorSeq();
  else history.setCacheAnchorSeq(anchor);
  return summary;
}
