/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  shouldRetryCompressionError,
  isFallbackEligibleCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { applyCompressionValuesWithAnchor } from './cache-anchor-values.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';

export async function fallbackDisk(
  context: Parameters<TopDownTruncationStrategy['compressDisk']>[0] & {
    readonly history: HistoryDensityRows;
  },
  history: HistoryService,
  previous: HistoryDumpSource,
  primaryError: unknown,
): Promise<{
  readonly outcome: 'applied' | 'noop' | 'failed';
  readonly summary?: IContent;
}> {
  try {
    const fallback = await new TopDownTruncationStrategy().compressDisk(
      context,
    );
    if (fallback.kind === 'noop') return { outcome: 'noop' };
    const summary = await applyCompressionValuesWithAnchor(
      history,
      previous,
      context.history,
      fallback.start,
      context.runtimeState.model,
    );
    return { outcome: 'applied', summary };
  } catch (fallbackError) {
    context.logger.error('Fallback disk compression failed', {
      primaryError,
      fallbackError,
    });
    return { outcome: 'failed' };
  }
}

type DiskSummaryOutcome = {
  readonly outcome: 'applied' | 'noop' | 'failed';
  readonly summary?: IContent;
};

export function runDiskMiddleOut(
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  return runDiskSummary('middle-out', ...args);
}

export function runDiskOneShot(
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  return runDiskSummary('one-shot', ...args);
}

async function runDiskSummary(
  name: 'middle-out' | 'one-shot',
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  const metadata = await buildCompressionMetadata(...args);
  const history = args[2];
  const previous = await history.openDumpSnapshot();
  const curated = new HistoryDensityRows();
  const candidate = new HistoryDensityRows();
  try {
    for await (const row of previous.rows())
      if (isCuratedContent(row)) curated.append(row);
    const context = { ...metadata, history: curated };
    const strategy =
      name === 'middle-out' ? new MiddleOutStrategy() : new OneShotStrategy();
    let result: Awaited<ReturnType<MiddleOutStrategy['compressDisk']>>;
    try {
      result = await retryWithBackoff(
        () => strategy.compressDisk(context, candidate),
        {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 10000,
          shouldRetryOnError: shouldRetryCompressionError,
        },
      );
      if (name === 'middle-out' && result.kind === 'noop')
        result = await new OneShotStrategy().compressDisk(context, candidate);
    } catch (primaryError) {
      if (!isFallbackEligibleCompressionError(primaryError)) throw primaryError;
      metadata.logger.warn(
        'Primary disk compression failed, attempting fallback truncation',
        primaryError,
      );
      return await fallbackDisk(context, history, previous, primaryError);
    }
    if (result.kind === 'noop') return { outcome: 'noop' };
    const summary = await applyCompressionValuesWithAnchor(
      history,
      previous,
      candidate,
      0,
      metadata.runtimeState.model,
      result.top,
    );
    return { outcome: 'applied', summary };
  } finally {
    candidate.close();
    curated.close();
    await previous.close();
  }
}
