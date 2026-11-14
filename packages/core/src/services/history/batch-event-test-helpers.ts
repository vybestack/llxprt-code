/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';

import type {
  HistoryBatchRowSource,
  HistoryBatchValues as BatchTestValues,
} from './history-batch-values.js';
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
function isBatchRowSource(value: unknown): value is HistoryBatchRowSource {
  if (typeof value !== 'object' || value === null) return false;
  if (!('length' in value) || typeof value.length !== 'number') return false;
  if (!('retire' in value) || typeof value.retire !== 'function') return false;
  return 'rows' in value && typeof value.rows === 'function';
}
/** The payload as the one row-source contract, which both stores deliver. */
export function batchRowSource(value: unknown): HistoryBatchRowSource {
  if (!isBatchRowSource(value)) throw new Error('Expected a batch row source');
  return value;
}
/** Starts a pass over the payload now (call it from the listener) and resolves with `project` of each row. */
export async function readBatch<T>(
  value: unknown,
  project: (row: IContent) => T,
): Promise<T[]> {
  const out: T[] = [];
  for await (const row of batchRowSource(value).rows()) out.push(project(row));
  return out;
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
