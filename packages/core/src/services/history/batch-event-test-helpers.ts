/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

import type { HistoryBatchValues as BatchTestValues } from './history-batch-values.js';
export type {
  HistoryBatchValues as BatchTestValues,
  HistoryBatchCursor as BatchTestCursor,
} from './history-batch-values.js';
function isBatchValues(value: unknown): value is BatchTestValues {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  if (!('length' in value) || typeof value.length !== 'number') return false;
  return 'withRows' in value && typeof value.withRows === 'function';
}
export function batchValues(value: unknown): BatchTestValues {
  if (!isBatchValues(value))
    throw new Error('Expected scoped batch values, not an array');
  return value;
}
export function batchText(row: IContent): string {
  return row.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');
}
export function visitBatch(
  value: unknown,
  visit: (row: IContent) => void,
): number {
  let count = 0;
  batchValues(value).withRows((cursor) => {
    for (let item = cursor.next(); item.done !== true; item = cursor.next()) {
      visit(item.value);
      count++;
    }
  });
  return count;
}
export function* eventRows(
  size: number,
  bytes = 2048,
): Generator<IContent, void, unknown> {
  for (let index = 0; index < size; index++)
    yield {
      speaker: 'human',
      blocks: [{ type: 'text', text: `${index}:` + 'x'.repeat(bytes) }],
    };
}
