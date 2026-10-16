/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
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
  let count = 0;
  for await (const row of history.getComprehensive()) {
    void row;
    count += 1;
  }
  return count;
}
