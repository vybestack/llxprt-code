/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { vi } from 'bun:test';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { installPinnedCandidateValues } from './support/pinned-candidate-fixture.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { getCompressionStrategy } from '../compressionStrategyFactory.js';
import { isArrayStrategyDouble } from './support/array-strategy-double.js';

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
    if (!isArrayStrategyDouble(strategy))
      throw new Error('Expected an array strategy double');
    const rows = [];
    for await (const row of context.history) rows.push(row);
    const result = await strategy.compress({
      ...context,
      history: rows,
    });
    if (result.kind === 'noop') return result;
    const estimate = history.estimateTokensForContents;
    if ('mockRestore' in estimate && typeof estimate.mockRestore === 'function')
      estimate.mockRestore();
    installPinnedCandidateValues(context.history, result.newHistory);
    return { kind: 'applied', start: 0, metadata: result.metadata };
  });
}
