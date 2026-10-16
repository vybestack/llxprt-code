/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { resolve } from 'node:path';
import { HistoryDensityRows } from '@vybestack/llxprt-code-core/services/history/historyDensityRows.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';
import type {
  DiskDensityResult,
  DensityRowDecision,
} from '@vybestack/llxprt-code-core/services/history/historyDiskDensity.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  DensityConfig,
  DensityResultMetadata,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { DensityDiskIndex } from './densityDiskIndex.js';
import {
  READ_TOOLS,
  WRITE_TOOLS,
  PRUNED_POINTER,
  FILE_INCLUSION_CLOSE,
} from './HighDensityStrategy.js';

function filePath(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const candidate =
    Reflect.get(params, 'file_path') ??
    Reflect.get(params, 'absolute_path') ??
    Reflect.get(params, 'path');
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

interface Inclusion {
  readonly path: string;
  readonly block: number;
  readonly start: number;
  readonly end: number;
}
function* inclusions(
  row: IContent,
  root: string,
): Generator<Inclusion, void, unknown> {
  for (let block = 0; block < row.blocks.length; block++) {
    const content = row.blocks[block];
    if (content.type !== 'text') continue;
    const regex = /^--- (.+) ---$/gm;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(content.text)) !== null) {
      const close = content.text.indexOf(
        FILE_INCLUSION_CLOSE,
        match.index + match[0].length,
      );
      if (close < 0) continue;
      let end = close + FILE_INCLUSION_CLOSE.length;
      if (content.text[end] === '\n') end++;
      yield {
        path: resolve(root, match[1].trim()),
        block,
        start: match.index,
        end,
      };
      regex.lastIndex = end;
    }
  }
}

export class DiskDensityOptimization implements DiskDensityResult {
  private readonly ownership = new RowOwnership();
  private readonly index = new DensityDiskIndex();
  private readonly replacements: HistoryDensityRows;
  removalCount = 0;
  replacementCount = 0;
  private readWritePairsPruned = 0;
  private fileDeduplicationsPruned = 0;
  private recencyPruned = 0;

  constructor() {
    try {
      this.replacements = new HistoryDensityRows(this.ownership);
    } catch (error) {
      this.index.close();
      throw error;
    }
  }

  get metadata(): DensityResultMetadata {
    return {
      readWritePairsPruned: this.readWritePairsPruned,
      fileDeduplicationsPruned: this.fileDeduplicationsPruned,
      recencyPruned: this.recencyPruned,
    };
  }
  metrics(): ReturnType<DensityDiskIndex['metrics']> {
    return this.index.metrics();
  }
  decision(position: number): DensityRowDecision | undefined {
    const value = this.index.get(`decision:${position}`);
    if (value === undefined) return undefined;
    return value[0] === -1
      ? { kind: 'removed' }
      : { kind: 'replaced', row: this.replacements.readRow(value[0]) };
  }
  rowOwnership(): ReturnType<RowOwnership['snapshot']> {
    return this.ownership.snapshot();
  }
  private *entries(
    source: HistoryIndexedRows,
    reverse = false,
    selected = false,
  ): Generator<{ position: number; row: IContent }, void, unknown> {
    for (let offset = 0; offset < source.length; offset++) {
      const position = reverse ? source.length - offset - 1 : offset;
      const row = selected
        ? this.row(source, position)
        : source.readRow(position);
      if (row === undefined) continue;
      this.ownership.retain(row);
      try {
        yield { position, row };
      } finally {
        this.ownership.release(row);
      }
    }
  }
  private remove(position: number): void {
    if (this.index.get(`decision:${position}`) !== undefined)
      throw new Error('Density removal conflicts with an earlier decision');
    this.index.set(`decision:${position}`, [-1]);
    this.removalCount++;
  }
  private replace(position: number, row: IContent): void {
    const old = this.index.get(`decision:${position}`);
    if (old?.[0] === -1)
      throw new Error('Density replacement targets a removed row');
    if (old === undefined) this.replacementCount++;
    const replacementIndex = this.replacements.length;
    this.ownership.retain(row);
    try {
      this.replacements.append(row);
    } finally {
      this.ownership.release(row);
    }
    this.index.set(`decision:${position}`, [replacementIndex]);
  }
  private row(
    source: HistoryIndexedRows,
    position: number,
  ): IContent | undefined {
    const decision = this.decision(position);
    if (decision?.kind === 'removed') return undefined;
    return decision?.kind === 'replaced'
      ? decision.row
      : source.readRow(position);
  }

  optimize(source: HistoryIndexedRows, config: DensityConfig): void {
    if (config.readWritePruning) this.pruneReadWrite(source, config);
    if (config.fileDedupe) this.dedupe(source, config);
    if (config.recencyPruning) this.pruneRecency(source, config);
  }

  private stale(
    block: ToolCallBlock,
    position: number,
    config: DensityConfig,
  ): boolean {
    if (block.name === 'read_many_files') {
      const params = block.parameters;
      if (
        typeof params !== 'object' ||
        params === null ||
        !('paths' in params) ||
        !Array.isArray(params.paths)
      )
        return false;
      let concrete = false;
      for (const entry of params.paths) {
        if (typeof entry !== 'string') continue;
        if (entry.includes('*') || entry.includes('?')) return false;
        concrete = true;
        if (!this.laterWrite(entry, position, config)) return false;
      }
      return concrete;
    }
    const target = filePath(block.parameters);
    return target !== undefined && this.laterWrite(target, position, config);
  }
  private laterWrite(
    target: string,
    position: number,
    config: DensityConfig,
  ): boolean {
    const latest = this.index.get(
      `write:${resolve(config.workspaceRoot, target)}`,
    );
    return latest !== undefined && latest[0] > position;
  }
  private indexWrites(source: HistoryIndexedRows, config: DensityConfig): void {
    for (const { position, row } of this.entries(source)) {
      if (row.speaker !== 'ai') continue;
      for (const block of row.blocks) {
        if (
          block.type !== 'tool_call' ||
          !WRITE_TOOLS.some((name) => name === block.name)
        )
          continue;
        const target = filePath(block.parameters);
        if (target !== undefined)
          this.index.set(`write:${resolve(config.workspaceRoot, target)}`, [
            position,
          ]);
      }
    }
  }
  private pruneReadWrite(
    source: HistoryIndexedRows,
    config: DensityConfig,
  ): void {
    this.indexWrites(source, config);
    for (const { position, row } of this.entries(source)) {
      if (row.speaker !== 'ai') continue;
      const calls = row.blocks.filter(
        (block): block is ToolCallBlock => block.type === 'tool_call',
      );
      const stale = new Set(
        calls
          .filter(
            (block) =>
              READ_TOOLS.some((name) => name === block.name) &&
              this.stale(block, position, config),
          )
          .map((block) => block.id),
      );
      if (stale.size > 0) {
        for (const id of stale) this.index.set(`call:${id}`, [1]);
        const blocks = row.blocks.filter(
          (block) => block.type !== 'tool_call' || !stale.has(block.id),
        );
        if (
          stale.size === calls.length &&
          (blocks.length === 0 ||
            blocks.every(
              (block) => block.type === 'text' && block.text.trim() === '',
            ))
        )
          this.remove(position);
        else this.replace(position, { ...row, blocks });
      }
    }
    this.pruneResponses(source);
  }
  private pruneResponses(source: HistoryIndexedRows): void {
    for (const { position, row } of this.entries(source)) {
      if (row.speaker !== 'tool') continue;
      let count = 0;
      const blocks = row.blocks.filter((block) => {
        if (
          block.type !== 'tool_response' ||
          this.index.get(`call:${block.callId}`) === undefined
        )
          return true;
        count++;
        return false;
      });
      if (count > 0) {
        this.readWritePairsPruned += count;
        if (blocks.length === 0) this.remove(position);
        else this.replace(position, { ...row, blocks });
      }
    }
  }
  private dedupe(source: HistoryIndexedRows, config: DensityConfig): void {
    for (const { position, row } of this.entries(source)) {
      if (row.speaker !== 'human') continue;
      for (const inclusion of inclusions(row, config.workspaceRoot)) {
        const latest = this.index.get(`file:${inclusion.path}`);
        if (
          latest === undefined ||
          position > latest[0] ||
          inclusion.start > latest[2]
        )
          this.index.set(`file:${inclusion.path}`, [
            position,
            inclusion.block,
            inclusion.start,
          ]);
      }
    }
    for (const { position, row } of this.entries(source)) {
      if (row.speaker !== 'human') continue;
      const stale = [...inclusions(row, config.workspaceRoot)].filter(
        (inclusion) => {
          const latest = this.index.get(`file:${inclusion.path}`);
          return (
            latest !== undefined &&
            (latest[0] !== position ||
              latest[1] !== inclusion.block ||
              latest[2] !== inclusion.start)
          );
        },
      );
      if (stale.length > 0) {
        const blocks = row.blocks.map((block, blockIndex) => {
          if (block.type !== 'text') return block;
          const removals = stale
            .filter((inclusion) => inclusion.block === blockIndex)
            .sort((a, b) => b.start - a.start);
          if (removals.length === 0) return block;
          let text = block.text;
          for (const inclusion of removals)
            text =
              text.substring(0, inclusion.start) +
              text.substring(inclusion.end);
          return {
            type: 'text' as const,
            text: text.replace(/\n{3,}/g, '\n\n'),
          };
        });
        this.fileDeduplicationsPruned += stale.length;
        this.replace(position, { ...row, blocks });
      }
    }
  }
  private pruneRecency(
    source: HistoryIndexedRows,
    config: DensityConfig,
  ): void {
    const retention = Math.max(1, config.recencyRetention);
    for (const { position, row } of this.entries(source, true, true)) {
      if (row.speaker !== 'tool') continue;
      const blocks = [...row.blocks];
      let changed = false;
      for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex--) {
        const block = blocks[blockIndex];
        if (block.type !== 'tool_response' || block.result === PRUNED_POINTER)
          continue;
        const key = `recency:${block.toolName}`;
        const count = (this.index.get(key)?.[0] ?? 0) + 1;
        this.index.set(key, [count]);
        if (count > retention) {
          blocks[blockIndex] = { ...block, result: PRUNED_POINTER };
          changed = true;
          this.recencyPruned++;
        }
      }
      if (changed) this.replace(position, { ...row, blocks });
    }
  }
  close(): void {
    try {
      this.replacements.close();
    } finally {
      this.index.close();
    }
  }
}

export function optimizeDiskDensity(
  source: HistoryIndexedRows,
  config: DensityConfig,
): DiskDensityOptimization {
  const result = new DiskDensityOptimization();
  try {
    result.optimize(source, config);
    return result;
  } catch (error) {
    result.close();
    throw error;
  }
}
