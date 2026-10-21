/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isAbsolute, resolve } from 'node:path';
import type { DensityConfig } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type {
  IContent,
  ToolCallBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { NativeDensityPolicy } from '@vybestack/llxprt-code-core/services/history/nativeDensityPolicy.js';
import type { DensityToolOccurrence } from '@vybestack/llxprt-code-core/journal/density-read-write-facts.js';
import { decodeStoredRow } from '@vybestack/llxprt-code-core/services/history/journalRowCodec.js';
import {
  READ_TOOLS,
  WRITE_TOOLS,
  PRUNED_POINTER,
} from './HighDensityStrategy.js';
import { inclusions, nativeFileDedupe } from './native-file-dedupe.js';

function filePath(params: unknown): string | undefined {
  if (typeof params !== 'object' || params === null) return undefined;
  const value =
    Reflect.get(params, 'file_path') ??
    Reflect.get(params, 'absolute_path') ??
    Reflect.get(params, 'path');
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function readPaths(call: ToolCallBlock, root: string): readonly string[] {
  if (call.name !== 'read_many_files') {
    const path = filePath(call.parameters);
    return path === undefined ? [] : [resolve(root, path)];
  }
  if (typeof call.parameters !== 'object' || call.parameters === null)
    return [];
  const paths: unknown = Reflect.get(call.parameters, 'paths');
  if (!Array.isArray(paths)) return [];
  const result: string[] = [];
  for (const path of paths) {
    if (typeof path !== 'string') continue;
    if (path.includes('*') || path.includes('?')) return [];
    result.push(resolve(root, path));
  }
  return result;
}
function* toolOccurrences(
  row: IContent,
  root: string,
): Generator<DensityToolOccurrence> {
  if (row.speaker === 'ai') {
    for (const block of row.blocks) {
      if (
        block.type !== 'tool_call' ||
        !WRITE_TOOLS.some((name) => name === block.name)
      )
        continue;
      const path = filePath(block.parameters);
      if (path !== undefined)
        yield { kind: 'write', path: resolve(root, path) };
    }
    for (const block of row.blocks) {
      if (
        block.type !== 'tool_call' ||
        !READ_TOOLS.some((name) => name === block.name)
      )
        continue;
      yield { kind: 'read', id: block.id, paths: readPaths(block, root) };
    }
  }
  if (row.speaker === 'tool') {
    for (const [index, block] of row.blocks.entries()) {
      if (block.type !== 'tool_response') continue;
      yield {
        kind: 'response',
        id: block.callId,
        bucket: block.toolName,
        block: index,
        eligible: block.result !== PRUNED_POINTER,
      };
    }
  }
}
export function nativeReadWrite(config: DensityConfig): {
  readonly files: NonNullable<NativeDensityPolicy['files']>;
  readonly readWrite: NonNullable<NativeDensityPolicy['readWrite']>;
} {
  if (!isAbsolute(config.workspaceRoot))
    throw new Error(
      'Native read/write policy requires an absolute workspace root',
    );
  const root = resolve(config.workspaceRoot);
  const dedupe = config.fileDedupe ? nativeFileDedupe(root) : undefined;
  return {
    files: {
      facts: {
        revision: JSON.stringify([
          'density-read-write:1',
          root,
          dedupe?.facts.revision ?? null,
          'ai-write-call-raw-id:1',
          'surviving-recency:1',
        ]),
        async *occurrences(snapshot, entry) {
          if (dedupe !== undefined)
            yield* dedupe.facts.occurrences(snapshot, entry);
        },
        async *combined(snapshot, entry) {
          const row = decodeStoredRow(await snapshot.readRow(entry));
          yield* toolOccurrences(row, root);
          if (dedupe !== undefined) {
            for (const { key, block, start } of inclusions(row, root))
              yield { key, block, start };
          }
        },
      },
      replace: async (row, ordinal, facts) =>
        dedupe?.replace(row, ordinal, facts),
    },
    async readWrite(row, ordinal, facts) {
      if (row.speaker !== 'ai' && row.speaker !== 'tool') return undefined;
      const stale = new Set<string>();
      for (const block of row.blocks) {
        if (
          row.speaker === 'ai' &&
          block.type === 'tool_call' &&
          (await facts.stale(ordinal, block.id))
        )
          stale.add(block.id);
        if (
          row.speaker === 'tool' &&
          block.type === 'tool_response' &&
          (await facts.staleId(block.callId))
        )
          stale.add(block.callId);
      }
      if (stale.size === 0) return undefined;
      const blocks = row.blocks.filter((block) => {
        if (row.speaker === 'ai' && block.type === 'tool_call')
          return !stale.has(block.id);
        if (row.speaker === 'tool' && block.type === 'tool_response')
          return !stale.has(block.callId);
        return true;
      });
      if (
        row.speaker === 'tool'
          ? blocks.length === 0
          : blocks.every(
              (block) => block.type === 'text' && block.text.trim() === '',
            )
      )
        return null;
      return { ...row, blocks };
    },
  };
}
