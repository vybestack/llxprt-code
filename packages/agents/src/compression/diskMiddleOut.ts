/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { SummaryOutput } from './summaryOutput.js';
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
    readonly history: CompressionInputRows;
  },
  history: HistoryService,
  previous: HistoryDumpSource,
  primaryError: unknown,
  origin?: object,
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
      0,
      { origin },
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

export interface SummaryTransport {
  readonly mediaResolver: ConstructorParameters<typeof MiddleOutStrategy>[0];
  readonly requestMediaBudgetBytes: ConstructorParameters<
    typeof MiddleOutStrategy
  >[1];
  readonly providerFileBindings: ConstructorParameters<
    typeof MiddleOutStrategy
  >[2];
  readonly providerFileLifecycle: ConstructorParameters<
    typeof MiddleOutStrategy
  >[3];
}

function middleOutStrategy(transport: SummaryTransport): MiddleOutStrategy {
  return new MiddleOutStrategy(
    transport.mediaResolver,
    transport.requestMediaBudgetBytes,
    transport.providerFileBindings,
    transport.providerFileLifecycle,
  );
}

export function runDiskMiddleOut(
  transport: SummaryTransport,
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  return runDiskSummary('middle-out', transport, ...args);
}

export function runDiskOneShot(
  transport: SummaryTransport,
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  return runDiskSummary('one-shot', transport, ...args);
}

async function runDiskSummary(
  name: 'middle-out' | 'one-shot',
  transport: SummaryTransport,
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<DiskSummaryOutcome> {
  const metadata = await buildCompressionMetadata(...args);
  const history = args[3];
  const origin = args[8]?.historyOrigin;
  const input = await history.openCompressionInput();
  const previous = input.previous;
  const attempt = async (): Promise<DiskSummaryOutcome> => {
    const context = { ...metadata, history: input.rows };
    const oneShot = new OneShotStrategy(
      transport.mediaResolver,
      transport.requestMediaBudgetBytes,
      transport.providerFileBindings,
      transport.providerFileLifecycle,
    );
    const strategy =
      name === 'middle-out' ? middleOutStrategy(transport) : oneShot;
    let result: SummaryOutput;
    try {
      result = await retryWithBackoff(() => strategy.prepareDisk(context), {
        maxAttempts: 3,
        initialDelayMs: 2000,
        maxDelayMs: 10000,
        shouldRetryOnError: shouldRetryCompressionError,
      });
      if (name === 'middle-out' && result.kind === 'noop')
        result = await oneShot.prepareDisk(context);
    } catch (primaryError) {
      if (!isFallbackEligibleCompressionError(primaryError)) throw primaryError;
      metadata.logger.warn(
        'Primary disk compression failed, attempting fallback truncation',
        primaryError,
      );
      return fallbackDisk(context, history, previous, primaryError, origin);
    }
    if (result.kind === 'noop') return { outcome: 'noop' };
    const summary = await applyCompressionValuesWithAnchor(
      history,
      previous,
      result.candidate,
      0,
      metadata.runtimeState.model,
      result.top,
      { origin },
    );
    return { outcome: 'applied', summary };
  };
  let result:
    | { readonly outcome: DiskSummaryOutcome }
    | { readonly error: unknown };
  try {
    result = { outcome: await attempt() };
  } catch (error) {
    result = { error };
  }
  const failures: unknown[] = [];
  for (const close of [() => input.close()]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      'error' in result ? [result.error, ...failures] : failures,
      'Compression attempt cleanup failed',
      { cause: 'error' in result ? result.error : undefined },
    );
  if ('error' in result) throw result.error;
  return result.outcome;
}
