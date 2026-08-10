/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

function expectedSequenceLength(leadByte: number): number {
  if (leadByte < 0x80) {
    return 1;
  }
  if (leadByte < 0xe0) {
    return 2;
  }
  if (leadByte < 0xf0) {
    return 3;
  }
  if (leadByte < 0xf8) {
    return 4;
  }
  return 1;
}

/** Returns the prefix length that ends on a complete UTF-8 character. */
export function completeUtf8PrefixLength(buffer: Buffer): number {
  if (buffer.length === 0) {
    return 0;
  }

  let sequenceStart = buffer.length - 1;
  while (sequenceStart >= 0 && (buffer[sequenceStart] & 0xc0) === 0x80) {
    sequenceStart -= 1;
  }
  if (sequenceStart < 0) {
    return 0;
  }

  const expectedLength = expectedSequenceLength(buffer[sequenceStart]);
  return buffer.length - sequenceStart < expectedLength
    ? sequenceStart
    : buffer.length;
}

/** Returns the first offset that does not continue an omitted UTF-8 character. */
export function completeUtf8SuffixStart(buffer: Buffer): number {
  let start = 0;
  while (start < buffer.length && (buffer[start] & 0xc0) === 0x80) {
    start += 1;
  }
  return start;
}

/** Returns a copied prefix that does not end in an incomplete UTF-8 sequence. */
export function trimIncompleteTrailingUtf8(buffer: Buffer): Buffer {
  const length = completeUtf8PrefixLength(buffer);
  return length === buffer.length
    ? buffer
    : Buffer.from(buffer.subarray(0, length));
}

/** Returns a copied suffix that does not start inside a UTF-8 sequence. */
export function skipIncompleteLeadingUtf8(buffer: Buffer): Buffer {
  const start = completeUtf8SuffixStart(buffer);
  return start === 0 ? buffer : Buffer.from(buffer.subarray(start));
}
