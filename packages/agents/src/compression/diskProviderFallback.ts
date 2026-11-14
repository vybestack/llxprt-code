/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { checkpointRows } from '@vybestack/llxprt-code-core/services/history/historyCheckpointRows.js';
import type { CompressionInputRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildCompressionMetadata } from './compressionContextBuilder.js';
import { curatedCandidate } from './curatedCandidate.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { CompressionSummarySelection } from './compressionSummary.js';
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
    const selection = new CompressionSummarySelection();
    for (let position = result.start; position < rows.length; position++)
      selection.observe(await rows.readRow(position));
    const summary = selection.summary;
    await applyResult({
      rows,
      start: result.start,
      hasPendingRows: false,
      sourceOrdinalAt: (index) => rows.sourceOrdinalAt(index),
    });
    return { outcome: 'applied', summary };
  };
  return args[3].detachedValues.withCheckpoint(async (snapshot) => {
    if (
      'compressionInput' in snapshot &&
      snapshot.compressionInput !== undefined
    )
      return compress(snapshot.compressionInput.rows);
    const rows = await curatedCandidate(
      args[3].scratchRoots,
      checkpointRows(snapshot),
    );
    try {
      return await compress(rows);
    } finally {
      rows.close();
    }
  });
}
