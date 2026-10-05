/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { HistoryDumpSource } from '@vybestack/llxprt-code-core/services/history/historyDumpSnapshot.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retryWithBackoff } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  shouldRetryCompressionError,
  isFallbackEligibleCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { HighDensityStrategy } from './HighDensityStrategy.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { publishCandidate } from './diskTruncation.js';
import { fallbackDisk } from './diskMiddleOut.js';

type Outcome = {
  readonly outcome: 'applied' | 'noop' | 'failed';
  readonly summary?: IContent;
};

async function compressPinned(
  context: Parameters<HighDensityStrategy['compressDisk']>[0] & {
    readonly history: HistoryDensityRows;
  },
  history: HistoryService,
  previous: HistoryDumpSource,
): Promise<Outcome> {
  const strategy = new HighDensityStrategy();
  let candidate: HistoryDensityRows | undefined;
  try {
    let result: Awaited<ReturnType<HighDensityStrategy['compressDisk']>>;
    try {
      result = await retryWithBackoff(
        async () => {
          candidate?.close();
          candidate = undefined;
          candidate = new HistoryDensityRows(strategy.diskCompressionOwnership);
          return strategy.compressDisk(context, candidate);
        },
        {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 10000,
          shouldRetryOnError: shouldRetryCompressionError,
        },
      );
    } catch (error) {
      if (!isFallbackEligibleCompressionError(error)) throw error;
      context.logger.warn(
        'Primary disk high-density compression failed, attempting disk truncation',
        error,
      );
      return await fallbackDisk(context, history, previous, error);
    }
    if (result.kind === 'noop') return { outcome: 'noop' };
    if (candidate === undefined)
      throw new Error('Missing high-density disk candidate');
    const summary = await publishCandidate(
      history,
      previous,
      candidate,
      result.start,
      context.runtimeState.model,
    );
    return { outcome: 'applied', summary };
  } finally {
    candidate?.close();
  }
}

async function prepareCurated(
  previous: HistoryDumpSource,
  curated: HistoryDensityRows,
): Promise<void> {
  for await (const row of previous.rows())
    if (isCuratedContent(row)) curated.append(row);
}

export async function runDiskHighDensity(
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<Outcome> {
  const metadata = await buildCompressionMetadata(...args);
  const history = args[2];
  return history.detachedValues.withCheckpoint(async (checkpoint) => {
    const previous: HistoryDumpSource = {
      async *rows() {
        yield* checkpoint;
      },
    };
    const curated = new HistoryDensityRows();
    try {
      await prepareCurated(previous, curated);
      return await compressPinned(
        { ...metadata, history: curated },
        history,
        previous,
      );
    } finally {
      curated.close();
    }
  });
}
