/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { crc32 as zlibCrc32 } from 'node:zlib';
import { JournalFormatError } from './errors.js';

export type Pair<T> = readonly [T, T];
export type Triple<T> = readonly [T, T, T];
export type Quad<T> = readonly [T, T, T, T];

/** A field of a fixed layout: where it starts and how many bytes it takes. */
export interface FieldSpan {
  readonly offset: number;
  readonly size: number;
}

export function span(offset: number, size: number): FieldSpan {
  return { offset, size };
}

const U64_LIMIT = 1n << 64n;

/** CRC-32 (zlib polynomial). Pass the previous result to continue over more bytes. */
export function crc32(data: Uint8Array, previous = 0): number {
  return zlibCrc32(data, previous);
}

export function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function assertIntegerInRange(name: string, value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new JournalFormatError(
      `${name} ${String(value)} does not fit its field (0 to ${max})`,
    );
  }
}

export function putU8(
  view: DataView,
  offset: number,
  name: string,
  value: number,
): void {
  assertIntegerInRange(name, value, 0xff);
  view.setUint8(offset, value);
}

export function putU16(
  view: DataView,
  offset: number,
  name: string,
  value: number,
): void {
  assertIntegerInRange(name, value, 0xffff);
  view.setUint16(offset, value, true);
}

export function putU32(
  view: DataView,
  offset: number,
  name: string,
  value: number,
): void {
  assertIntegerInRange(name, value, 0xffffffff);
  view.setUint32(offset, value, true);
}

/** A u64 that the program holds as a number (offsets, lengths, counts). */
export function putU64(
  view: DataView,
  offset: number,
  name: string,
  value: number,
): void {
  assertIntegerInRange(name, value, Number.MAX_SAFE_INTEGER);
  view.setBigUint64(offset, BigInt(value), true);
}

/** A u64 that the program holds as a bigint (labels, hashes, bit sets). */
export function putU64Big(
  view: DataView,
  offset: number,
  name: string,
  value: bigint,
): void {
  if (value < 0n || value >= U64_LIMIT) {
    throw new JournalFormatError(
      `${name} ${String(value)} does not fit its field (0 to 2^64-1)`,
    );
  }
  view.setBigUint64(offset, value, true);
}

/** Reads a u64 as a number; a value above 2^53-1 cannot be held exactly and is refused. */
export function getU64(view: DataView, offset: number, name: string): number {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new JournalFormatError(
      `${name} ${String(value)} exceeds the largest exactly representable integer`,
    );
  }
  return Number(value);
}

export function getU64Big(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, true);
}

/** Fixed-length byte fields are copied in and out so no record aliases a caller's buffer. */
export function putBytes(
  target: Uint8Array,
  offset: number,
  name: string,
  value: Uint8Array,
  length: number,
): void {
  if (value.length !== length) {
    throw new JournalFormatError(
      `${name} must be ${length} bytes, got ${value.length}`,
    );
  }
  target.set(value, offset);
}

export function assertAllZero(
  bytes: Uint8Array,
  start: number,
  end: number,
  what: string,
): void {
  for (let index = start; index < end; index++) {
    if (bytes[index] !== 0) {
      throw new JournalFormatError(
        `${what} must be zero, found ${bytes[index]} at byte ${index}`,
      );
    }
  }
}

export function assertLength(
  bytes: Uint8Array,
  expected: number,
  what: string,
): void {
  if (bytes.length !== expected) {
    throw new JournalFormatError(
      `${what} must be ${expected} bytes, got ${bytes.length}`,
    );
  }
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
