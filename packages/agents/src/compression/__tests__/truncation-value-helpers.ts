/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { buildRuntimeContext } from '../../core/__tests__/chatSession-density-helpers.js';
import { truncationRow } from './truncation-stream-helpers.js';
import { runDiskTruncation } from '../diskTruncation.js';

export function truncationValueRow(index: number, bytes = 2048): IContent {
  const original = truncationRow(index, 0);
  return {
    ...original,
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `${index}:${'x'.repeat(bytes)}` }],
    metadata: {
      ...original.metadata,
      ...(index % 2 === 1 ? { responsesStored: true } : {}),
    },
  };
}

export function expectedTruncationValue(
  index: number,
  start: number,
  bytes = 2048,
): IContent {
  const original = truncationValueRow(index, bytes);
  const metadata = { ...original.metadata };
  delete metadata.cacheAnchor;
  if (original.speaker === 'ai') delete metadata.responsesStored;
  if (index === start)
    metadata.semanticMediaPurgeFrontier = { contentIndex: 1, blockIndex: 0 };
  return { ...original, metadata };
}

export async function* truncationValues(
  size: number,
  start = 0,
  bytes = 2048,
  expected = false,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = start; index < size; index++)
    yield expected
      ? expectedTruncationValue(index, start, bytes)
      : truncationValueRow(index, bytes);
}

export function executeTruncation(
  history: HistoryService,
  size: number,
): ReturnType<typeof runDiskTruncation> {
  return runDiskTruncation(
    'truncation-values',
    buildRuntimeContext(history),
    history,
    async () => {
      throw new Error('Truncation cannot request an LLM');
    },
    undefined,
    undefined,
    new DebugLogger('test:truncation-values'),
    { targetTokenCount: Math.max(2, size - 11) },
  );
}
