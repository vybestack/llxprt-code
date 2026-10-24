/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ID_VALUE_MAX_BYTES } from './idTrieNode.js';
import { ID_NS } from './idKeys.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { IdFactBatch } from './idFactBatch.js';
import { JournalFormatError } from './errors.js';
import {
  decodeNeutralRowFact,
  encodeNeutralRowFact,
} from './neutral-row-fact-codec.js';

const MANIFEST_PREFIX = Uint8Array.of(0, 78, 82, 70);
const CHUNK_BYTES =
  ID_VALUE_MAX_BYTES - encodeNeutralRowFact(new Uint8Array()).length;

function chunkKey(key: Uint8Array, index: number): Uint8Array {
  const suffix = new TextEncoder().encode(`:part:${index}`);
  const bytes = new Uint8Array(key.length + suffix.length);
  bytes.set(key);
  bytes.set(suffix, key.length);
  return bytes;
}

export async function readNeutralRowFact(
  facts: IdFactQueries,
  key: Uint8Array,
): Promise<Uint8Array | undefined> {
  const stored = await facts.getEntry(ID_NS.neutralRow, key);
  if (stored === undefined) return undefined;
  const value = decodeNeutralRowFact(stored);
  if (!MANIFEST_PREFIX.every((byte, index) => value[index] === byte))
    return value;
  if (value.length !== 8)
    throw new JournalFormatError('Invalid neutral fact manifest');
  const length = new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  ).getUint32(4, true);
  const result = new Uint8Array(length);
  for (
    let offset = 0, index = 0;
    offset < length;
    offset += CHUNK_BYTES, index++
  ) {
    const bytes = await facts.getEntry(ID_NS.neutralRow, chunkKey(key, index));
    if (bytes === undefined)
      throw new JournalFormatError('Missing neutral fact chunk');
    const chunk = decodeNeutralRowFact(bytes);
    if (chunk.length !== Math.min(CHUNK_BYTES, length - offset))
      throw new JournalFormatError('Invalid neutral fact chunk length');
    result.set(chunk, offset);
  }
  return result;
}

export async function writeNeutralRowFact(
  batch: IdFactBatch,
  key: Uint8Array,
  value: Uint8Array,
): Promise<void> {
  if (value.length <= CHUNK_BYTES) {
    await batch.setEntry(ID_NS.neutralRow, key, encodeNeutralRowFact(value));
    return;
  }
  const manifest = new Uint8Array(8);
  manifest.set(MANIFEST_PREFIX);
  new DataView(manifest.buffer).setUint32(4, value.length, true);
  await batch.setEntry(ID_NS.neutralRow, key, encodeNeutralRowFact(manifest));
  for (
    let offset = 0, index = 0;
    offset < value.length;
    offset += CHUNK_BYTES, index++
  )
    await batch.setEntry(
      ID_NS.neutralRow,
      chunkKey(key, index),
      encodeNeutralRowFact(value.subarray(offset, offset + CHUNK_BYTES)),
    );
}
