/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { DiskTruncationContext } from './TopDownTruncationStrategy.js';
import { DensityDiskIndex } from './densityDiskIndex.js';
import { RERUN_HINT_SUFFIX } from './HighDensityStrategy.js';

function withRow<T>(
  rows: HistoryIndexedRows,
  position: number,
  owner: RowOwnership,
  action: (row: IContent) => T,
): T {
  const row = rows.readRow(position);
  owner.retain(row);
  try {
    return action(row);
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

function indexCalls(
  rows: HistoryIndexedRows,
  index: DensityDiskIndex,
  owner: RowOwnership,
): void {
  for (let position = 0; position < rows.length; position++) {
    withRow(rows, position, owner, (row) => {
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

function tailBoundary(
  rows: HistoryIndexedRows,
  start: number,
  index: DensityDiskIndex,
  owner: RowOwnership,
): number {
  if (start <= 0 || start >= rows.length) return start;
  while (
    start > 0 &&
    withRow(rows, start, owner, (row) => row.speaker === 'tool')
  )
    start--;
  return withRow(rows, start, owner, (row) => {
    if (start <= 0 || row.speaker !== 'ai') return start;
    const calls = row.blocks.filter((block) => block.type === 'tool_call');
    const found = calls.some(
      (block) => (index.get(`last:${block.id}`)?.[0] ?? -1) > start,
    );
    return calls.length > 0 && !found ? start + 1 : start;
  });
}

function keyParam(
  rows: HistoryIndexedRows,
  index: DensityDiskIndex,
  id: string,
  owner: RowOwnership,
): string | undefined {
  const first = index.get(`first:${id}`);
  if (first === undefined) return undefined;
  return withRow(rows, first[0], owner, (row) => {
    const block = row.blocks[first[1]];
    if (block.type !== 'tool_call')
      throw new Error('Density call index points to a non-call block');
    const params = block.parameters;
    if (typeof params !== 'object' || params === null) return undefined;
    const candidate =
      Reflect.get(params, 'file_path') ??
      Reflect.get(params, 'absolute_path') ??
      Reflect.get(params, 'path');
    return typeof candidate === 'string' && candidate.length > 0
      ? candidate
      : undefined;
  });
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

function summarize(
  rows: HistoryIndexedRows,
  candidate: HistoryDensityRows,
  tail: number,
  index: DensityDiskIndex,
  owner: RowOwnership,
): void {
  for (let position = 0; position < rows.length; position++) {
    withRow(rows, position, owner, (row) => {
      if (position >= tail || row.speaker === 'human' || row.speaker === 'ai')
        candidate.append(row);
      else
        candidate.append({
          ...row,
          blocks: row.blocks.map((block) =>
            block.type === 'tool_response'
              ? {
                  ...block,
                  result: toolSummary(
                    block,
                    keyParam(rows, index, block.callId, owner),
                  ),
                }
              : block,
          ),
        });
    });
  }
}

export async function compressHighDensityDisk(
  context: DiskTruncationContext,
  candidate: HistoryDensityRows,
  owner: RowOwnership,
): Promise<
  | { readonly kind: 'noop' }
  | { readonly kind: 'applied'; readonly start: number; readonly top: number }
> {
  const rows = context.history;
  if (rows.length === 0) return { kind: 'noop' };
  const index = new DensityDiskIndex();
  try {
    indexCalls(rows, index, owner);
    const tail = tailBoundary(
      rows,
      rows.length -
        Math.max(
          1,
          Math.floor(
            rows.length * context.runtimeContext.ephemerals.preserveThreshold(),
          ),
        ),
      index,
      owner,
    );
    if (tail <= 0) return { kind: 'noop' };
    const target = Math.floor(
      context.runtimeContext.ephemerals.compressionThreshold() *
        context.runtimeContext.ephemerals.contextLimit() *
        context.runtimeContext.ephemerals.densityCompressHeadroom(),
    );
    summarize(rows, candidate, tail, index, owner);
    let tokens = await context.estimateTokens(candidate);
    let start = 0;
    // The production estimator is a sum of independent per-row costs.
    while (tokens > target && start < tail) {
      const row = candidate.readRow(start);
      owner.retain(row);
      try {
        tokens -= await context.estimateTokens([row]);
      } finally {
        owner.release(row);
      }
      start++;
    }
    return { kind: 'applied', start, top: 0 };
  } finally {
    index.close();
  }
}
