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

interface ScorePointer {
  readonly index: number;
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly estimatedTokens: number;
}

function isEmptyAiRow(row: IContent): boolean {
  return row.speaker === 'ai' && row.blocks.length === 0;
}

export class ToolResponseDiskRanking implements Iterable<DiskRankedCandidate> {
  private readonly directory = createScratchDirSync('tool-response-ranking-');
  private readonly scores = openSync(join(this.directory, 'scores'), 'w+');
  private readonly rows = new HistoryDensityRows();
  private count = 0;
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

  private assertOpen(): void {
    if (this.closed) throw new Error('Tool response ranking is closed');
    this.signal?.throwIfAborted();
  }

  async capture(
    history: HistoryService,
    estimate: (block: ContentBlock) => Promise<number>,
  ): Promise<void> {
    this.assertOpen();
    for await (const row of history.streamRawHistory(this.signal)) {
      if (isEmptyAiRow(row)) continue;
      const entryIndex = this.rows.length;
      this.rows.append(row);
      await this.scoreRow(row, entryIndex, estimate);
    }
    for (let index = 0; index < this.pending.length; index++) {
      await this.scoreRow(
        this.pending[index],
        this.historyLength + index,
        estimate,
      );
    }
  }

  private async scoreRow(
    row: IContent,
    entryIndex: number,
    estimate: (block: ContentBlock) => Promise<number>,
  ): Promise<void> {
    for (let blockIndex = 0; blockIndex < row.blocks.length; blockIndex++) {
      const block = row.blocks[blockIndex];
      if (block.type !== 'tool_response' || isAlreadyStubbed(block)) continue;
      await new Promise<void>((resolve) => setImmediate(resolve));
      this.assertOpen();
      const score = await estimate(block);
      this.assertOpen();
      const record = Buffer.alloc(32);
      record.writeDoubleLE(entryIndex, 0);
      record.writeDoubleLE(blockIndex, 8);
      record.writeDoubleLE(score, 16);
      transfer(this.scores, record, this.count * 32, true);
      this.count++;
    }
  }

  private nextPointer(): ScorePointer | undefined {
    this.assertOpen();
    let best: ScorePointer | undefined;
    const record = Buffer.alloc(32);
    for (let index = 0; index < this.count; index++) {
      transfer(this.scores, record, index * 32, false);
      if (record.readDoubleLE(24) === 1) continue;
      const pointer = {
        index,
        entryIndex: record.readDoubleLE(0),
        blockIndex: record.readDoubleLE(8),
        estimatedTokens: record.readDoubleLE(16),
      };
      if (best === undefined || precedes(pointer, best)) best = pointer;
    }
    if (best !== undefined) {
      const selected = Buffer.alloc(8);
      selected.writeDoubleLE(1);
      transfer(this.scores, selected, best.index * 32 + 24, true);
    }
    return best;
  }

  *[Symbol.iterator](): Generator<DiskRankedCandidate, void, unknown> {
    let pointer: ScorePointer | undefined;
    while ((pointer = this.nextPointer()) !== undefined) {
      const location =
        pointer.entryIndex < this.historyLength ? 'history' : 'pending';
      const row =
        location === 'history'
          ? this.rows.readRow(pointer.entryIndex)
          : this.pending[pointer.entryIndex - this.historyLength];
      const block = row.blocks[pointer.blockIndex];
      if (block.type !== 'tool_response')
        throw new Error('Ranked tool response pointer is invalid');
      yield {
        historyLength: this.historyLength,
        location,
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

function precedes(a: ScorePointer, b: ScorePointer): boolean {
  if (b.estimatedTokens !== a.estimatedTokens)
    return b.estimatedTokens - a.estimatedTokens < 0;
  if (b.entryIndex !== a.entryIndex) return b.entryIndex - a.entryIndex < 0;
  return b.blockIndex - a.blockIndex < 0;
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
): Promise<T> {
  signal?.throwIfAborted();
  const ranked = new ToolResponseDiskRanking(pending, signal);
  try {
    await ranked.capture(history, estimate);
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
          sink.appendValue(sanitizeProviderContentForSerialization(row));
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
