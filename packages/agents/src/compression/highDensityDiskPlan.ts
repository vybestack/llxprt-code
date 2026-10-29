/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ContentBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type {
  CompressionInputRows,
  DensityCallLookup,
} from '@vybestack/llxprt-code-core/services/history/compressionInput.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { DiskTruncationContext } from './TopDownTruncationStrategy.js';
import { DensityDiskIndex } from './densityDiskIndex.js';
import { RERUN_HINT_SUFFIX } from './HighDensityStrategy.js';

async function withRow<T>(
  rows: CompressionInputRows,
  position: number,
  owner: RowOwnership,
  action: (row: IContent) => T | Promise<T>,
): Promise<T> {
  const row = await rows.readRow(position);
  owner.retain(row);
  try {
    return await action(row);
  } finally {
    owner.release(row);
  }
}

function indexFirstCall(
  index: DensityDiskIndex,
  key: string,
  position: number,
  block: number,
): void {
  if (index.get(key) === undefined) index.set(key, [position, block]);
}

async function indexCalls(
  rows: CompressionInputRows,
  index: DensityDiskIndex,
  owner: RowOwnership,
): Promise<void> {
  for (let position = 0; position < rows.length; position++) {
    await withRow(rows, position, owner, (row) => {
      for (let block = 0; block < row.blocks.length; block++) {
        const value = row.blocks[block];
        if (row.speaker === 'ai' && value.type === 'tool_call') {
          const key = `first:${value.id}`;
          indexFirstCall(index, key, position, block);
        }
        if (row.speaker === 'tool' && value.type === 'tool_response')
          index.set(`last:${value.callId}`, [position]);
      }
    });
  }
}

async function tailBoundary(
  rows: CompressionInputRows,
  start: number,
  lookup: DensityCallLookup,
  owner: RowOwnership,
): Promise<number> {
  if (start <= 0 || start >= rows.length) return start;
  while (
    start > 0 &&
    (await withRow(rows, start, owner, (row) => row.speaker === 'tool'))
  )
    start--;
  return withRow(rows, start, owner, async (row) => {
    if (start <= 0 || row.speaker !== 'ai') return start;
    const calls = row.blocks.filter((block) => block.type === 'tool_call');
    for (const block of calls)
      if (await lookup.hasResponseAfter(block.id, start)) return start;
    return calls.length > 0 ? start + 1 : start;
  });
}

async function oldDensityCalls(
  rows: CompressionInputRows,
  owner: RowOwnership,
): Promise<DensityCallLookup & { close(): void }> {
  const index = new DensityDiskIndex();
  try {
    await indexCalls(rows, index, owner);
    return {
      firstCall: async (id) => {
        const first = index.get(`first:${id}`);
        if (first === undefined) return undefined;
        return withRow(rows, first[0], owner, (row) => {
          const block = row.blocks[first[1]];
          if (block.type !== 'tool_call')
            throw new Error('Density call index points to a non-call block');
          return block;
        });
      },
      hasResponseAfter: async (id, position) =>
        (index.get(`last:${id}`)?.[0] ?? -1) > position,
      close: () => index.close(),
    };
  } catch (error) {
    try {
      index.close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'Old density lookup cleanup failed',
        { cause: error },
      );
    }
    throw error;
  }
}

async function keyParam(
  lookup: DensityCallLookup,
  id: string,
): Promise<string | undefined> {
  const block = await lookup.firstCall(id);
  const params = block?.parameters;
  if (typeof params !== 'object' || params === null) return undefined;
  const candidate =
    Reflect.get(params, 'file_path') ??
    Reflect.get(params, 'absolute_path') ??
    Reflect.get(params, 'path');
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

function toolSummary(
  block: ToolResponseBlock,
  param: string | undefined,
): string {
  const hasError = block.error !== undefined && block.error !== '';
  const result =
    typeof block.result === 'string'
      ? block.result
      : JSON.stringify(block.result ?? '');
  const lower = result.toLowerCase();
  const looksLikeError = ['error:', 'error occurred', 'command failed'].some(
    (indicator) => lower.includes(indicator),
  );
  const outcome = hasError || looksLikeError ? 'error' : 'success';
  return `[${block.toolName}${param ? ` ${param}` : ''}: ${outcome} ${RERUN_HINT_SUFFIX}]`;
}

function outputRows(
  rows: CompressionInputRows,
  tail: number,
  lookup: DensityCallLookup,
  owner: RowOwnership,
): CompressionInputRows {
  const readRow = (position: number): Promise<IContent> =>
    withRow(rows, position, owner, async (row) => {
      if (position >= tail || row.speaker === 'human' || row.speaker === 'ai')
        return row;
      const blocks: ContentBlock[] = [];
      for (const block of row.blocks)
        blocks.push(
          block.type === 'tool_response'
            ? {
                ...block,
                result: toolSummary(
                  block,
                  await keyParam(lookup, block.callId),
                ),
              }
            : block,
        );
      return { ...row, blocks };
    });
  return {
    length: rows.length,
    readRow,
    sourceOrdinalAt: (position) => rows.sourceOrdinalAt(position),
    async *[Symbol.asyncIterator]() {
      for (let position = 0; position < rows.length; position++) {
        const row = await readRow(position);
        owner.retain(row);
        try {
          yield row;
        } finally {
          owner.release(row);
        }
      }
    },
    async chronologySelection(start) {
      if (start === rows.length) return { ranges: [], generated: [] };
      const first = await rows.sourceOrdinalAt(start);
      const last = await rows.sourceOrdinalAt(rows.length - 1);
      if (first === undefined || last === undefined)
        throw new Error('High-density output has no source ordinal');
      return { ranges: [{ from: first, to: last + 1 }], generated: [] };
    },
  };
}

type HighDensityContext = Omit<DiskTruncationContext, 'history'> & {
  readonly history: CompressionInputRows;
};

export type HighDensityOutput =
  | { readonly kind: 'noop' }
  | {
      readonly kind: 'applied';
      readonly start: number;
      readonly top: number;
      readonly candidate: CompressionInputRows;
      close(): void;
    };

export async function prepareHighDensityDisk(
  context: HighDensityContext,
  owner: RowOwnership,
  diskCandidate?: HistoryDensityRows,
): Promise<HighDensityOutput> {
  const rows = context.history;
  if (rows.length === 0) return { kind: 'noop' };
  const lookup: DensityCallLookup & { close?: () => void } =
    rows.densityCalls ?? (await oldDensityCalls(rows, owner));
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    lookup.close?.();
  };
  try {
    const tail = await tailBoundary(
      rows,
      rows.length -
        Math.max(
          1,
          Math.floor(
            rows.length * context.runtimeContext.ephemerals.preserveThreshold(),
          ),
        ),
      lookup,
      owner,
    );
    if (tail <= 0) {
      close();
      return { kind: 'noop' };
    }
    const target = Math.floor(
      context.runtimeContext.ephemerals.compressionThreshold() *
        context.runtimeContext.ephemerals.contextLimit() *
        context.runtimeContext.ephemerals.densityCompressHeadroom(),
    );
    const output = outputRows(rows, tail, lookup, owner);
    if (diskCandidate !== undefined) {
      for (let position = 0; position < rows.length; position++)
        diskCandidate.append(
          await output.readRow(position),
          await rows.sourceOrdinalAt(position),
        );
    }
    const candidate = diskCandidate ?? output;
    let tokens = await context.estimateTokens(candidate);
    let start = 0;
    // The production estimator is a sum of independent per-row costs.
    while (tokens > target && start < tail) {
      const row = await candidate.readRow(start);
      owner.retain(row);
      try {
        tokens -= await context.estimateTokens([row]);
      } finally {
        owner.release(row);
      }
      start++;
    }
    return {
      kind: 'applied',
      start,
      top: 0,
      candidate,
      close,
    };
  } catch (error) {
    try {
      close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        'High-density planning cleanup failed',
        { cause: error },
      );
    }
    throw error;
  }
}

export async function compressHighDensityDisk(
  context: HighDensityContext,
  candidate: HistoryDensityRows,
  owner: RowOwnership,
): Promise<
  | { readonly kind: 'noop' }
  | { readonly kind: 'applied'; readonly start: number; readonly top: number }
> {
  const output = await prepareHighDensityDisk(context, owner, candidate);
  if (output.kind === 'noop') return output;
  output.close();
  return { kind: 'applied', start: output.start, top: output.top };
}
