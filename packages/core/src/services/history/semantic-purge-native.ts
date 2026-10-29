/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type {
  PrepareNativeRequestFormat,
  PrepareNativeRequestKimi,
} from './native-provider-format.js';
import type { LocalMediaStore } from '../../storage/local-media-store.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryReaderScope } from './historyReaderScope.js';
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
  readonly requestSnapshot?: VersionSnapshot;
  readonly prepareRequestFormat?: PrepareNativeRequestFormat;
  readonly prepareRequestKimi?: PrepareNativeRequestKimi;
  readonly mediaStore?: LocalMediaStore;
  readonly holdRequestFormats?: () => () => Promise<void>;
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

function validCoordinate(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function matchingImage(
  row: IContent,
  contentIndex: number,
  frontier: SemanticMediaPurgeFrontier,
): SemanticMediaPurgeBoundary | undefined {
  for (const [blockIndex, block] of row.blocks.entries()) {
    if (
      (frontier.mediaId === undefined ||
        mediaId(row, blockIndex) === frontier.mediaId) &&
      isPurgeableImage(block, { contentIndex, blockIndex })
    )
      return { contentIndex, blockIndex };
  }
  return undefined;
}

async function frontierOf(
  snapshot: SemanticPurgeSnapshot,
  signal?: AbortSignal,
): Promise<SemanticMediaPurgeFrontier> {
  for await (const row of snapshot.streamRows(signal)) {
    const frontier = row.metadata?.semanticMediaPurgeFrontier;
    if (
      frontier !== undefined &&
      validCoordinate(frontier.contentIndex) &&
      validCoordinate(frontier.blockIndex)
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
      const match = matchingImage(row, contentIndex, frontier);
      if (match !== undefined) return match;
    }
    contentIndex++;
  }
  return { contentIndex: 0, blockIndex: 0 };
}

export class NativeSemanticPurgeCandidate
  implements SemanticPurgeResource, SemanticPurgeRowSource
{
  readonly length: number;
  private readonly readers = new HistoryReaderScope(
    'Semantic media purge transaction is closed',
  );

  constructor(
    readonly snapshot: SemanticPurgeSnapshot,
    readonly location: SemanticMediaPurgeBoundary,
    readonly removed: boolean,
    private readonly options: SemanticMediaPurgeOptions,
    readonly frontier: SemanticMediaPurgeFrontier,
    private readonly ownership?: RowOwnership,
  ) {
    this.length = snapshot.length - Number(removed);
  }

  view(): SemanticPurgeRowSource {
    return Object.freeze({
      length: this.length,
      streamRows: (
        signal?: AbortSignal,
      ): AsyncGenerator<IContent, void, unknown> => this.streamRows(signal),
    });
  }
  close(): Promise<void> {
    return this.readers.close();
  }

  sourceOrdinal(index: number): number {
    return this.removed && index >= this.location.contentIndex
      ? index + 1
      : index;
  }

  get removesBlock(): boolean {
    return this.options.mode === 'remove';
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
    if (sourceOrdinal === this.location.contentIndex && blocks.length === 0)
      return undefined;
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

  projectRequestRow(row: IContent): IContent {
    const projected = this.transformed(
      row,
      this.location.contentIndex,
      this.location.contentIndex,
      true,
    );
    if (projected === undefined)
      throw new Error('Semantic purge selected a removed request row');
    return projected;
  }

  async readRow(index: number, annotate = true): Promise<IContent> {
    this.readers.requireOpen();
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

  streamRows(signal?: AbortSignal): AsyncGenerator<IContent, void, unknown> {
    return this.readers.open(this.rows(signal));
  }

  private async *rows(
    signal?: AbortSignal,
  ): AsyncGenerator<IContent, void, unknown> {
    for (let index = 0; index < this.length; index++) {
      signal?.throwIfAborted();
      const row = await this.readRow(index);
      this.ownership?.retain(row);
      try {
        yield row;
      } finally {
        this.ownership?.release(row);
      }
    }
    this.readers.requireOpen();
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

async function positionalFrontier(
  candidate: NativeSemanticPurgeCandidate,
): Promise<SemanticMediaPurgeFrontier> {
  const contentIndex = Math.min(
    candidate.location.contentIndex,
    candidate.length - 1,
  );
  const row = await candidate.readRow(contentIndex, false);
  if (candidate.removed)
    return {
      contentIndex,
      blockIndex:
        contentIndex === candidate.location.contentIndex
          ? 0
          : row.blocks.length - 1,
    };
  return {
    contentIndex,
    blockIndex: Math.min(candidate.location.blockIndex, row.blocks.length - 1),
  };
}

function nextImage(
  row: IContent,
  contentIndex: number,
  start: number,
): SemanticMediaPurgeFrontier | undefined {
  for (let blockIndex = start; blockIndex < row.blocks.length; blockIndex++) {
    if (
      isPurgeableImage(row.blocks[blockIndex], { contentIndex, blockIndex })
    ) {
      const contentId = row.metadata?.id;
      const identity = mediaId(row, blockIndex);
      return {
        contentIndex,
        blockIndex,
        ...(contentId ? { contentId } : {}),
        ...(identity ? { mediaId: identity } : {}),
      };
    }
  }
  return undefined;
}

async function candidateFrontier(
  candidate: NativeSemanticPurgeCandidate,
  signal?: AbortSignal,
): Promise<SemanticMediaPurgeFrontier> {
  if (candidate.length === 0) return { contentIndex: 0, blockIndex: 0 };
  const positional = await positionalFrontier(candidate);
  for (let index = positional.contentIndex; index < candidate.length; index++) {
    signal?.throwIfAborted();
    const match = nextImage(
      await candidate.readRow(index, false),
      index,
      index === positional.contentIndex ? positional.blockIndex : 0,
    );
    if (match !== undefined) return match;
  }
  return positional;
}

export async function selectNativeSemanticPurge(
  snapshot: SemanticPurgeSnapshot,
  options: SemanticMediaPurgeOptions,
  signal?: AbortSignal,
  ownership?: RowOwnership,
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
  const draft = new NativeSemanticPurgeCandidate(
    snapshot,
    location,
    removed,
    options,
    { contentIndex: 0, blockIndex: 0 },
  );
  const frontier = await candidateFrontier(draft, signal);
  freezeSemanticPurgeValue(frontier);
  return {
    candidate: new NativeSemanticPurgeCandidate(
      snapshot,
      location,
      removed,
      options,
      frontier,
      ownership,
    ),
    prefix,
    previousFrontier,
  };
}
