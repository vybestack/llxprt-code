/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SeededRandom } from '../../../../openai/__tests__/support/chatBodyCorpus.js';
import { wireHistory } from './wireBuilderCorpus.js';

export interface CacheHistoryOptions {
  /** Rows may carry `cacheAnchor`; off removes every stamp the base corpus makes. */
  readonly anchors: boolean;
  /** A row may carry the media purge boundary tag. */
  readonly purgeBoundary: boolean;
}

function withAnchor(row: IContent): IContent {
  return { ...row, metadata: { ...row.metadata, cacheAnchor: true } };
}

function withoutAnchor(row: IContent): IContent {
  if (row.metadata?.cacheAnchor === undefined) return row;
  const { cacheAnchor: _removed, ...rest } = row.metadata;
  return { ...row, metadata: rest };
}

function hasImage(row: IContent): boolean {
  return row.blocks.some(
    (block) => block.type === 'media' && block.mimeType.startsWith('image/'),
  );
}

function isImage(block: IContent['blocks'][number]): boolean {
  return block.type === 'media' && block.mimeType.startsWith('image/');
}

/**
 * Where the provider puts the boundary: on the block before the first image.
 * That is the text in front of the image in the image's own row, or the last
 * block of the row before when the image comes first.
 */
function beforeFirstImage(
  rows: readonly IContent[],
): { row: number; block: number } | undefined {
  const row = rows.findIndex(hasImage);
  if (row === -1) return undefined;
  const image = rows[row].blocks.findIndex(isImage);
  if (image > 0) return { row, block: image - 1 };
  if (row > 0 && rows[row - 1].blocks.length > 0)
    return { row: row - 1, block: rows[row - 1].blocks.length - 1 };
  return undefined;
}

/**
 * The row to tag with the purge boundary and the index of the block in it.
 * Often it is where the provider puts it; otherwise any row, with a tool
 * response block when it is a tool row.
 */
function boundaryTarget(
  random: SeededRandom,
  rows: readonly IContent[],
): { row: number; block: number } | undefined {
  const exact = beforeFirstImage(rows);
  if (exact !== undefined && random.chance(0.7)) return exact;
  const row = random.int(rows.length);
  const blocks = rows[row].blocks;
  if (blocks.length === 0) return undefined;
  const responses = blocks.flatMap((block, index) =>
    block.type === 'tool_response' ? [index] : [],
  );
  if (rows[row].speaker === 'tool' && responses.length > 0)
    return { row, block: random.pick(responses) };
  return { row, block: random.int(blocks.length) };
}

/**
 * A history of the wire corpus with cache tags added: `cacheAnchor` on a
 * share of the rows of every speaker, and one purge boundary tag (a request
 * has one identity). The tags are chosen from the seed.
 */
export function cacheHistory(
  seed: number,
  options: CacheHistoryOptions,
): IContent[] {
  const random = new SeededRandom(seed * 104729 + 7);
  const rows = wireHistory(seed).map((row) => {
    if (!options.anchors) return withoutAnchor(row);
    return random.chance(0.2) ? withAnchor(row) : row;
  });
  const target = options.purgeBoundary
    ? boundaryTarget(random, rows)
    : undefined;
  if (target === undefined) return rows;
  const boundaryId = Object.freeze({});
  return rows.map((row, index) => {
    if (index !== target.row) return row;
    return {
      ...row,
      metadata: {
        ...row.metadata,
        semanticMediaPurgeBoundary: {
          blockIndex: target.block,
          boundaryId,
        },
        // The boundary block often doubles as the preserved-head anchor.
        ...(random.chance(0.3) ? { cacheAnchor: true } : {}),
      },
    };
  });
}
