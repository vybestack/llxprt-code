/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { setImmediate } from 'node:timers/promises';
import type { DebugLogger } from '../../debug/index.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent, ToolCallBlock, ToolResponseBlock } from './IContent.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { HistoryToolNormalization } from './historyToolNormalization.js';
import { hasValidBlocks } from './historyToolPairing.js';
import {
  ProviderAnchorDiagnostics,
  logReconstructedCalls,
  logUnmatchedResponse,
} from './providerDiagnostics.js';
import {
  ProviderNormalizationDisk,
  type ProviderBlockPointer,
} from './provider-normalization-disk.js';
import {
  NormalizedProviderRequestSnapshot,
  streamProviderContentSnapshot,
  type ProviderRequestSnapshot,
} from './provider-request-snapshot.js';

/** Rows of synchronous scratch work between event-loop yields. */
const ROWS_PER_YIELD = 32;

/** Yields to the event loop every ROWS_PER_YIELD rows and checks scratch and abort state on each row. */
class RowPacer {
  private rows = 0;
  constructor(
    private readonly disk: ProviderNormalizationDisk,
    private readonly signal?: AbortSignal,
  ) {}
  async next(): Promise<void> {
    if (this.rows++ % ROWS_PER_YIELD === 0) await setImmediate();
    this.signal?.throwIfAborted();
    this.disk.verify();
  }
}

export interface ProviderCuratedStreamOptions {
  readonly signal?: AbortSignal;
  readonly root?: string;
  readonly ownership?: RowOwnership;
}

function recordBlocks(disk: ProviderNormalizationDisk, row: IContent): void {
  if (!hasValidBlocks(row)) return;
  for (const block of row.blocks) {
    if (block.type === 'tool_call') disk.setNumber(`seen:${block.id}`, 1);
    if (block.type === 'tool_response' && block.callId)
      disk.setNumber(`responded:${block.callId}`, 1);
  }
}

function appendContinuity(
  disk: ProviderNormalizationDisk,
  row: IContent,
  tailOrigin?: {
    readonly index: number;
    readonly original: IContent;
    readonly split: IContent;
  },
): void {
  recordBlocks(disk, row);
  if (row.speaker === 'tool' && hasValidBlocks(row)) {
    const missing = row.blocks.filter(
      (block): block is ToolResponseBlock =>
        block.type === 'tool_response' &&
        disk.number(`seen:${block.callId}`) === undefined,
    );
    if (missing.length > 0) {
      const blocks = missing.map(
        (response): ToolCallBlock => ({
          type: 'tool_call',
          id: response.callId,
          name: response.toolName || 'unknown_tool',
          parameters: { reconstructed: true },
          description: 'Reconstructed tool call after compression',
        }),
      );
      const reconstructed: IContent = {
        speaker: 'ai',
        blocks,
        metadata: { synthetic: true, reason: 'reconstructed_tool_call' },
      };
      recordBlocks(disk, reconstructed);
      const reconstructionIndex = disk.append('normalized', reconstructed);
      disk.setNumber(`warn:reconstructed:${reconstructionIndex}`, 1);
      if (tailOrigin !== undefined)
        disk.setNumber(`pending:normalized:${reconstructionIndex}`, 1);
    }
  }
  const index = disk.append('normalized', row);
  recordScores(disk, row, 'normalized', index);
  if (tailOrigin !== undefined) {
    disk.setNumber(`pending:normalized:${index}`, 1);
    disk.setNumber(`tail:normalized:${index}`, tailOrigin.index);
    for (let block = 0; block < tailOrigin.split.blocks.length; block++) {
      disk.setPointer(`origin:normalized:${index}:${block}`, {
        row: tailOrigin.index,
        block: tailOrigin.original.blocks.indexOf(
          tailOrigin.split.blocks[block],
        ),
      });
    }
  }
}

function recordScores(
  disk: ProviderNormalizationDisk,
  row: IContent,
  stage: string,
  index: number,
  normalizedIndex?: number,
): void {
  for (let block = 0; block < row.blocks.length; block++) {
    const response = row.blocks[block];
    if (response.type !== 'tool_response') continue;
    const value =
      normalizedIndex === undefined
        ? score(response) + 1
        : disk.number(`score:normalized:${normalizedIndex}:${block}`);
    if (value === undefined) throw new Error('Missing provider response score');
    disk.setNumber(`score:${stage}:${index}:${block}`, value);
  }
}

function appendCompleted(
  disk: ProviderNormalizationDisk,
  row: IContent,
  normalizedIndex?: number,
  pending = false,
): void {
  const index = disk.append('completed', row);
  if (
    pending ||
    (normalizedIndex !== undefined &&
      disk.number(`pending:normalized:${normalizedIndex}`) === 1)
  )
    disk.setNumber(`pending:completed:${index}`, 1);
  recordScores(disk, row, 'completed', index, normalizedIndex);
  if (
    normalizedIndex !== undefined &&
    disk.number(`tail:normalized:${normalizedIndex}`) !== undefined
  ) {
    disk.setNumber(`tail:completed:${index}`, 1);
    for (let block = 0; block < row.blocks.length; block++) {
      disk.setPointer(
        `origin:completed:${index}:${block}`,
        disk.pointer(`origin:normalized:${normalizedIndex}:${block}`),
      );
    }
  }
  if (!hasValidBlocks(row)) return;
  for (const block of row.blocks) {
    if (
      block.type === 'tool_call' &&
      block.id &&
      disk.number(`call:${block.id}`) === undefined
    )
      disk.setNumber(`call:${block.id}`, index);
  }
}

async function completeResponses(
  disk: ProviderNormalizationDisk,
  signal?: AbortSignal,
): Promise<void> {
  const length = disk.number('length:normalized') ?? 0;
  const pacer = new RowPacer(disk, signal);
  for (let index = 0; index < length; index++) {
    await pacer.next();
    const row = disk.row('normalized', index);
    appendCompleted(disk, row, index);
    appendMissingResponses(
      disk,
      row,
      disk.number(`pending:normalized:${index}`) === 1,
    );
  }
}

function appendMissingResponses(
  disk: ProviderNormalizationDisk,
  row: IContent,
  pending: boolean,
): void {
  if (row.speaker !== 'ai' || !hasValidBlocks(row)) return;
  const missing = row.blocks.filter(
    (block) =>
      block.type === 'tool_call' &&
      block.id !== '' &&
      disk.number(`responded:${block.id}`) === undefined,
  );
  if (missing.length === 0) return;
  const blocks: ToolResponseBlock[] = [];
  for (const block of missing) {
    if (block.type !== 'tool_call') throw new Error('Expected a tool call');
    disk.setNumber(`responded:${block.id}`, 1);
    blocks.push({
      type: 'tool_response',
      callId: block.id,
      toolName: block.name || 'unknown_tool',
      result: null,
      error: 'Tool call interrupted or cancelled',
      isComplete: true,
    });
  }
  appendCompleted(
    disk,
    {
      speaker: 'tool',
      blocks,
      metadata: { synthetic: true, reason: 'orphaned_tool_call' },
    },
    undefined,
    pending,
  );
}

function score(response: ToolResponseBlock): number {
  return (
    (response.isComplete === true ? 2 : 0) -
    (response.error ? 1 : 0) +
    (response.result !== undefined && response.result !== null ? 1 : 0)
  );
}

function responseScore(
  disk: ProviderNormalizationDisk,
  pointer: ProviderBlockPointer,
): number {
  const value = disk.number(`score:completed:${pointer.row}:${pointer.block}`);
  if (value === undefined) throw new Error('Missing provider response score');
  return value;
}

function assignResponse(
  disk: ProviderNormalizationDisk,
  response: ToolResponseBlock,
  pointer: ProviderBlockPointer,
): number | undefined {
  if (!response.callId) return undefined;
  const target = disk.number(`call:${response.callId}`);
  if (target === undefined) return undefined;
  const existing = disk.number(`slot:${response.callId}`);
  if (existing !== undefined) {
    const key = `response:${target}:${existing}`;
    if (responseScore(disk, pointer) > responseScore(disk, disk.pointer(key)))
      disk.setPointer(key, pointer);
    return undefined;
  }
  const slot = disk.number(`responses:${target}`) ?? 0;
  disk.setNumber(`slot:${response.callId}`, slot);
  disk.setPointer(`response:${target}:${slot}`, pointer);
  disk.setNumber(`responses:${target}`, slot + 1);
  return target;
}

async function indexResponses(
  disk: ProviderNormalizationDisk,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<void> {
  const length = disk.number('length:completed') ?? 0;
  const pacer = new RowPacer(disk, signal);
  for (let index = 0; index < length; index++) {
    await pacer.next();
    indexRowResponses(disk, disk.row('completed', index), index, logger);
  }
}

function indexRowResponses(
  disk: ProviderNormalizationDisk,
  row: IContent,
  index: number,
  logger: DebugLogger,
): void {
  if (!hasValidBlocks(row)) return;
  let mediaTarget: number | undefined;
  for (let block = 0; block < row.blocks.length; block++) {
    const value = row.blocks[block];
    if (value.type !== 'tool_response') continue;
    if (value.callId && disk.number(`call:${value.callId}`) === undefined)
      logUnmatchedResponse(logger, value);
    const target = assignResponse(disk, value, { row: index, block });
    if (target !== undefined && mediaTarget === undefined) mediaTarget = target;
  }
  if (mediaTarget === undefined) return;
  for (let block = 0; block < row.blocks.length; block++) {
    if (row.blocks[block].type !== 'media') continue;
    const slot = disk.number(`media:${mediaTarget}`) ?? 0;
    disk.setPointer(`media:${mediaTarget}:${slot}`, { row: index, block });
    disk.setNumber(`media:${mediaTarget}`, slot + 1);
  }
}

function stripped(row: IContent): IContent | undefined {
  if (
    !hasValidBlocks(row) ||
    !row.blocks.some((block) => block.type === 'tool_response')
  )
    return row;
  const blocks = row.blocks.filter(
    (block) => block.type !== 'tool_response' && block.type !== 'media',
  );
  return row.speaker === 'tool' || blocks.length === 0
    ? undefined
    : { ...row, blocks };
}

function sameBlock(
  disk: ProviderNormalizationDisk,
  selected: ProviderBlockPointer,
  adjacent: ProviderBlockPointer,
  tail: readonly IContent[],
): boolean {
  if (selected.row === adjacent.row && selected.block === adjacent.block)
    return true;
  if (
    disk.number(`tail:completed:${selected.row}`) === undefined ||
    disk.number(`tail:completed:${adjacent.row}`) === undefined
  )
    return false;
  const left = disk.pointer(
    `origin:completed:${selected.row}:${selected.block}`,
  );
  const right = disk.pointer(
    `origin:completed:${adjacent.row}:${adjacent.block}`,
  );
  return (
    tail[left.row].blocks[left.block] === tail[right.row].blocks[right.block]
  );
}

function adjacentResponse(
  disk: ProviderNormalizationDisk,
  index: number,
  tail: readonly IContent[],
): IContent | undefined {
  const count = disk.number(`responses:${index}`) ?? 0;
  if (count === 0) return undefined;
  const blocks: IContent['blocks'] = [];
  const mediaCount = disk.number(`media:${index}`) ?? 0;
  const source =
    index + 1 < (disk.number('length:completed') ?? 0)
      ? disk.row('completed', index + 1)
      : undefined;
  let retained =
    source?.speaker === 'tool' &&
    source.blocks.length === count + mediaCount &&
    source.blocks.every(
      (block) => block.type === 'tool_response' || block.type === 'media',
    );
  for (const prefix of ['response', 'media']) {
    const length = prefix === 'response' ? count : mediaCount;
    for (let slot = 0; slot < length; slot++) {
      const pointer = disk.pointer(`${prefix}:${index}:${slot}`);
      retained =
        retained &&
        sameBlock(
          disk,
          pointer,
          { row: index + 1, block: blocks.length },
          tail,
        );
      blocks.push(disk.row('completed', pointer.row).blocks[pointer.block]);
    }
  }
  const metadata = retained
    ? source?.metadata
    : { synthetic: true, reason: 'reordered_tool_responses' };
  return { speaker: 'tool', blocks, metadata };
}

async function logContinuity(
  disk: ProviderNormalizationDisk,
  logger: DebugLogger,
  signal?: AbortSignal,
): Promise<void> {
  const length = disk.number('length:normalized') ?? 0;
  const pacer = new RowPacer(disk, signal);
  for (let index = 0; index < length; index++) {
    await pacer.next();
    if (disk.number(`warn:reconstructed:${index}`) === undefined) continue;
    logReconstructedCalls(logger, disk.row('normalized', index).blocks);
  }
}

async function stageOutput(
  disk: ProviderNormalizationDisk,
  tail: readonly IContent[],
  anchors: ProviderAnchorDiagnostics,
  signal?: AbortSignal,
): Promise<void> {
  const length = disk.number('length:completed') ?? 0;
  const pacer = new RowPacer(disk, signal);
  for (let index = 0; index < length; index++) {
    await pacer.next();
    const row = stripped(disk.row('completed', index));
    if (row !== undefined) {
      appendOrdered(disk, row, disk.number(`pending:completed:${index}`) === 1);
      anchors.output(row.metadata?.cacheAnchor === true);
    }
    const response = adjacentResponse(disk, index, tail);
    if (response !== undefined) {
      const sanitized = sanitizeProviderContentForSerialization(response);
      appendOrdered(disk, sanitized, hasPendingResponse(disk, index));
      anchors.output(sanitized.metadata?.cacheAnchor === true);
    }
  }
}

function appendOrdered(
  disk: ProviderNormalizationDisk,
  row: IContent,
  pending: boolean,
): void {
  const index = disk.append('ordered', row);
  if (!pending) return;
  disk.setNumber(`pending:ordered:${index}`, 1);
  if (disk.number('pending:first-output') === undefined)
    disk.setNumber('pending:first-output', index);
}

function hasPendingResponse(
  disk: ProviderNormalizationDisk,
  index: number,
): boolean {
  for (const prefix of ['response', 'media']) {
    const length =
      disk.number(`${prefix === 'response' ? 'responses' : prefix}:${index}`) ??
      0;
    for (let slot = 0; slot < length; slot++) {
      const pointer = disk.pointer(`${prefix}:${index}:${slot}`);
      if (disk.number(`pending:completed:${pointer.row}`) === 1) return true;
    }
  }
  return false;
}

export async function* streamProviderContent(
  curated: AsyncIterable<IContent>,
  tail: readonly IContent[],
  logger: DebugLogger,
  options: ProviderCuratedStreamOptions = {},
): AsyncGenerator<IContent, void, unknown> {
  yield* streamProviderContentSnapshot(
    await prepareProviderContentSnapshot(curated, tail, logger, options),
  );
}

export async function prepareProviderContentSnapshot(
  curated: AsyncIterable<IContent>,
  tail: readonly IContent[],
  logger: DebugLogger,
  options: ProviderCuratedStreamOptions = {},
): Promise<ProviderRequestSnapshot> {
  options.signal?.throwIfAborted();
  const disk = new ProviderNormalizationDisk(options.root);
  const anchors = new ProviderAnchorDiagnostics();
  try {
    const pacer = new RowPacer(disk, options.signal);
    for await (const { row, tailIndex } of combinedRows(curated, tail)) {
      await pacer.next();
      anchors.input(row.metadata?.cacheAnchor === true);
      for (const split of HistoryToolNormalization.splitToolCallsOutOfToolMessages(
        [row],
      ))
        appendContinuity(
          disk,
          sanitizeProviderContentForSerialization(split),
          tailIndex === undefined
            ? undefined
            : { index: tailIndex, original: row, split },
        );
    }
    await logContinuity(disk, logger, options.signal);
    await completeResponses(disk, options.signal);
    await indexResponses(disk, logger, options.signal);
    await stageOutput(disk, tail, anchors, options.signal);
    anchors.log(logger);
    return new NormalizedProviderRequestSnapshot(
      disk,
      tail.length,
      options.signal,
      options.ownership,
    );
  } catch (error) {
    disk.close();
    throw error;
  }
}

async function* combinedRows(
  curated: AsyncIterable<IContent>,
  tail: readonly IContent[],
): AsyncGenerator<
  { readonly row: IContent; readonly tailIndex?: number },
  void,
  unknown
> {
  for await (const row of curated) yield { row };
  for (let tailIndex = 0; tailIndex < tail.length; tailIndex++)
    yield { row: tail[tailIndex], tailIndex };
}
