/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * How a row qualifies as the summary THIS compression produced: `marked` for
 * the explicit 'compression-state-snapshot' reason, `detected` for legacy
 * summary shapes, undefined otherwise.
 *
 * Rows the strategy carried over from history already carry a chronology
 * marker (HistoryService stamps every entry it stores), while a summary the
 * strategy just generated does not have one yet. Carried rows never qualify:
 * an earlier compression's summary kept at the head of history still has the
 * earlier call's usage and text (#4067).
 */
export function compressionSummaryRank(
  row: IContent,
): 'marked' | 'detected' | undefined {
  if (row.metadata?.chronology !== undefined) return undefined;
  if (row.metadata?.reason === 'compression-state-snapshot') return 'marked';
  if (
    row.metadata?.isSummary === true ||
    (row.metadata?.synthetic === true &&
      row.blocks.some(
        (block) =>
          block.type === 'text' && block.text.includes('<state_snapshot>'),
      ))
  )
    return 'detected';
  return undefined;
}

/** Tracks the produced summary while rows stream past, one row at a time. */
export class CompressionSummarySelection {
  private selected: IContent | undefined;
  private marked = false;

  observe(row: IContent): void {
    if (this.marked) return;
    const rank = compressionSummaryRank(row);
    if (rank === 'marked') {
      this.selected = row;
      this.marked = true;
    } else if (rank === 'detected') this.selected ??= row;
  }

  get summary(): IContent | undefined {
    return this.selected;
  }
}

export function selectCompressionSummary(
  newHistory: readonly IContent[],
): IContent | undefined {
  const selection = new CompressionSummarySelection();
  for (const entry of newHistory) selection.observe(entry);
  return selection.summary;
}
