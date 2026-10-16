/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';
import { KeyedRowIndex } from '../utils/keyed-row-index.js';

/**
 * Which tool calls have a stored response row and which responses have a stored
 * call row, built in one pass over the request rows. Ids live in a disk-backed
 * hash, so membership costs a few small reads instead of a rescan of the whole
 * history per tool call, and no id set is held on the heap.
 */
export class ToolPairIndex {
  private constructor(private readonly keys: KeyedRowIndex) {}

  static async build(
    rows: AsyncIterable<IContent>,
    signal?: AbortSignal,
  ): Promise<ToolPairIndex> {
    return new ToolPairIndex(
      await KeyedRowIndex.build(
        'responses-tool-pairs',
        rows,
        recordPairs,
        signal,
      ),
    );
  }

  /** A tool row answers the call with this OpenAI-normalized id. */
  hasResponse(id: string): boolean {
    return this.keys.has(`response:${id}`);
  }

  /** An assistant row issued the call with this OpenAI-normalized id. */
  hasCall(id: string): boolean {
    return this.keys.has(`call:${id}`);
  }

  close(): void {
    this.keys.close();
  }
}

function recordPairs(row: IContent, keys: KeyedRowIndex): void {
  for (const block of row.blocks) {
    if (row.speaker === 'ai' && block.type === 'tool_call')
      keys.set(`call:${normalizeToOpenAIToolId(block.id)}`, 1);
    if (row.speaker === 'tool' && block.type === 'tool_response')
      keys.set(`response:${normalizeToOpenAIToolId(block.callId)}`, 1);
  }
}
