/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { ROW_BLOCK_TYPE } from './rowRecord.js';
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import { transcriptEntries } from './transcript-tree.js';
import {
  chunkValue,
  decodeChunkBlock,
  chunkFieldParts,
  type ChunkBlock,
  type ChunkManifest,
} from './chunk-row.js';

export const ARRIVAL_FIELDS = [
  'text',
  'thought',
  'signature',
  'id',
  'name',
  'parameters',
  'data',
  'mimeType',
  'code',
  'language',
  'reasoningId',
  'redactedData',
  'encoding',
  'sourceField',
  'streamId',
  'streamStatus',
  'encryptedContent',
] satisfies readonly string[];
export type ArrivalFieldName =
  | 'text'
  | 'thought'
  | 'signature'
  | 'id'
  | 'name'
  | 'parameters'
  | 'data'
  | 'mimeType'
  | 'code'
  | 'language'
  | 'reasoningId'
  | 'redactedData'
  | 'encoding'
  | 'sourceField'
  | 'streamId'
  | 'streamStatus'
  | 'encryptedContent';
export type ArrivalFieldMode = 'delta' | 'snapshot';
const encoder = new TextEncoder();

function fieldName(code: number): string {
  if (!Number.isInteger(code) || code < 1 || code > ARRIVAL_FIELDS.length)
    throw new JournalFormatError('Unknown arrival field');
  return ARRIVAL_FIELDS[code - 1];
}
export function fieldCode(name: ArrivalFieldName): number {
  return ARRIVAL_FIELDS.indexOf(name) + 1;
}
export function blockPrefix(type: number): string {
  const found = Object.entries(ROW_BLOCK_TYPE).find(
    ([, code]) => code === type,
  );
  if (found === undefined)
    throw new JournalFormatError('Unknown named block type');
  return `{"type":${JSON.stringify(found[0])}`;
}
function fieldPrefix(code: number): string {
  const name = fieldName(code);
  return `,${JSON.stringify(name)}:${name === 'parameters' ? '' : '"'}`;
}
export async function* namedBlockParts(
  access: RecordAccess,
  manifest: ChunkManifest,
  ordinal: number,
  block: ChunkBlock,
): AsyncGenerator<Uint8Array> {
  yield encoder.encode(blockPrefix(block.type));
  for await (const entry of transcriptEntries(
    access,
    block.piecesRoot,
    'blocks',
    0n,
    false,
  )) {
    const code = Number(entry.transcriptId);
    yield encoder.encode(fieldPrefix(code));
    const field = decodeChunkBlock(await chunkValue(access, entry.rowRef));
    yield* chunkFieldParts(access, manifest, ordinal, field, code);
    if (fieldName(code) !== 'parameters') yield encoder.encode('"');
  }
  yield encoder.encode('}');
}
export async function namedBlockLength(
  access: RecordAccess,
  block: ChunkBlock,
): Promise<number> {
  let length = encoder.encode(blockPrefix(block.type)).length + 1;
  for await (const entry of transcriptEntries(
    access,
    block.piecesRoot,
    'blocks',
    0n,
    false,
  )) {
    const field = decodeChunkBlock(await chunkValue(access, entry.rowRef));
    const code = Number(entry.transcriptId);
    length +=
      encoder.encode(fieldPrefix(code)).length +
      field.length +
      Number(fieldName(code) !== 'parameters');
  }
  return length;
}
export function utf16Digest(value: string, units = value.length): string {
  const hash = createHash('sha256');
  for (let at = 0; at < units; at += 8192)
    hash.update(
      Buffer.from(value.slice(at, Math.min(units, at + 8192)), 'utf16le'),
    );
  return hash.digest('hex');
}
export function snapshotSuffix(
  value: string,
  previous: ChunkBlock['snapshot'],
): number {
  if (previous === undefined) return 0;
  if (
    value.length < previous.units ||
    utf16Digest(value, previous.units) !== previous.digest
  )
    throw new Error('Invalid snapshot prefix');
  return previous.units;
}
export function* encodeTextSuffix(
  value: string,
  start: number,
  raw: boolean,
): Generator<Uint8Array> {
  for (let at = start; at < value.length; at += 8192) {
    const slice = value.slice(at, at + 8192);
    yield encoder.encode(
      raw
        ? slice.replace(
            /[\ud800-\udfff]/g,
            (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, '0')}`,
          )
        : JSON.stringify(slice).slice(1, -1),
    );
  }
}
