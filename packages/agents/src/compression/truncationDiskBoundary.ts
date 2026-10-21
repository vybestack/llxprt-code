/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionIndexedRows as HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/compressionInput.js';

async function unmatched(
  rows: HistoryIndexedRows,
  ai: IContent,
  start: number,
): Promise<boolean> {
  for (const call of ai.blocks) {
    if (call.type !== 'tool_call') continue;
    let found = false;
    for (let index = start; index < rows.length; index++) {
      const row = await rows.readRow(index);
      if (
        row.speaker === 'tool' &&
        row.blocks.some(
          (block) => block.type === 'tool_response' && block.callId === call.id,
        )
      ) {
        found = true;
        break;
      }
    }
    if (!found) return true;
  }
  return false;
}

export async function forwardDiskToolBoundary(
  rows: HistoryIndexedRows,
  start: number,
): Promise<number> {
  let index = start;
  while (index < rows.length && (await rows.readRow(index)).speaker === 'tool')
    index++;
  if (index > 0 && index < rows.length) {
    const previous = await rows.readRow(index - 1);
    return previous.speaker === 'ai' && (await unmatched(rows, previous, index))
      ? index - 1
      : index;
  }
  return index;
}

export async function adjustDiskToolBoundary(
  rows: HistoryIndexedRows,
  start: number,
): Promise<number> {
  if (start <= 0 || rows.length === 0) return start;
  const index = await forwardDiskToolBoundary(rows, start);
  if (index < rows.length) return index;
  for (let backward = start - 1; backward >= 0; backward--) {
    const row = await rows.readRow(backward);
    if (
      row.speaker === 'tool' ||
      (row.speaker === 'ai' &&
        row.blocks.some((block) => block.type === 'tool_call') &&
        (await unmatched(rows, row, backward + 1)))
    )
      continue;
    return backward + 1;
  }
  return start;
}
