/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import {
  admittedOrigin,
  droppedImageOf,
} from '@vybestack/llxprt-code-core/services/history/__tests__/support/dropped-media-expectation.js';
import { toolRankingRow } from './tool-truncation-stream-helpers.js';
import {
  replaceRankedToolResponse,
  withToolResponseRanking,
} from '../toolResponseDiskRanking.js';

export type ValueRoute = 'purge' | 'ranking';

/** Block index of the image a remove purge drops from row 0. */
export const PURGED_IMAGE_BLOCK = 3;

/**
 * A remove purge keeps a `media_dropped` reference where the image was, with
 * the origin admission gives that image and the drop time of the purge.
 */
function purgedRow(
  original: IContent,
  droppedAt: string | undefined,
): IContent['blocks'] {
  if (droppedAt === undefined)
    throw new Error('A purged row needs the time its image was dropped');
  const image = original.blocks[PURGED_IMAGE_BLOCK];
  return original.blocks.map((block, blockIndex) =>
    blockIndex === PURGED_IMAGE_BLOCK
      ? droppedImageOf(
          image,
          admittedOrigin(original, image, droppedAt),
          droppedAt,
        )
      : block,
  );
}

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * The wall-clock time a remove purge stamped on the reference it left in row
 * 0; the ranking route drops nothing.
 */
export async function droppedAtOf(
  history: HistoryService,
  route: ValueRoute,
): Promise<string | undefined> {
  if (route !== 'purge') return undefined;
  for await (const row of history.streamRawHistory()) {
    if (row.blocks.length <= PURGED_IMAGE_BLOCK)
      throw new Error(`Row 0 has no block ${PURGED_IMAGE_BLOCK}`);
    const block = row.blocks[PURGED_IMAGE_BLOCK];
    if (block.type !== 'media_dropped')
      throw new Error(`Expected a dropped image, found ${block.type}`);
    if (!ISO_TIME.test(block.droppedAt))
      throw new Error(`Dropped image time is not ISO: ${block.droppedAt}`);
    return block.droppedAt;
  }
  throw new Error('History has no rows');
}

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
  droppedAt?: string,
): IContent {
  const original = purgeRankingRow(index, bytes);
  const metadata = { ...original.metadata };
  if (original.speaker === 'ai') delete metadata.responsesStored;
  if (route === 'purge' && index === 0)
    // The frontier stays on the image's position, now its kept reference.
    metadata.semanticMediaPurgeFrontier = {
      contentIndex: 0,
      blockIndex: PURGED_IMAGE_BLOCK,
    };
  if (route === 'purge' && index === 0)
    return { ...original, blocks: purgedRow(original, droppedAt), metadata };
  if (
    route === 'ranking' &&
    index === Math.max(0, 2 * Math.floor((size - 2) / 2))
  )
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
  droppedAt?: string,
): AsyncGenerator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield route === undefined
      ? purgeRankingRow(index, bytes)
      : expectedPurgeRankingRow(route, index, size, bytes, droppedAt);
}

export async function prepareValueRoute(
  history: HistoryService,
  route: ValueRoute,
  size: number,
  ownership?: RowOwnership,
): Promise<{
  execute(): Promise<unknown>;
  rollback(): Promise<void>;
  close(): void | Promise<void>;
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
  const entryIndex = Math.max(0, 2 * Math.floor((size - 2) / 2));
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
