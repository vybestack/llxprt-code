/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ProviderRequestRows } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import {
  createInMemoryToolIdStore,
  getToolIdStrategy,
} from '@vybestack/llxprt-code-tools/ToolIdStrategy.js';
import type { ToolFormat } from '@vybestack/llxprt-code-tools/IToolFormatter.js';
import type { NativeRowIds } from './native-row-ids.js';

export async function callerOwnedChatIds(
  rows: ProviderRequestRows,
  format: ToolFormat,
): Promise<NativeRowIds | undefined> {
  if (format !== 'kimi' && format !== 'mistral') return undefined;
  const mapper = getToolIdStrategy(format).createStreamingMapper(
    createInMemoryToolIdStore(),
  );
  for await (const row of rows.openReader()) mapper.observe(row);
  const ids: string[][] = [];
  for await (const row of rows.openReader()) {
    ids.push(
      row.blocks.flatMap((block) => {
        if (row.speaker === 'ai' && block.type === 'tool_call')
          return [mapper.resolveToolCallId(block)];
        if (row.speaker === 'tool' && block.type === 'tool_response')
          return [mapper.resolveToolResponseId(block)];
        return [];
      }),
    );
  }
  return async (_row, index) => () => {
    let within = 0;
    const resolve = (): string => {
      if (within >= ids[index].length)
        throw new Error('Missing caller-owned Chat id');
      return ids[index][within++];
    };
    return {
      observe: () => undefined,
      resolveToolCallId: resolve,
      resolveToolResponseId: resolve,
    };
  };
}
