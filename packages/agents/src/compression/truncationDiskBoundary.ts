/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryIndexedRows } from '@vybestack/llxprt-code-core/services/history/historyMutationSnapshot.js';

function unmatched(
  rows: HistoryIndexedRows,
  ai: IContent,
  start: number,
): boolean {
  for (const call of ai.blocks) {
    if (call.type !== 'tool_call') continue;
    let found = false;
    for (let index = start; index < rows.length; index++) {
      const row = rows.readRow(index);
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

export function forwardDiskToolBoundary(
  rows: HistoryIndexedRows,
  start: number,
): number {
  let index = start;
  while (index < rows.length && rows.readRow(index).speaker === 'tool') index++;
  if (index > 0 && index < rows.length) {
    const previous = rows.readRow(index - 1);
    return previous.speaker === 'ai' && unmatched(rows, previous, index)
      ? index - 1
      : index;
  }
  return index;
}

export function adjustDiskToolBoundary(
  rows: HistoryIndexedRows,
  start: number,
): number {
  if (start <= 0 || rows.length === 0) return start;
  const index = forwardDiskToolBoundary(rows, start);
  if (index < rows.length) return index;
  for (let backward = start - 1; backward >= 0; backward--) {
    const row = rows.readRow(backward);
    if (
      row.speaker === 'tool' ||
      (row.speaker === 'ai' &&
        row.blocks.some((block) => block.type === 'tool_call') &&
        unmatched(rows, row, backward + 1))
    )
      continue;
    return backward + 1;
  }
  return start;
}
