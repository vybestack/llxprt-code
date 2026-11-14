/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';

export function formatLastUsed(value: Uint8Array | undefined): bigint {
  if (value === undefined) return 0n;
  if (value.byteLength < 8)
    throw new JournalFormatError('Invalid format slot metadata');
  return new DataView(
    value.buffer,
    value.byteOffset,
    value.byteLength,
  ).getBigUint64(0, true);
}

export function formatSlotMetadata(
  used: bigint,
  auxiliary: Uint8Array = new Uint8Array(),
): Uint8Array {
  const value = new Uint8Array(8 + auxiliary.byteLength);
  new DataView(value.buffer).setBigUint64(0, used, true);
  value.set(auxiliary, 8);
  return value;
}
