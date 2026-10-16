/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync, readSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import {
  invalidateResponsesStatefulChain,
  type IContent,
  type ContentBlock,
  type ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { sanitizeProviderContentForSerialization } from '@vybestack/llxprt-code-core/services/history/historyCloneUtils.js';
import { isAlreadyStubbed } from './toolResultTruncator.js';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

export interface DiskRankedCandidate {
  readonly historyLength: number;
  readonly location: 'history' | 'pending';
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly block: ToolResponseBlock;
  readonly estimatedTokens: number;
}

/**
 * One fixed-width score record: entry index, block index, estimated tokens,
 * selection state and the tokens a stub would save, each a little-endian double.
 */
const RECORD_BYTES = 40;
const STATE_OFFSET = 24;
const RECORDS_PER_CHUNK = 1024;
const UNSELECTED = 0;
const SELECTED = 1;
const PUBLISHED = 2;

/** A ranked tool response addressed by position, without its block. */
export interface RankedToolResponsePointer {
  readonly index: number;
  readonly location: 'history' | 'pending';
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly estimatedTokens: number;
  /** Tokens saved by replacing the block with its stub; 0 when capture did not weigh stubs. */
  readonly saving: number;
}

/** Tokens a stub would save; the capture records it beside the block's score. */
export type StubSaving = (
  block: ToolResponseBlock,
  estimatedTokens: number,
) => Promise<number>;

function isEmptyAiRow(row: IContent): boolean {
  return row.speaker === 'ai' && row.blocks.length === 0;
}

export class ToolResponseDiskRanking implements Iterable<DiskRankedCandidate> {
  private readonly directory = createScratchDirSync('tool-response-ranking-');
  private readonly scores = openSync(join(this.directory, 'scores'), 'w+');
  private readonly rows = new HistoryDensityRows();
  private readonly chunk = Buffer.alloc(RECORD_BYTES * RECORDS_PER_CHUNK);
  private count = 0;
  private positiveSaving = 0;
  private closed = false;

  constructor(
    private readonly pending: readonly IContent[],
    private readonly signal?: AbortSignal,
  ) {}

  get length(): number {
    return this.count;
  }
  get historyLength(): number {
    return this.rows.length;
  }
  /** Most the candidates can save together, counting only replacements that shrink the request. */
  get maximumSaving(): number {
    return this.positiveSaving;
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Tool response ranking is closed');
    this.signal?.throwIfAborted();
  }

  async capture(
    history: HistoryService,
    estimate: (block: ContentBlock) => Promise<number>,
    saving?: StubSaving,
  ): Promise<void> {
    this.assertOpen();
    for await (const row of history.streamRawHistory(this.signal)) {
      if (isEmptyAiRow(row)) continue;
      const entryIndex = this.rows.length;
      this.rows.append(row);
      await this.scoreRow(row, entryIndex, estimate, saving);
    }
    for (let index = 0; index < this.pending.length; index++) {
      await this.scoreRow(
        this.pending[index],
        this.historyLength + index,
        estimate,
        saving,
      );
    }
  }

  private async scoreRow(
    row: IContent,
    entryIndex: number,
    estimate: (block: ContentBlock) => Promise<number>,
    saving: StubSaving | undefined,
  ): Promise<void> {
    for (let blockIndex = 0; blockIndex < row.blocks.length; blockIndex++) {
      const block = row.blocks[blockIndex];
      if (block.type !== 'tool_response' || isAlreadyStubbed(block)) continue;
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.assertOpen();
      const score = await estimate(block);
      this.assertOpen();
      const saved = saving === undefined ? 0 : await saving(block, score);
      this.assertOpen();
      const record = Buffer.alloc(RECORD_BYTES);
      record.writeDoubleLE(entryIndex, 0);
      record.writeDoubleLE(blockIndex, 8);
      record.writeDoubleLE(score, 16);
      record.writeDoubleLE(saved, 32);
      transfer(this.scores, record, this.count * RECORD_BYTES, true);
      this.count++;
      if (saved > 0) this.positiveSaving += saved;
    }
  }

  private pointerAt(
    record: Buffer,
    offset: number,
    index: number,
  ): RankedToolResponsePointer {
    const entryIndex = record.readDoubleLE(offset);
    return {
      index,
      location: entryIndex < this.historyLength ? 'history' : 'pending',
      entryIndex,
      blockIndex: record.readDoubleLE(offset + 8),
      estimatedTokens: record.readDoubleLE(offset + 16),
      saving: record.readDoubleLE(offset + 32),
    };
  }

  /** Loads up to one chunk of records starting at `first`; returns how many were read. */
  private readChunk(first: number): number {
    const records = Math.min(RECORDS_PER_CHUNK, this.count - first);
    transfer(
      this.scores,
      this.chunk.subarray(0, records * RECORD_BYTES),
      first * RECORD_BYTES,
      false,
    );
    return records;
  }

  private setState(index: number, state: number): void {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(state);
    transfer(this.scores, bytes, index * RECORD_BYTES + STATE_OFFSET, true);
  }

  /** Selects the best unselected record: fattest first, most recent on ties. */
  take(): RankedToolResponsePointer | undefined {
    this.assertOpen();
    let best: RankedToolResponsePointer | undefined;
    for (let first = 0; first < this.count; first += RECORDS_PER_CHUNK) {
      const records = this.readChunk(first);
      for (let record = 0; record < records; record++) {
        const offset = record * RECORD_BYTES;
        if (this.chunk.readDoubleLE(offset + STATE_OFFSET) !== UNSELECTED)
          continue;
        const tokens = this.chunk.readDoubleLE(offset + 16);
        const entry = this.chunk.readDoubleLE(offset);
        const block = this.chunk.readDoubleLE(offset + 8);
        if (best === undefined || precedes(tokens, entry, block, best))
          best = this.pointerAt(this.chunk, offset, first + record);
      }
    }
    if (best !== undefined) this.setState(best.index, SELECTED);
    return best;
  }

  /** Selected, unpublished records in capture order (ascending entry index). */
  *selected(): Generator<RankedToolResponsePointer, void, unknown> {
    this.assertOpen();
    for (let first = 0; first < this.count; first += RECORDS_PER_CHUNK) {
      const records = this.readChunk(first);
      for (let record = 0; record < records; record++) {
        const offset = record * RECORD_BYTES;
        if (this.chunk.readDoubleLE(offset + STATE_OFFSET) === SELECTED)
          yield this.pointerAt(this.chunk, offset, first + record);
      }
    }
  }

  /** Marks everything selected so far as published so a later round skips it. */
  settleSelected(): void {
    this.assertOpen();
    for (let first = 0; first < this.count; first += RECORDS_PER_CHUNK) {
      const records = this.readChunk(first);
      for (let record = 0; record < records; record++) {
        if (
          this.chunk.readDoubleLE(record * RECORD_BYTES + STATE_OFFSET) ===
          SELECTED
        )
          this.setState(first + record, PUBLISHED);
      }
    }
  }

  *[Symbol.iterator](): Generator<DiskRankedCandidate, void, unknown> {
    let pointer: RankedToolResponsePointer | undefined;
    while ((pointer = this.take()) !== undefined) {
      const row =
        pointer.location === 'history'
          ? this.rows.readRow(pointer.entryIndex)
          : this.pending[pointer.entryIndex - this.historyLength];
      const block = row.blocks[pointer.blockIndex];
      if (block.type !== 'tool_response')
        throw new Error('Ranked tool response pointer is invalid');
      yield {
        historyLength: this.historyLength,
        location: pointer.location,
        entryIndex: pointer.entryIndex,
        blockIndex: pointer.blockIndex,
        estimatedTokens: pointer.estimatedTokens,
        block,
      };
    }
  }

  close(): void {
    this.closed = true;
    try {
      this.rows.close();
    } finally {
      try {
        closeSync(this.scores);
      } finally {
        rmSync(this.directory, { recursive: true, force: true });
      }
    }
  }
}

function precedes(
  tokens: number,
  entryIndex: number,
  blockIndex: number,
  than: RankedToolResponsePointer,
): boolean {
  if (than.estimatedTokens !== tokens) return tokens > than.estimatedTokens;
  if (than.entryIndex !== entryIndex) return entryIndex > than.entryIndex;
  return blockIndex > than.blockIndex;
}

function transfer(
  fd: number,
  bytes: Buffer,
  offset: number,
  write: boolean,
): void {
  let transferred = 0;
  while (transferred < bytes.length) {
    const count = write
      ? writeSync(
          fd,
          bytes,
          transferred,
          bytes.length - transferred,
          offset + transferred,
        )
      : readSync(
          fd,
          bytes,
          transferred,
          bytes.length - transferred,
          offset + transferred,
        );
    if (count === 0) throw new Error('Tool ranking I/O made no progress');
    transferred += count;
  }
}

export async function withToolResponseRanking<T>(
  history: HistoryService,
  pending: readonly IContent[],
  estimate: (block: ContentBlock) => Promise<number>,
  action: (
    ranked: ToolResponseDiskRanking,
    unchanged: () => Promise<boolean>,
  ) => Promise<T>,
  signal?: AbortSignal,
  saving?: StubSaving,
): Promise<T> {
  signal?.throwIfAborted();
  const ranked = new ToolResponseDiskRanking(pending, signal);
  try {
    await ranked.capture(history, estimate, saving);
    return await action(
      ranked,
      async () =>
        (await countRawRows(history, signal)) === ranked.historyLength,
    );
  } finally {
    ranked.close();
  }
}

async function countRawRows(
  history: HistoryService,
  signal?: AbortSignal,
): Promise<number> {
  let count = 0;
  for await (const row of history.streamRawHistory(signal)) {
    if (isEmptyAiRow(row)) continue;
    count++;
  }
  return count;
}

function matchesResponse(
  row: IContent,
  blockIndex: number,
  replacement: ToolResponseBlock,
): boolean {
  if (blockIndex < 0 || blockIndex >= row.blocks.length) return false;
  const target = row.blocks[blockIndex];
  return (
    target.type === 'tool_response' &&
    target.callId === replacement.callId &&
    target.toolName === replacement.toolName
  );
}

export async function replaceRankedToolResponse(
  history: HistoryService,
  candidate: DiskRankedCandidate,
  replacement: ToolResponseBlock,
  model: string,
  signal?: AbortSignal,
): Promise<boolean> {
  let replaced = false;
  const staleTarget = new Error('Ranked tool response target changed');
  try {
    await history.detachedValues.transform(
      async (source, sink) => {
        let invalidatesChain = false;
        let matchesTarget = false;
        let probeIndex = 0;
        for await (const row of source.streamRows(signal)) {
          const empty = isEmptyAiRow(row);
          if (!empty && probeIndex === candidate.entryIndex) {
            matchesTarget = matchesResponse(
              row,
              candidate.blockIndex,
              replacement,
            );
          }
          if (!empty) probeIndex++;
          if (
            matchesTarget &&
            row.speaker === 'ai' &&
            row.metadata?.responsesStored === true
          )
            invalidatesChain = true;
        }
        if (probeIndex !== candidate.historyLength || !matchesTarget)
          throw staleTarget;
        let entryIndex = 0;
        for await (let row of source.streamRows(signal)) {
          if (isEmptyAiRow(row)) continue;
          if (entryIndex === candidate.entryIndex) {
            const blocks = [...row.blocks];
            blocks[candidate.blockIndex] = replacement;
            row = { ...row, blocks };
            replaced = true;
          }
          if (invalidatesChain) [row] = invalidateResponsesStatefulChain([row]);
          await sink.appendValue(sanitizeProviderContentForSerialization(row));
          entryIndex++;
        }
      },
      model,
      { signal },
    );
  } catch (error) {
    if (error === staleTarget) return false;
    throw error;
  }
  return replaced;
}

type StubFactory = (
  block: ToolResponseBlock,
  estimatedTokens: number,
) => ToolResponseBlock;

/** Walks the selected pointers once, handing out those that address each entry in turn. */
class SelectedCursor {
  private readonly pointers: Iterator<RankedToolResponsePointer>;
  private head: RankedToolResponsePointer | undefined;

  constructor(ranked: ToolResponseDiskRanking) {
    this.pointers = ranked.selected();
    this.head = this.advance();
  }

  get first(): RankedToolResponsePointer | undefined {
    return this.head;
  }

  takeAt(entryIndex: number): RankedToolResponsePointer[] {
    const taken: RankedToolResponsePointer[] = [];
    while (this.head?.entryIndex === entryIndex) {
      taken.push(this.head);
      this.head = this.advance();
    }
    return taken;
  }

  private advance(): RankedToolResponsePointer | undefined {
    const next = this.pointers.next();
    return next.done === true ? undefined : next.value;
  }
}

/** Replaces the selected tool responses of one journal row; fails when a target moved. */
function stubSelectedBlocks(
  row: IContent,
  targets: readonly RankedToolResponsePointer[],
  makeStub: StubFactory,
  stale: Error,
): IContent {
  const blocks = [...row.blocks];
  for (const target of targets) {
    const block = blocks[target.blockIndex] as ContentBlock | undefined;
    if (block?.type !== 'tool_response' || isAlreadyStubbed(block)) throw stale;
    blocks[target.blockIndex] = makeStub(block, target.estimatedTokens);
  }
  return { ...row, blocks };
}

/** Non-empty journal rows and the position of the last stored Responses parent. */
async function probeJournal(
  rows: AsyncIterable<IContent>,
): Promise<{ readonly count: number; readonly lastStoredParent: number }> {
  let count = 0;
  let lastStoredParent = -1;
  for await (const row of rows) {
    if (isEmptyAiRow(row)) continue;
    if (row.speaker === 'ai' && row.metadata?.responsesStored === true)
      lastStoredParent = count;
    count++;
  }
  return { count, lastStoredParent };
}

/**
 * Publishes every selected history candidate in one journal transaction. The
 * rewrite matches applying the candidates one at a time: each target block
 * becomes its stub, and when any stored Responses parent sits at or after the
 * first target the whole chain is invalidated. Returns the number replaced, or
 * undefined without writing when the journal no longer matches the ranking.
 */
export async function publishSelectedToolResponses(
  history: HistoryService,
  ranked: ToolResponseDiskRanking,
  makeStub: StubFactory,
  model: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const cursor = new SelectedCursor(ranked);
  const firstTarget = cursor.first?.entryIndex;
  if (firstTarget === undefined || firstTarget >= ranked.historyLength)
    return 0;
  let replaced = 0;
  const stale = new Error('Ranked tool response target changed');
  try {
    await history.detachedValues.transform(
      async (source, sink) => {
        const probe = await probeJournal(source.streamRows(signal));
        if (probe.count !== ranked.historyLength) throw stale;
        const invalidatesChain = probe.lastStoredParent >= firstTarget;
        let entryIndex = 0;
        for await (let row of source.streamRows(signal)) {
          if (isEmptyAiRow(row)) continue;
          const targets = cursor.takeAt(entryIndex);
          if (targets.length > 0) {
            row = stubSelectedBlocks(row, targets, makeStub, stale);
            replaced += targets.length;
          }
          if (invalidatesChain) [row] = invalidateResponsesStatefulChain([row]);
          await sink.appendValue(sanitizeProviderContentForSerialization(row));
          entryIndex++;
        }
      },
      model,
      { signal },
    );
  } catch (error) {
    if (error === stale) return undefined;
    throw error;
  }
  return replaced;
}
