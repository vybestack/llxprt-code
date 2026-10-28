/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';

interface DisplayRow {
  readonly item: HistoryItemWithoutId;
}

export function settledTranscriptPrefix<T extends DisplayRow>(
  rows: readonly T[],
  responding: boolean,
): readonly T[] {
  const completed = (row: T): boolean =>
    row.item.type !== 'tool_group' ||
    row.item.tools.every(
      (tool) =>
        tool.status === ToolCallStatus.Success ||
        tool.status === ToolCallStatus.Error ||
        tool.status === ToolCallStatus.Canceled,
    ) === true;
  // An aborted turn may have no tool result; its cancellation notice must still print.
  if (!responding) return rows.filter(completed);
  const incomplete = rows.findIndex((row) => !completed(row));
  return incomplete < 0 ? rows : rows.slice(0, incomplete);
}
