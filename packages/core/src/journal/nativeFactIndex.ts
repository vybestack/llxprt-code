/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ID_NS } from './idKeys.js';
import { JournalFormatError } from './errors.js';
import { ID_VALUE_MAX_BYTES } from './idTrieNode.js';
import {
  encodeNeutralRowFact,
  decodeNeutralRowFact,
} from './neutral-row-fact-codec.js';
const BYTE_FACT_PAYLOAD_BYTES = ID_VALUE_MAX_BYTES - 4;
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { VersionEdit } from './groupEdits.js';
import type { Version } from './version.js';

export const NATIVE_FACT_NAMESPACE = ID_NS.nativeScalar;
export const ACTIVE_FACT_INDEX = 'native:scalar-index';
const utf8 = new TextEncoder();

export function nativeFactCoverage(value: Uint8Array | undefined):
  | {
      readonly scope: string;
      readonly through: bigint;
    }
  | undefined {
  if (value === undefined) return undefined;
  if (value.byteLength < 8)
    throw new JournalFormatError('Invalid native fact coverage');
  return {
    scope: new TextDecoder().decode(value.subarray(8)),
    through: new DataView(
      value.buffer,
      value.byteOffset,
      value.byteLength,
    ).getBigUint64(0, true),
  };
}

export function encodeNativeFactCoverage(
  scope: string,
  through: number,
): Uint8Array {
  const bytes = utf8.encode(scope);
  const value = new Uint8Array(8 + bytes.byteLength);
  new DataView(value.buffer).setBigUint64(0, BigInt(through), true);
  value.set(bytes, 8);
  return value;
}
export type NativeFactKey = ReadonlyArray<string | number>;

function keyOf(scope: string, key: NativeFactKey): Uint8Array {
  return utf8.encode(JSON.stringify([scope, ...key]));
}

export class NativeFactIndexReader {
  constructor(
    private readonly facts: IdFactQueries,
    readonly scope: string,
  ) {}
  async getBytes(key: NativeFactKey): Promise<Uint8Array | undefined> {
    const encoded = await this.facts.getEntry(
      NATIVE_FACT_NAMESPACE,
      keyOf(this.scope, ['bytes', ...key]),
    );
    if (encoded === undefined) return undefined;
    const head = decodeNeutralRowFact(encoded);
    if (head.length < 4)
      throw new JournalFormatError('Invalid native byte fact header');
    const length = new DataView(
      head.buffer,
      head.byteOffset,
      head.byteLength,
    ).getUint32(0, true);
    if (head.length !== Math.min(BYTE_FACT_PAYLOAD_BYTES, length + 4))
      throw new JournalFormatError('Invalid native byte fact length');
    const value = new Uint8Array(length);
    value.set(head.subarray(4));
    for (
      let offset = BYTE_FACT_PAYLOAD_BYTES - 4;
      offset < value.length;
      offset += BYTE_FACT_PAYLOAD_BYTES
    ) {
      const part = await this.facts.getEntry(
        NATIVE_FACT_NAMESPACE,
        keyOf(this.scope, ['bytes', ...key, offset]),
      );
      if (
        part === undefined ||
        part.length !==
          Math.min(BYTE_FACT_PAYLOAD_BYTES, value.length - offset) + 4
      )
        throw new JournalFormatError('Missing native byte fact fragment');
      value.set(decodeNeutralRowFact(part), offset);
    }
    return value;
  }
  async get(key: NativeFactKey): Promise<readonly number[] | undefined> {
    const value = await this.facts.getEntry(
      NATIVE_FACT_NAMESPACE,
      keyOf(this.scope, key),
    );
    if (value === undefined) return undefined;
    if (value.length > 20 || value.length % 4 !== 0)
      throw new JournalFormatError('Invalid native scalar fact');
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return Array.from({ length: value.length / 4 }, (_, index) =>
      view.getUint32(index * 4, true),
    );
  }
}

export class NativeFactIndexWriter extends NativeFactIndexReader {
  constructor(
    private readonly batch: IdFactBatch,
    scope: string,
  ) {
    super(batch.queries, scope);
  }
  async setBytes(key: NativeFactKey, value: Uint8Array): Promise<void> {
    const head = new Uint8Array(
      Math.min(BYTE_FACT_PAYLOAD_BYTES, value.length + 4),
    );
    new DataView(head.buffer).setUint32(0, value.length, true);
    head.set(value.subarray(0, BYTE_FACT_PAYLOAD_BYTES - 4), 4);
    await this.batch.setEntry(
      NATIVE_FACT_NAMESPACE,
      keyOf(this.scope, ['bytes', ...key]),
      encodeNeutralRowFact(head),
    );
    for (
      let offset = BYTE_FACT_PAYLOAD_BYTES - 4;
      offset < value.length;
      offset += BYTE_FACT_PAYLOAD_BYTES
    )
      await this.batch.setEntry(
        NATIVE_FACT_NAMESPACE,
        keyOf(this.scope, ['bytes', ...key, offset]),
        encodeNeutralRowFact(
          value.subarray(offset, offset + BYTE_FACT_PAYLOAD_BYTES),
        ),
      );
  }
  async set(key: NativeFactKey, values: readonly number[]): Promise<void> {
    if (values.length > 5)
      throw new JournalFormatError('Native facts hold at most five scalars');
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (const [index, value] of values.entries()) {
      if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff)
        throw new JournalFormatError('Native fact scalar is outside uint32');
      view.setUint32(index * 4, value, true);
    }
    await this.batch.setEntry(
      NATIVE_FACT_NAMESPACE,
      keyOf(this.scope, key),
      bytes,
    );
  }
}

export interface NativeFactIndexRegistration {
  readonly scope: string;
  readonly append?: (
    snapshot: VersionSnapshot,
    writer: NativeFactIndexWriter,
    previous: Version,
    edits: readonly VersionEdit[],
  ) => Promise<boolean>;
  readonly write: (
    snapshot: VersionSnapshot,
    writer: NativeFactIndexWriter,
    generation: readonly number[],
  ) => Promise<void>;
}

export function nativeFactVersion(sequence: number): readonly number[] {
  return [sequence >>> 0, Math.floor(sequence / 0x1_0000_0000)];
}
