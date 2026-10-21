/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { curatedCandidate } from './curatedCandidate.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { selectCompressionSummary } from './compressionSummary.js';
import type { ProviderFallbackCandidate } from './providerFallbackCandidate.js';

type FallbackOutcome = {
  readonly outcome: 'applied' | 'noop';
  readonly summary?: IContent;
};

export async function runDiskProviderFallback(
  applyResult: (candidate: ProviderFallbackCandidate) => Promise<void>,
  ...args: Parameters<typeof buildCompressionMetadata>
): Promise<FallbackOutcome> {
  const metadata = await buildCompressionMetadata(...args);
  const compress = async (
    rows: CompressionInputRows,
  ): Promise<FallbackOutcome> => {
    const result = await new TopDownTruncationStrategy().compressDisk({
      ...metadata,
      history: rows,
    });
    if (result.kind === 'noop') return { outcome: 'noop' };
    let summary: IContent | undefined;
    for (let position = result.start; position < rows.length; position++) {
      const row = await rows.readRow(position);
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
      sourceOrdinalAt: (index) => rows.sourceOrdinalAt(index),
    });
    return { outcome: 'applied', summary };
  };
  return args[2].detachedValues.withCheckpoint(async (snapshot) => {
    if (
      'compressionInput' in snapshot &&
      snapshot.compressionInput !== undefined
    )
      return compress(snapshot.compressionInput.rows);
    const rows = await curatedCandidate(checkpointRows(snapshot));
    try {
      return await compress(rows);
    } finally {
      rows.close();
    }
  });
}
