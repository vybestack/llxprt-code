/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { DetachedHistorySink } from './detachedHistoryMutation.js';
import type { SemanticPurgeRowSource } from './semantic-purge-disk-rows.js';
import {
  freezeSemanticPurgeValue,
  hasSummaryReplacement,
  isPurgeableImage,
  replacementBlock,
  restoredFrontierValue,
  type SemanticMediaPurgeBoundary,
  type SemanticMediaPurgeFrontier,
  type SemanticMediaPurgeOptions,
} from './semantic-media-purge.js';

export interface SemanticPurgeSnapshot extends SemanticPurgeRowSource {
  readRow(index: number): Promise<IContent>;
  isCurrent(): boolean;
  restore(): Promise<void>;
  close(): Promise<void>;
}

export interface SemanticPurgeResource {
  view(): SemanticPurgeRowSource;
  close(): void | Promise<void>;
}

function mediaId(row: IContent, index: number): string | undefined {
  const block = row.blocks[index];
  if (block.type !== 'media') return undefined;
  return block.encoding === 'reference'
    ? block.contentId
    : block.sourceContentId;
}

async function frontierOf(
  snapshot: SemanticPurgeSnapshot,
  signal?: AbortSignal,
): Promise<SemanticMediaPurgeFrontier> {
  for await (const row of snapshot.streamRows(signal)) {
    const frontier = row.metadata?.semanticMediaPurgeFrontier;
    if (
      frontier !== undefined &&
      Number.isSafeInteger(frontier.contentIndex) &&
      frontier.contentIndex >= 0 &&
      Number.isSafeInteger(frontier.blockIndex) &&
      frontier.blockIndex >= 0
    )
      return restoredFrontierValue(frontier);
  }
  return { contentIndex: 0, blockIndex: 0 };
}

async function rebase(
  snapshot: SemanticPurgeSnapshot,
  frontier: SemanticMediaPurgeFrontier,
  signal?: AbortSignal,
): Promise<SemanticMediaPurgeFrontier> {
  if (frontier.contentId === undefined && frontier.mediaId === undefined)
    return frontier;
  let contentIndex = 0;
  for await (const row of snapshot.streamRows(signal)) {
    if (
      frontier.contentId === undefined ||
      row.metadata?.id === frontier.contentId
    ) {
      for (let blockIndex = 0; blockIndex < row.blocks.length; blockIndex++)
        if (
          (frontier.mediaId === undefined ||
            mediaId(row, blockIndex) === frontier.mediaId) &&
          isPurgeableImage(row.blocks[blockIndex], { contentIndex, blockIndex })
        )
          return { contentIndex, blockIndex };
    }
    contentIndex++;
  }
  return { contentIndex: 0, blockIndex: 0 };
}

export class NativeSemanticPurgeCandidate
  implements SemanticPurgeResource, SemanticPurgeRowSource
{
  readonly length: number;
  private closed = false;

  constructor(
    readonly snapshot: SemanticPurgeSnapshot,
    readonly location: SemanticMediaPurgeBoundary,
    readonly removed: boolean,
    private readonly options: SemanticMediaPurgeOptions,
    readonly frontier: SemanticMediaPurgeFrontier,
  ) {
    this.length = snapshot.length - Number(removed);
  }

  view(): SemanticPurgeRowSource {
    return this;
  }
  close(): void {
    this.closed = true;
  }

  sourceOrdinal(index: number): number {
    return this.removed && index >= this.location.contentIndex
      ? index + 1
      : index;
  }

  private transformed(
    row: IContent,
    sourceOrdinal: number,
    index: number,
    annotate: boolean,
  ): IContent | undefined {
    const blocks =
      sourceOrdinal === this.location.contentIndex
        ? row.blocks.flatMap((block, blockIndex) => {
            if (blockIndex !== this.location.blockIndex) return [block];
            const replacement = replacementBlock(this.options, block);
            return replacement === undefined ? [] : [replacement];
          })
        : row.blocks;
    if (blocks.length === 0) return undefined;
    const metadata = { ...row.metadata };
    if (
      index >= this.location.contentIndex &&
      row.speaker === 'ai' &&
      metadata.responsesStored === true
    )
      delete metadata.responsesStored;
    if (annotate && index === 0)
      metadata.semanticMediaPurgeFrontier = this.frontier;
    const result = { ...row, blocks, metadata };
    freezeSemanticPurgeValue(result);
    return result;
  }

  async readRow(index: number, annotate = true): Promise<IContent> {
    if (this.closed)
      throw new Error('Semantic media purge transaction is closed');
    const sourceOrdinal = this.sourceOrdinal(index);
    const row = this.transformed(
      await this.snapshot.readRow(sourceOrdinal),
      sourceOrdinal,
      index,
      annotate,
    );
    if (row === undefined)
      throw new Error('Semantic purge selected a removed row');
    return row;
  }

  async *streamRows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < this.length; index++) {
      signal?.throwIfAborted();
      yield await this.readRow(index);
    }
    if (this.closed)
      throw new Error('Semantic media purge transaction is closed');
    signal?.throwIfAborted();
  }

  async publish(
    sink: DetachedHistorySink,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let index = 0; index < this.length; index++) {
      signal?.throwIfAborted();
      await sink.appendDerived(
        this.sourceOrdinal(index),
        await this.readRow(index),
      );
    }
  }
}

export interface NativeSemanticPurgeSelection {
  readonly candidate: NativeSemanticPurgeCandidate;
  readonly prefix: SemanticMediaPurgeBoundary | undefined;
  readonly previousFrontier: SemanticMediaPurgeFrontier;
}

export async function selectNativeSemanticPurge(
  snapshot: SemanticPurgeSnapshot,
  options: SemanticMediaPurgeOptions,
  signal?: AbortSignal,
): Promise<NativeSemanticPurgeSelection | undefined> {
  const previousFrontier = await frontierOf(snapshot, signal);
  const start = await rebase(snapshot, previousFrontier, signal);
  let prefix: SemanticMediaPurgeBoundary | undefined;
  let location: SemanticMediaPurgeBoundary | undefined;
  let removed = false;
  let contentIndex = 0;
  for await (const row of snapshot.streamRows(signal)) {
    for (const [blockIndex, block] of row.blocks.entries()) {
      const atOrAfter =
        contentIndex > start.contentIndex ||
        (contentIndex === start.contentIndex && blockIndex >= start.blockIndex);
      if (
        atOrAfter &&
        isPurgeableImage(block, { contentIndex, blockIndex }) &&
        hasSummaryReplacement(block, options)
      ) {
        location = { contentIndex, blockIndex };
        removed = row.blocks.length === 1 && options.mode === 'remove';
        break;
      }
      prefix = { contentIndex, blockIndex };
    }
    if (location !== undefined) break;
    contentIndex++;
  }
  if (location === undefined) return undefined;
  const length = snapshot.length - Number(removed);
  let frontier: SemanticMediaPurgeFrontier = { contentIndex: 0, blockIndex: 0 };
  if (length > 0) {
    const index = Math.min(location.contentIndex, length - 1);
    const draft = new NativeSemanticPurgeCandidate(
      snapshot,
      location,
      removed,
      options,
      frontier,
    );
    const row = await draft.readRow(index, false);
    const blockIndex = removed
      ? index === location.contentIndex
        ? 0
        : row.blocks.length - 1
      : Math.min(location.blockIndex, row.blocks.length - 1);
    frontier = { contentIndex: index, blockIndex };
    for (let at = index; at < length; at++) {
      const value = await draft.readRow(at, false);
      let found = false;
      for (
        let block = at === index ? blockIndex : 0;
        block < value.blocks.length;
        block++
      ) {
        if (
          !isPurgeableImage(value.blocks[block], {
            contentIndex: at,
            blockIndex: block,
          })
        )
          continue;
        const contentId = value.metadata?.id;
        const identity = mediaId(value, block);
        frontier = {
          contentIndex: at,
          blockIndex: block,
          ...(contentId ? { contentId } : {}),
          ...(identity ? { mediaId: identity } : {}),
        };
        found = true;
        break;
      }
      if (found) break;
    }
  }
  freezeSemanticPurgeValue(frontier);
  return {
    candidate: new NativeSemanticPurgeCandidate(
      snapshot,
      location,
      removed,
      options,
      frontier,
    ),
    prefix,
    previousFrontier,
  };
}
