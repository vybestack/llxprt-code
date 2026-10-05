/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ContentBlock } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { SemanticPurgeDiskRows } from './semantic-purge-disk-rows.js';
import {
  hasSummaryReplacement,
  isPurgeableImage,
  replacementBlock,
  restoredFrontierValue,
  type SemanticMediaPurgeBoundary,
  type SemanticMediaPurgeFrontier,
  type SemanticMediaPurgeOptions,
} from './semantic-media-purge.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function diskFrontier(
  rows: SemanticPurgeDiskRows,
): SemanticMediaPurgeFrontier {
  for (const row of rows) {
    const frontier = row.metadata?.semanticMediaPurgeFrontier;
    if (
      frontier !== undefined &&
      validCoordinate(frontier.contentIndex) &&
      validCoordinate(frontier.blockIndex)
    )
      return restoredFrontierValue(frontier);
  }
  return Object.freeze({ contentIndex: 0, blockIndex: 0 });
}

function mediaId(block: ContentBlock): string | undefined {
  if (block.type !== 'media') return undefined;
  return block.encoding === 'reference'
    ? block.contentId
    : block.sourceContentId;
}

function matchingImage(
  row: IContent,
  contentIndex: number,
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeBoundary | undefined {
  for (const [blockIndex, block] of row.blocks.entries()) {
    if (
      (frontier.mediaId === undefined || frontier.mediaId === mediaId(block)) &&
      isPurgeableImage(block, { contentIndex, blockIndex })
    )
      return { contentIndex, blockIndex };
  }
  return undefined;
}

function rebase(
  rows: SemanticPurgeDiskRows,
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeFrontier {
  if (frontier.contentId === undefined && frontier.mediaId === undefined)
    return frontier;
  let contentIndex = 0;
  for (const row of rows) {
    if (
      frontier.contentId === undefined ||
      frontier.contentId === row.metadata?.id
    ) {
      const match = matchingImage(row, contentIndex, frontier);
      if (match !== undefined) return match;
    }
    contentIndex++;
  }
  return { contentIndex: 0, blockIndex: 0 };
}

function atOrAfter(
  contentIndex: number,
  blockIndex: number,
  start: SemanticMediaPurgeFrontier,
): boolean {
  if (contentIndex !== start.contentIndex)
    return contentIndex > start.contentIndex;
  return blockIndex >= start.blockIndex;
}

export function locateDiskPurge(
  rows: SemanticPurgeDiskRows,
  frontier: SemanticMediaPurgeFrontier,
  options: SemanticMediaPurgeOptions,
):
  | {
      location: SemanticMediaPurgeBoundary;
      prefix: SemanticMediaPurgeBoundary | undefined;
    }
  | undefined {
  const start = rebase(rows, frontier);
  let prefix: SemanticMediaPurgeBoundary | undefined;
  let contentIndex = 0;
  for (const row of rows) {
    for (const [blockIndex, block] of row.blocks.entries()) {
      if (
        atOrAfter(contentIndex, blockIndex, start) &&
        isPurgeableImage(block, { contentIndex, blockIndex }) &&
        hasSummaryReplacement(block, options)
      )
        return { location: { contentIndex, blockIndex }, prefix };
      prefix = { contentIndex, blockIndex };
    }
    contentIndex++;
  }
  return undefined;
}

function positionalFrontier(
  rows: SemanticPurgeDiskRows,
  location: SemanticMediaPurgeBoundary,
  removed: boolean,
): SemanticMediaPurgeFrontier {
  if (rows.length === 0)
    return Object.freeze({ contentIndex: 0, blockIndex: 0 });
  const contentIndex = Math.min(location.contentIndex, rows.length - 1);
  return rows.withRow(contentIndex, (row) => {
    if (row.blocks.length === 0)
      throw new Error('Semantic media purge produced invalid history');
    let blockIndex = Math.min(location.blockIndex, row.blocks.length - 1);
    if (removed)
      blockIndex =
        contentIndex === location.contentIndex ? 0 : row.blocks.length - 1;
    return { contentIndex, blockIndex };
  });
}

function stableDiskFrontier(
  rows: SemanticPurgeDiskRows,
  positional: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeFrontier {
  const located = locateDiskPurge(rows, positional, { mode: 'remove' });
  if (located === undefined) return Object.freeze(positional);
  return rows.withRow(located.location.contentIndex, (row) => {
    const contentId = row.metadata?.id;
    const identity = mediaId(row.blocks[located.location.blockIndex]);
    return Object.freeze({
      ...located.location,
      ...(contentId === undefined || contentId.length === 0
        ? {}
        : { contentId }),
      ...(identity === undefined || identity.length === 0
        ? {}
        : { mediaId: identity }),
    });
  });
}

function changedRow(
  source: IContent,
  index: number,
  location: SemanticMediaPurgeBoundary,
  options: SemanticMediaPurgeOptions,
): IContent | undefined {
  const row = sanitizeProviderContentForSerialization(source);
  if (index !== location.contentIndex) return row;
  const replacement = replacementBlock(
    options,
    row.blocks[location.blockIndex],
  );
  const blocks = row.blocks.flatMap((block, blockIndex) => {
    if (blockIndex !== location.blockIndex) return [block];
    return replacement === undefined ? [] : [replacement];
  });
  return blocks.length === 0 ? undefined : { ...row, blocks };
}

function appendCandidate(
  candidate: SemanticPurgeDiskRows,
  row: IContent,
  changedIndex: number,
  ownership?: RowOwnership,
): void {
  ownership?.retain(row);
  try {
    if (
      candidate.length >= changedIndex &&
      row.speaker === 'ai' &&
      row.metadata?.responsesStored === true
    )
      delete row.metadata.responsesStored;
    candidate.append(row);
  } finally {
    ownership?.release(row);
  }
}

export function buildDiskPurgeCandidate(
  base: SemanticPurgeDiskRows,
  location: SemanticMediaPurgeBoundary,
  options: SemanticMediaPurgeOptions,
  ownership?: RowOwnership,
): {
  candidate: SemanticPurgeDiskRows;
  frontier: SemanticMediaPurgeFrontier;
} {
  const candidate = new SemanticPurgeDiskRows(ownership);
  let removed = false;
  try {
    let index = 0;
    for (const source of base) {
      const row = changedRow(source, index++, location, options);
      if (row === undefined) {
        removed = true;
        continue;
      }
      appendCandidate(candidate, row, location.contentIndex, ownership);
    }
    const frontier = stableDiskFrontier(
      candidate,
      positionalFrontier(candidate, location, removed),
    );
    if (candidate.length > 0)
      candidate.withRow(0, (first) => {
        const row = {
          ...first,
          metadata: { ...first.metadata, semanticMediaPurgeFrontier: frontier },
        };
        ownership?.retain(row);
        try {
          candidate.writeRow(0, row);
        } finally {
          ownership?.release(row);
        }
      });
    return { candidate, frontier };
  } catch (error: unknown) {
    candidate.close();
    throw error;
  }
}
