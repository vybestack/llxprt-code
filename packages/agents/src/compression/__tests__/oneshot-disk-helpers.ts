/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { buildCompressionMetadata } from '../compressionContextBuilder.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { buildCompressionSystemInstruction } from '../compressionSystemPrompt.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { annotateCompressionSpan } from '@vybestack/llxprt-code-core/services/history/historyChronology.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  middleoutSetup,
  middleoutRow,
  SummaryTransport,
  MiddleoutDiskHistory,
} from './middleout-disk-helpers.js';
export {
  middleoutRow as oneshotRow,
  SummaryTransport,
  MiddleoutDiskHistory as OneshotDiskHistory,
};

export function oneshotSetup(
  ...args: Parameters<typeof middleoutSetup>
): ReturnType<typeof middleoutSetup> {
  return middleoutSetup(args[0], args[1], args[2], {
    ...args[3],
    compressionStrategy: 'one-shot',
  });
}

export async function oneshotOracle(
  history: HistoryService,
  size: number,
  bytes = 2048,
  makeRow: (index: number, bytes: number) => IContent = middleoutRow,
): Promise<{ rows: readonly IContent[]; requests: string[]; top: number }> {
  await buildCompressionSystemInstruction('test-model', {
    provider: 'summary-transport',
    interactionMode: 'non-interactive',
  });
  const { runtime, transport } = oneshotSetup(history);
  const logger = new DebugLogger('test:oneshot-oracle');
  const raw = Array.from({ length: size }, (_, index) => makeRow(index, bytes));
  const metadata = await buildCompressionMetadata(
    'oracle',
    runtime,
    history,
    async () => ({ provider: transport, runtime: runtime.providerRuntime }),
    async () => 'finish the experiment',
    () => '/fixture/session.jsonl',
    logger,
  );
  const result = await new OneShotStrategy().compress({
    ...metadata,
    history: buildCuratedHistory(logger, raw, false),
  });
  if (result.kind !== 'applied')
    throw new Error('Expected legacy one-shot oracle compression');
  const annotated = annotateCompressionSpan(raw, result.newHistory).map(
    (row) => {
      const metadata = { ...row.metadata };
      delete metadata.cacheAnchor;
      return { ...row, metadata };
    },
  );
  return {
    rows: invalidateResponsesStatefulChain(annotated),
    requests: transport.requests,
    top: 0,
  };
}
