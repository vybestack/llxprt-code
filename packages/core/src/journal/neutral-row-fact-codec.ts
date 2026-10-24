/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';

const TAG = Uint8Array.of(0x4e, 0x52, 0x46, 1);

export function isNeutralRowFact(bytes: Uint8Array): boolean {
  return (
    bytes.length >= TAG.length &&
    TAG.every((byte, index) => bytes[index] === byte)
  );
}

export function encodeNeutralRowFact(value: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(TAG.length + value.length);
  bytes.set(TAG);
  bytes.set(value, TAG.length);
  return bytes;
}

export function decodeNeutralRowFact(bytes: Uint8Array): Uint8Array {
  if (!isNeutralRowFact(bytes))
    throw new JournalFormatError('Invalid neutral row fact tag');
  return bytes.subarray(TAG.length);
}
