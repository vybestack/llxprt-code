/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { IdFactBatch } from './idFactBatch.js';
import { ID_NS } from './idKeys.js';
import type { IdKeyHasher } from './idKeys.js';
import type { IdNodeCache } from './idTrieCache.js';
import type { Version } from './version.js';
import { synchronousIdValue } from './synchronousIdValue.js';

export function readContextSpans(
  fd: number,
  version: Version | undefined,
  hasher: IdKeyHasher,
  cache: IdNodeCache,
): ContextSpan[] {
  if (
    version === undefined ||
    version.rows === 0 ||
    version.aggregate.noChronologyRows > 0
  )
    return [];
  const get = (ordinal: number): Uint8Array | undefined =>
    synchronousIdValue(
      fd,
      version.roots.idRoot,
      version.durableEnd,
      hasher(ID_NS.nativeScalar, contextSpanKey(ordinal)),
      cache,
    );
  const stored = get(0);
  if (stored === undefined) return [];
  if (stored.length !== 8)
    throw new JournalFormatError('Invalid context span count');
  const count = contextSpanNumber(stored);
  const spans: ContextSpan[] = [];
  for (let ordinal = 1; ordinal <= count; ordinal++) {
    const value = get(ordinal);
    if (value === undefined || value.length !== 16)
      throw new JournalFormatError('Missing committed context span');
    spans.push({
      start: contextSpanNumber(value),
      end: contextSpanNumber(value, 8),
    });
  }
  return spans;
}

export interface ContextSpan {
  readonly start: number;
  readonly end: number;
}
export type ContextSpanPolicy = (
  metadata: Uint8Array,
) => ContextSpan | undefined;

export function contextSpanKey(ordinal: number): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify(['history:context-spans:1', ordinal]),
  );
}

export function contextSpanNumber(bytes: Uint8Array, offset = 0): number {
  const value = Number(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(
      offset,
      true,
    ),
  );
  if (!Number.isSafeInteger(value))
    throw new JournalFormatError('Invalid context span scalar');
  return value;
}

export async function applyContextSpan(
  batch: IdFactBatch,
  span: ContextSpan | undefined,
): Promise<void> {
  if (span === undefined) return;
  const previous = await batch.queries.getEntry(
    ID_NS.nativeScalar,
    contextSpanKey(0),
  );
  const count = previous === undefined ? 1 : contextSpanNumber(previous) + 1;
  const value = new Uint8Array(16);
  const view = new DataView(value.buffer);
  view.setBigUint64(0, BigInt(span.start), true);
  view.setBigUint64(8, BigInt(span.end), true);
  await batch.setEntry(ID_NS.nativeScalar, contextSpanKey(count), value);
  const countBytes = new Uint8Array(8);
  new DataView(countBytes.buffer).setBigUint64(0, BigInt(count), true);
  await batch.setEntry(ID_NS.nativeScalar, contextSpanKey(0), countBytes);
}
