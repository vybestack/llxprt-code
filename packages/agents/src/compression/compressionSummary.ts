/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export function selectCompressionSummary(
  newHistory: readonly IContent[],
): IContent | undefined {
  for (const entry of newHistory) {
    if (entry.metadata?.reason === 'compression-state-snapshot') return entry;
  }
  for (const entry of newHistory) {
    if (
      entry.metadata?.isSummary === true ||
      (entry.metadata?.synthetic === true &&
        entry.blocks.some(
          (block) =>
            block.type === 'text' && block.text.includes('<state_snapshot>'),
        ))
    )
      return entry;
  }
  return undefined;
}
