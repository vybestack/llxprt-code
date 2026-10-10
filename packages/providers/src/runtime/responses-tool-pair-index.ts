/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { rmSync } from 'node:fs';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ProviderNormalizationStorage } from '@vybestack/llxprt-code-core/services/history/provider-normalization-storage.js';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { normalizeToOpenAIToolId } from '@vybestack/llxprt-code-tools/toolIdNormalization.js';

/**
 * Which tool calls have a stored response row and which responses have a stored
 * call row, built in one pass over the request rows. Ids live in a disk-backed
 * hash, so membership costs a few small reads instead of a rescan of the whole
 * history per tool call, and no id set is held on the heap.
 */
export class ToolPairIndex {
  private constructor(
    private readonly directory: string,
    private readonly storage: ProviderNormalizationStorage,
  ) {}

  static async build(
    rows: AsyncIterable<IContent>,
    signal?: AbortSignal,
  ): Promise<ToolPairIndex> {
    const directory = createScratchDirSync('responses-tool-pairs-');
    let storage: ProviderNormalizationStorage | undefined;
    try {
      storage = new ProviderNormalizationStorage(directory);
      const index = new ToolPairIndex(directory, storage);
      for await (const row of rows) {
        signal?.throwIfAborted();
        index.record(row);
      }
      return index;
    } catch (error) {
      try {
        storage?.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
      throw error;
    }
  }

  private record(row: IContent): void {
    for (const block of row.blocks) {
      if (row.speaker === 'ai' && block.type === 'tool_call')
        this.storage.set(`call:${normalizeToOpenAIToolId(block.id)}`, 1);
      if (row.speaker === 'tool' && block.type === 'tool_response')
        this.storage.set(
          `response:${normalizeToOpenAIToolId(block.callId)}`,
          1,
        );
    }
  }

  /** A tool row answers the call with this OpenAI-normalized id. */
  hasResponse(id: string): boolean {
    return this.storage.get(`response:${id}`) !== undefined;
  }

  /** An assistant row issued the call with this OpenAI-normalized id. */
  hasCall(id: string): boolean {
    return this.storage.get(`call:${id}`) !== undefined;
  }

  close(): void {
    try {
      this.storage.close();
    } finally {
      rmSync(this.directory, { recursive: true, force: true });
    }
  }
}
