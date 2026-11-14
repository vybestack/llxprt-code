/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalRequestOccurrences } from '@vybestack/llxprt-code-core/services/history/journal-request-occurrences.js';
import type { RepairMessage } from './anthropic-repair-source.js';

export interface AnthropicConsumedResult {
  readonly ordinal: number;
  readonly inserted: boolean;
}
export async function decideAnthropicTool(
  results: Pick<JournalRequestOccurrences, 'count' | 'countBefore'>,
  state: AnthropicConsumedResult,
  next: RepairMessage | undefined,
): Promise<{ readonly taken?: number; readonly missing: boolean }> {
  let taken: number | undefined;
  let missing = false;
  if (next?.role === 'user') {
    const before = await results.countBefore(next.start);
    const end = await results.countBefore(next.end + 1);
    if (Math.max(before + 1, state.ordinal + 1) > end) {
      const later = Math.max(end + 1, state.ordinal + 1);
      taken = later <= results.count ? later : undefined;
      missing = taken === undefined;
    }
  } else missing = results.count === 0 && !state.inserted;
  return { taken, missing };
}
