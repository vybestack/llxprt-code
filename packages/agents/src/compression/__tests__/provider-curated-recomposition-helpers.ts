/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { enforceProviderSourceForTest } from './support/enforce-provider-source.js';
import { buildHandlerHarness } from './support/handler-harness.js';

/**
 * Runs the real source ladder over `history` plus `pending` without reducing
 * the BODY under comparison. Estimates depend on the candidate's rows, not
 * invocation order, because unchanged native candidates reuse their estimate.
 */
export async function recomposeFixture(
  history: HistoryService,
  pending: IContent[],
): Promise<IContent[]> {
  const harness = buildHandlerHarness(
    history,
    buildRuntimeContext(history, {
      contextLimit: 100_000,
      compressionThreshold: 0.5,
    }),
  );
  harness.performCompression.mockRejectedValue(
    new Error('unexpected compression'),
  );
  harness.setDiskFallback(async () => {
    throw new Error('unexpected fallback');
  });
  return enforceProviderSourceForTest(
    harness.handler,
    history,
    pending,
    'curated-stream',
    undefined,
    async (rows) => rows.length,
  );
}
