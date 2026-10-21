/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  CompressionExecutionError,
  isTransientCompressionError,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  buildCompressionAttemptContext,
  type CompressionAttemptContext,
} from './compressionContextBuilder.js';

export async function prepareCompressionAttempt(
  hook: (context: CompressionAttemptContext) => Promise<void>,
  trigger: 'manual' | 'auto',
  ...args: Parameters<typeof buildCompressionAttemptContext>
): Promise<boolean> {
  const context = await buildCompressionAttemptContext(...args);
  try {
    await hook({ ...context, trigger });
  } catch {
    // Hook failures must not block compression.
  } finally {
    await context.history.return();
  }
  for await (const row of args[2].streamCuratedHistory()) {
    void row;
    return true;
  }
  return false;
}

export async function countCompressionRows(
  history: HistoryService,
): Promise<number> {
  const indexedCount = history.compressionRowCount;
  if (indexedCount !== undefined) return indexedCount;
  let count = 0;
  for await (const row of history.getComprehensive()) {
    void row;
    count += 1;
  }
  return count;
}

export function throwCompressionProviderFailure(
  strategy: string,
  error: unknown,
  signal: AbortSignal | undefined,
  diagnostics: {
    readonly finishReason?: string;
    readonly rawStopReason?: string;
    readonly blockTypeCounts: Readonly<Record<string, number>>;
  },
): never {
  if (signal?.aborted === true) throw signal.reason;
  const blocks =
    Object.entries(diagnostics.blockTypeCounts)
      .map(([type, count]) => `${type}:${count}`)
      .join(',') || 'none';
  const failure = new CompressionExecutionError(
    strategy,
    `LLM provider call failed: ${error instanceof Error ? error.message : String(error)} [partial diagnostics: finishReason=${diagnostics.finishReason ?? 'none'}, rawStopReason=${diagnostics.rawStopReason ?? 'none'}, blocks=${blocks}]`,
    { isTransient: isTransientCompressionError(error) },
  );
  failure.cause = error;
  throw failure;
}

export async function withCompressionRequest<T>(
  request: ProviderRequestSelection,
  consume: () => Promise<T>,
): Promise<T> {
  let result: { readonly value: T } | { readonly error: unknown };
  try {
    result = { value: await consume() };
  } catch (error) {
    result = { error };
  }
  try {
    await request.close();
  } catch (cleanup) {
    if ('error' in result)
      throw new AggregateError(
        [result.error, cleanup],
        'Compression request cleanup failed',
        { cause: result.error },
      );
    throw cleanup;
  }
  if ('error' in result) throw result.error;
  return result.value;
}
