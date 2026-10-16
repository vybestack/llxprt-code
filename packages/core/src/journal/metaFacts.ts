/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { KeyedMapBatch } from './keyedMap.js';
import { ROW_FLAG } from './rowRecord.js';

/** Design 3.5: the length of the Kimi exception-id list. */
export const KIMI_EXCEPTION_KEY = 'kimi:exc';

const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/** Values of the meta map are decimal text, which is also valid JSON for a count. */
export function encodeDecimal(value: bigint | number): Uint8Array {
  return UTF8.encode(value.toString());
}

export function decodeDecimal(bytes: Uint8Array): bigint {
  const text = UTF8_DECODER.decode(bytes);
  if (!/^\d+$/.test(text)) {
    throw new JournalFormatError(
      `Meta value ${JSON.stringify(text)} is not a decimal`,
    );
  }
  return BigInt(text);
}

/** `parent:<endpoint>:<k>`, `k` from 1: the label of the k-th usable Responses parent of one endpoint class. */
export function parentListKey(endpoint: bigint, ordinal: number): string {
  return `parent:${endpoint.toString(16)}:${ordinal}`;
}

export function parentCountKey(endpoint: bigint): string {
  return `parent:${endpoint.toString(16)}:count`;
}

/** What the parent lists need of a row. */
export interface ParentCandidate {
  readonly label: bigint;
  readonly flags: number;
  readonly parentEndpoint: bigint;
}

/**
 * Adds the row to the parent list of its endpoint class when its header says
 * it is a usable Responses parent (design 3.5). Endpoint 0 is the wildcard
 * list. Rows arrive in label order, so each list stays ascending.
 */
export async function joinParentList(
  meta: KeyedMapBatch,
  row: ParentCandidate,
): Promise<void> {
  if ((row.flags & ROW_FLAG.responseParent) === 0) return;
  const countKey = parentCountKey(row.parentEndpoint);
  const stored = await meta.get(countKey);
  const next = (stored === undefined ? 0 : Number(decodeDecimal(stored))) + 1;
  meta.set(parentListKey(row.parentEndpoint, next), encodeDecimal(row.label));
  meta.set(countKey, encodeDecimal(next));
}
