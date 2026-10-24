/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ID_NS } from './idKeys.js';
import { JournalFormatError } from './errors.js';
import type { IdFactBatch } from './idFactBatch.js';
import type { IdFactQueries } from './idFactQueries.js';
import type { VersionSnapshot } from './versionSnapshot.js';
import type { VersionEdit } from './groupEdits.js';
import type { Version } from './version.js';

export const NATIVE_FACT_NAMESPACE = ID_NS.nativeScalar;
export const ACTIVE_FACT_INDEX = 'native:scalar-index';
export const NATIVE_FACTS_THROUGH = 'native:scalar-through';
const utf8 = new TextEncoder();
export type NativeFactKey = ReadonlyArray<string | number>;

function keyOf(scope: string, key: NativeFactKey): Uint8Array {
  return utf8.encode(JSON.stringify([scope, ...key]));
}

export class NativeFactIndexReader {
  constructor(
    private readonly facts: IdFactQueries,
    readonly scope: string,
  ) {}
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
