/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
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
  context: Parameters<HighDensityStrategy['compressDisk']>[0],
  history: HistoryService,
  previous: HistoryDumpSource,
  origin?: object,
): Promise<Outcome> {
  const strategy = new HighDensityStrategy();
  let candidate: HistoryDensityRows | undefined;
  let result: { readonly outcome: Outcome } | { readonly error: unknown };
  const attempt = async (): Promise<Outcome> => {
    let prepared: Awaited<ReturnType<HighDensityStrategy['compressDisk']>>;
    try {
      prepared = await retryWithBackoff(
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
      return fallbackDisk(context, history, previous, error, origin);
    }
    if (prepared.kind === 'noop') return { outcome: 'noop' };
    if (candidate === undefined)
      throw new Error('Missing high-density disk candidate');
    const rows = candidate;
    const summary = await publishCandidate(
      history,
      previous,
      rows,
      prepared.start,
      context.runtimeState.model,
      0,
      { origin },
      (position) => rows.sourceOrdinalAt(position),
    );
    return { outcome: 'applied', summary };
  };
  try {
    result = { outcome: await attempt() };
  } catch (error) {
    result = { error };
  }
  try {
    candidate?.close();
  } catch (error) {
    throw new AggregateError(
      'error' in result ? [result.error, error] : [error],
      'High-density candidate cleanup failed',
      { cause: 'error' in result ? result.error : undefined },
    );
  }
  if ('error' in result) throw result.error;
  return result.outcome;
}

export async function runDiskHighDensity(
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<Outcome> {
  const metadata = await buildCompressionMetadata(...args);
  const history = args[2];
  const input = await history.openCompressionInput();
  let result: { readonly outcome: Outcome } | { readonly error: unknown };
  try {
    result = {
      outcome: await compressPinned(
        { ...metadata, history: input.rows },
        history,
        input.previous,
        args[7]?.historyOrigin,
      ),
    };
  } catch (error) {
    result = { error };
  }
  try {
    await input.close();
  } catch (error) {
    throw new AggregateError(
      'error' in result ? [result.error, error] : [error],
      'High-density input cleanup failed',
      { cause: 'error' in result ? result.error : undefined },
    );
  }
  if ('error' in result) throw result.error;
  return result.outcome;
}
