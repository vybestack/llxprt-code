/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { getCompressionStrategy } from '../compressionStrategyFactory.js';

const realDiskCompression = TopDownTruncationStrategy.prototype.compressDisk;

/** Adapts existing array strategy doubles without adding an eager production seam. */
export function installPendingLegacyStrategyFixture(
  history: HistoryService,
): void {
  let primary = false;
  history.on('compressionStarted', () => {
    primary = true;
  });
  history.on('compressionLockReleased', () => {
    primary = false;
  });
  vi.spyOn(
    TopDownTruncationStrategy.prototype,
    'compressDisk',
  ).mockImplementation(async function (
    this: TopDownTruncationStrategy,
    context,
  ) {
    const strategy = getCompressionStrategy('top-down-truncation');
    if (primary || strategy instanceof TopDownTruncationStrategy)
      return realDiskCompression.call(this, context);
    const result = await strategy.compress({
      ...context,
      history: [...context.history],
    });
    if (result.kind === 'noop') return result;
    if (
      !(context.history instanceof HistoryDensityRows) &&
      !(context.history instanceof DetachedHistoryJournal)
    )
      throw new Error('Expected indexed fixture candidate');
    const estimate = history.estimateTokensForContents;
    if ('mockRestore' in estimate && typeof estimate.mockRestore === 'function')
      estimate.mockRestore();
    const start = context.history.length;
    for (const row of result.newHistory) context.history.append(row);
    return { kind: 'applied', start, metadata: result.metadata };
  });
}
