/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import {
  replaceRankedToolResponse,
  withToolResponseRanking,
} from '../toolResponseDiskRanking.js';

export type ValueRoute = 'purge' | 'ranking';

export function purgeRankingRow(index: number, bytes = 2048): IContent {
  const row = toolRankingRow(index, 0);
  const pair = Math.floor((index + 1) / 2);
  return {
    ...row,
    speaker: index % 2 === 1 ? 'ai' : 'human',
    blocks: [
      { type: 'text', text: `${index}:${'x'.repeat(bytes)}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'audio/wav',
        data: 'aGVsbG8=',
      },
      index % 2 === 1
        ? {
            type: 'tool_call',
            id: `pair-${pair}`,
            name: 'read_file',
            parameters: { index, payload: 'x'.repeat(bytes) },
          }
        : {
            type: 'tool_response',
            callId: `pair-${pair}`,
            toolName: 'read_file',
            result: { index, payload: 'complete response' },
          },
      ...(index === 0
        ? [
            {
              type: 'media',
              encoding: 'base64',
              mimeType: 'image/png',
              data: 'aW1hZ2U=',
              sourceContentId: 'purge-image',
            } satisfies IContent['blocks'][number],
          ]
        : []),
    ],
  };
}

export function rankedReplacement(index: number): ToolResponseBlock {
  return {
    type: 'tool_response',
    callId: `pair-${Math.floor((index + 1) / 2)}`,
    toolName: 'read_file',
    result: { summary: 'disk replacement' },
  };
}

export function expectedPurgeRankingRow(
  route: ValueRoute,
  index: number,
  size: number,
  bytes = 2048,
): IContent {
  const original = purgeRankingRow(index, bytes);
  const metadata = { ...original.metadata };
  if (original.speaker === 'ai') delete metadata.responsesStored;
  if (route === 'purge' && index === 0)
    metadata.semanticMediaPurgeFrontier = { contentIndex: 0, blockIndex: 2 };
  if (route === 'purge' && index === 0)
    return { ...original, blocks: original.blocks.slice(0, 3), metadata };
  if (route === 'ranking' && index === Math.max(0, size - 2))
    return {
      ...original,
      blocks: original.blocks.map((block, blockIndex) =>
        blockIndex === 2 ? rankedReplacement(index) : block,
      ),
      metadata,
    };
  return { ...original, metadata };
}

export async function* purgeRankingRows(
  size: number,
  bytes = 2048,
  route?: ValueRoute,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield route === undefined
      ? purgeRankingRow(index, bytes)
      : expectedPurgeRankingRow(route, index, size, bytes);
}

export async function prepareValueRoute(
  history: HistoryService,
  route: ValueRoute,
  size: number,
  ownership?: RowOwnership,
): Promise<{
  execute(): Promise<unknown>;
  rollback(): Promise<void>;
  close(): void;
}> {
  if (route === 'purge') {
    const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
      enabled: true,
      explicitCacheWriteRequired: false,
      ownership,
    });
    const transaction = await coordinator.begin({ mode: 'remove' });
    if (transaction === undefined) throw new Error('Missing purge transaction');
    return {
      execute: () =>
        coordinator.commit(transaction, {
          status: 'success',
          cachePrefixWritten: true,
        }),
      rollback: () => coordinator.rollback(transaction),
      close: () => transaction.close(),
    };
  }
  const entryIndex = Math.max(0, size - 2);
  return {
    execute: () =>
      withToolResponseRanking(
        history,
        [],
        async (block) => (block.type === 'tool_response' ? 100 : 1),
        async (ranked, unchanged) => {
          if (!(await unchanged())) throw new Error('Ranking source changed');
          let previous = size;
          for (const candidate of ranked) {
            if (candidate.entryIndex >= previous)
              throw new Error('Ranking tie order changed');
            previous = candidate.entryIndex;
            if (candidate.entryIndex === entryIndex)
              return replaceRankedToolResponse(
                history,
                candidate,
                rankedReplacement(entryIndex),
                'test',
              );
          }
          throw new Error('Missing ranked response');
        },
      ),
    rollback: async () => {},
    close: () => {},
  };
}
