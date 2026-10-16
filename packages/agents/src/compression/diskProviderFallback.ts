/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DetachedHistoryJournal } from '@vybestack/llxprt-code-core/services/history/detachedHistoryJournal.js';
import { isCuratedContent } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { selectCompressionSummary } from './compressionSummary.js';
import type { ProviderFallbackCandidate } from './providerFallbackCandidate.js';

export async function runDiskProviderFallback(
  applyResult: (candidate: ProviderFallbackCandidate) => Promise<void>,
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<{
  readonly outcome: 'applied' | 'noop';
  readonly summary?: IContent;
}> {
  const metadata = await buildCompressionMetadata(...args);
  return args[2].detachedValues.withCheckpoint(async (snapshot) => {
    const rows = new DetachedHistoryJournal();
    try {
      for (const row of snapshot) {
        if (!isCuratedContent(row)) continue;
        rows.append(row);
      }
      const result = await new TopDownTruncationStrategy().compressDisk({
        ...metadata,
        history: rows,
      });
      if (result.kind === 'noop') return { outcome: 'noop' };
      let summary: IContent | undefined;
      for (let position = result.start; position < rows.length; position++) {
        const row = rows.readRow(position);
        const selected = selectCompressionSummary([row]);
        if (row.metadata?.reason === 'compression-state-snapshot') {
          summary = selected;
          break;
        }
        summary ??= selected;
      }
      await applyResult({
        rows,
        start: result.start,
        hasPendingRows: false,
      });
      return { outcome: 'applied', summary };
    } finally {
      rows.close();
    }
  });
}
