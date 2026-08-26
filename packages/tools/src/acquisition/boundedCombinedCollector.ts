/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TextDecoder } from 'node:util';
import { DEFAULT_OMISSION_NOTICE } from './boundedStreamCollector.js';
import {
  completeUtf8PrefixLength,
  completeUtf8SuffixStart,
} from './utf8Boundaries.js';
import type {
  ByteBudget,
  CombinedAcquisitionResult,
  StreamSource,
  TruncationMetadata,
} from './types.js';

export interface BoundedCombinedCollectorOptions {
  budget: ByteBudget;
  encoding?: string;
  headFraction?: number;
}

interface TaggedBytes {
  readonly bytes: Buffer;
  readonly stderrBits: Uint8Array;
}

interface CollectorStorage {
  readonly headBytes: Buffer;
  readonly headStderrBits: Uint8Array;
  readonly tailBytes: Buffer;
  readonly tailStderrBits: Uint8Array;
}

const EMPTY_BUFFER = Buffer.alloc(0);
const EMPTY_BITS = new Uint8Array(0);
const OUTPUT_BLOCK_SIZE = 64 * 1024;

function normalizedEncoding(encoding: string): string {
  const normalized = encoding.toLowerCase();
  if (normalized === 'utf8') {
    return 'utf-8';
  }
  if (
    normalized === 'ucs-2' ||
    normalized === 'ucs2' ||
    normalized === 'utf16le'
  ) {
    return 'utf-16le';
  }
  return normalized === 'binary' ? 'latin1' : normalized;
}

function nodeBufferEncoding(encoding: string): BufferEncoding | undefined {
  const normalized = normalizedEncoding(encoding);
  if (normalized === 'utf-8') {
    return 'utf8';
  }
  if (normalized === 'utf-16le') {
    return 'utf16le';
  }
  return Buffer.isEncoding(normalized) ? normalized : undefined;
}

function encode(text: string, encoding: string): Buffer {
  return Buffer.from(text, nodeBufferEncoding(encoding) ?? 'utf8');
}

function sourceBit(source: StreamSource): number {
  return source === 'stderr' ? 1 : 0;
}

function getBit(bits: Uint8Array, index: number): number {
  return (bits[index >>> 3] >>> (index & 7)) & 1;
}

function setBit(bits: Uint8Array, index: number, value: number): void {
  const byteIndex = index >>> 3;
  const mask = 1 << (index & 7);
  if (value === 1) {
    bits[byteIndex] |= mask;
  } else {
    bits[byteIndex] &= ~mask;
  }
}

function fillBits(
  bits: Uint8Array,
  start: number,
  length: number,
  value: number,
): void {
  const end = start + length;
  let index = start;
  while (index < end && (index & 7) !== 0) {
    setBit(bits, index, value);
    index += 1;
  }
  const fullByteEnd = end - (end & 7);
  if (index < fullByteEnd) {
    bits.fill(value === 1 ? 0xff : 0, index >>> 3, fullByteEnd >>> 3);
    index = fullByteEnd;
  }
  while (index < end) {
    setBit(bits, index, value);
    index += 1;
  }
}

function trimTrailingBoundary(bytes: Buffer, encoding: string): Buffer {
  if (encoding === 'utf-8') {
    return bytes.subarray(0, completeUtf8PrefixLength(bytes));
  }
  if (encoding === 'utf-16le') {
    let length = bytes.length - (bytes.length % 2);
    if (
      length >= 2 &&
      bytes.readUInt16LE(length - 2) >= 0xd800 &&
      bytes.readUInt16LE(length - 2) <= 0xdbff
    ) {
      length -= 2;
    }
    return bytes.subarray(0, length);
  }
  return bytes;
}

function trimLeadingBoundary(bytes: Buffer, encoding: string): Buffer {
  if (encoding === 'utf-8') {
    return bytes.subarray(completeUtf8SuffixStart(bytes));
  }
  if (encoding === 'utf-16le') {
    let start = bytes.length % 2;
    if (bytes.length - start >= 2) {
      const codeUnit = bytes.readUInt16LE(start);
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        start += 2;
      }
    }
    return bytes.subarray(start);
  }
  return bytes;
}

class StringAccumulator {
  private readonly blocks: string[] = [];
  private pending = '';

  append(value: string): void {
    if (value === '') {
      return;
    }
    this.pending += value;
    if (this.pending.length >= OUTPUT_BLOCK_SIZE) {
      this.blocks.push(this.pending);
      this.pending = '';
    }
  }

  toString(): string {
    if (this.pending !== '') {
      this.blocks.push(this.pending);
      this.pending = '';
    }
    return this.blocks.join('');
  }
}

function countSource(tagged: TaggedBytes, source: StreamSource): number {
  const wanted = sourceBit(source);
  let count = 0;
  for (let index = 0; index < tagged.bytes.length; index += 1) {
    if (getBit(tagged.stderrBits, index) === wanted) {
      count += 1;
    }
  }
  return count;
}

function extractSource(tagged: TaggedBytes, source: StreamSource): Buffer {
  const output = Buffer.allocUnsafe(countSource(tagged, source));
  const wanted = sourceBit(source);
  let outputIndex = 0;
  for (let index = 0; index < tagged.bytes.length; index += 1) {
    if (getBit(tagged.stderrBits, index) === wanted) {
      output[outputIndex] = tagged.bytes[index];
      outputIndex += 1;
    }
  }
  return output;
}

function decodeSourceRegions(
  head: Buffer,
  tail: Buffer,
  encoding: string,
  truncated: boolean,
): string {
  if (!truncated) {
    const decoder = new TextDecoder(encoding, { fatal: false });
    return decoder.decode(head, { stream: true }) + decoder.decode(tail);
  }
  const safeHead = trimTrailingBoundary(head, encoding);
  const safeTail = trimLeadingBoundary(tail, encoding);
  return (
    new TextDecoder(encoding, { fatal: false }).decode(safeHead) +
    new TextDecoder(encoding, { fatal: false }).decode(safeTail)
  );
}

function decodeTagged(
  tagged: TaggedBytes,
  encoding: string,
  options: { flush: boolean; stdoutSkip?: number; stderrSkip?: number },
): string {
  const decoders = {
    stdout: new TextDecoder(encoding, { fatal: false }),
    stderr: new TextDecoder(encoding, { fatal: false }),
  };
  const accumulator = new StringAccumulator();
  const skipped = {
    stdout: options.stdoutSkip ?? 0,
    stderr: options.stderrSkip ?? 0,
  };
  let index = 0;
  while (index < tagged.bytes.length) {
    const bit = getBit(tagged.stderrBits, index);
    const source: StreamSource = bit === 1 ? 'stderr' : 'stdout';
    let runEnd = index + 1;
    while (
      runEnd < tagged.bytes.length &&
      getBit(tagged.stderrBits, runEnd) === bit
    ) {
      runEnd += 1;
    }
    const skip = Math.min(skipped[source], runEnd - index);
    skipped[source] -= skip;
    const decodeStart = index + skip;
    if (decodeStart < runEnd) {
      accumulator.append(
        decoders[source].decode(tagged.bytes.subarray(decodeStart, runEnd), {
          stream: true,
        }),
      );
    }
    index = runEnd;
  }
  if (options.flush) {
    accumulator.append(decoders.stdout.decode());
    accumulator.append(decoders.stderr.decode());
  }
  return accumulator.toString();
}

/**
 * Retains one ordered byte budget across stdout and stderr.
 *
 * Provenance uses one bit per retained byte, so even pathological bytewise
 * source alternation has fixed overhead of budget / 8 instead of one object or
 * byte-sized tag per retained byte. Decoding uses independent streaming
 * decoders per source while preserving the retained combined arrival order.
 *
 * @plan PLAN-20260825-SHELLMEM.P01
 * @requirement REQ-3329-04
 */
export class BoundedCombinedCollector {
  private readonly budget: ByteBudget;
  private readonly encoding: string;
  private readonly headCapacity: number;
  private readonly tailCapacity: number;
  private storage: CollectorStorage | null = null;
  private headLength = 0;
  private tailWritePosition = 0;
  private tailLength = 0;
  private observedBytes = 0;
  private cachedTail: TaggedBytes | null = null;

  constructor(options: BoundedCombinedCollectorOptions) {
    this.budget = options.budget;
    this.encoding = normalizedEncoding(options.encoding ?? 'utf8');
    const fraction = Math.min(Math.max(options.headFraction ?? 0.5, 0), 1);
    this.headCapacity = Math.floor(this.budget.bytes * fraction);
    this.tailCapacity = this.budget.bytes - this.headCapacity;
  }

  get observedByteCount(): number {
    return this.observedBytes;
  }

  /** @plan PLAN-20260825-SHELLMEM.P01 @requirement REQ-3329-04 */
  private ensureStorage(): CollectorStorage {
    this.storage ??= {
      headBytes: Buffer.allocUnsafe(this.headCapacity),
      headStderrBits: new Uint8Array(Math.ceil(this.headCapacity / 8)),
      tailBytes: Buffer.allocUnsafe(this.tailCapacity),
      tailStderrBits: new Uint8Array(Math.ceil(this.tailCapacity / 8)),
    };
    return this.storage;
  }

  append(chunk: Buffer | string, source: StreamSource): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : encode(chunk, this.encoding);
    if (bytes.length === 0) {
      return;
    }
    const storage = this.ensureStorage();
    this.observedBytes += bytes.length;
    this.cachedTail = null;

    const headTake = Math.min(
      bytes.length,
      this.headCapacity - this.headLength,
    );
    if (headTake > 0) {
      bytes.copy(storage.headBytes, this.headLength, 0, headTake);
      fillBits(
        storage.headStderrBits,
        this.headLength,
        headTake,
        sourceBit(source),
      );
      this.headLength += headTake;
    }
    if (headTake < bytes.length) {
      this.appendTail(storage, bytes.subarray(headTake), source);
    }
  }

  flushAllDecoders(): void {
    // Decoding is intentionally deferred until a bounded result is requested.
  }

  getStdoutText(): string {
    return this.getResult().stdoutText;
  }

  getStderrText(): string {
    return this.getResult().stderrText;
  }

  getHeadBytes(maxBytes: number): Buffer {
    const length = Math.min(Math.max(Math.floor(maxBytes), 0), this.headLength);
    if (this.storage === null || length === 0) {
      return EMPTY_BUFFER;
    }
    const output = Buffer.allocUnsafe(length);
    this.storage.headBytes.copy(output, 0, 0, length);
    return output;
  }

  getBoundedRawBuffer(): Buffer {
    const head = this.headTagged().bytes;
    const tail = this.materializeTail().bytes;
    const output = Buffer.allocUnsafe(head.length + tail.length);
    head.copy(output, 0);
    tail.copy(output, head.length);
    return output;
  }

  getResult(): CombinedAcquisitionResult {
    const head = this.headTagged();
    const tail = this.materializeTail();
    const retainedBytes = head.bytes.length + tail.bytes.length;
    const omittedBytes = Math.max(0, this.observedBytes - retainedBytes);
    const truncated = omittedBytes > 0;
    const metadata: TruncationMetadata = {
      observedBytes: this.observedBytes,
      retainedBytes,
      omittedBytes,
      truncated,
      budgetBytes: this.budget.bytes,
    };
    const omissionNotice = truncated
      ? `[${DEFAULT_OMISSION_NOTICE}: ${omittedBytes.toLocaleString('en-US')} bytes omitted]`
      : null;

    const decoded = this.decodeCombined(head, tail, truncated);
    const stdoutHead = extractSource(head, 'stdout');
    const stdoutTail = extractSource(tail, 'stdout');
    const stderrHead = extractSource(head, 'stderr');
    const stderrTail = extractSource(tail, 'stderr');

    return {
      text: truncated
        ? `${decoded.headText}\n\n${omissionNotice}\n\n${decoded.tailText}`
        : decoded.headText,
      headText: decoded.headText,
      tailText: decoded.tailText,
      metadata,
      omissionNotice,
      stdoutText: decodeSourceRegions(
        stdoutHead,
        stdoutTail,
        this.encoding,
        truncated,
      ),
      stderrText: decodeSourceRegions(
        stderrHead,
        stderrTail,
        this.encoding,
        truncated,
      ),
    };
  }

  private appendTail(
    storage: CollectorStorage,
    bytes: Buffer,
    source: StreamSource,
  ): void {
    if (this.tailCapacity === 0) {
      return;
    }
    const retainedLength = Math.min(bytes.length, this.tailCapacity);
    const sourceOffset = bytes.length - retainedLength;
    const skipped = sourceOffset;
    const writeStart = (this.tailWritePosition + skipped) % this.tailCapacity;
    this.writeTailSlice(
      storage,
      bytes,
      sourceOffset,
      retainedLength,
      writeStart,
      source,
    );
    this.tailWritePosition =
      (this.tailWritePosition + bytes.length) % this.tailCapacity;
    this.tailLength = Math.min(
      this.tailCapacity,
      this.tailLength + bytes.length,
    );
  }

  private writeTailSlice(
    storage: CollectorStorage,
    sourceBytes: Buffer,
    sourceOffset: number,
    length: number,
    writeStart: number,
    source: StreamSource,
  ): void {
    const firstLength = Math.min(length, this.tailCapacity - writeStart);
    sourceBytes.copy(
      storage.tailBytes,
      writeStart,
      sourceOffset,
      sourceOffset + firstLength,
    );
    fillBits(
      storage.tailStderrBits,
      writeStart,
      firstLength,
      sourceBit(source),
    );
    const remaining = length - firstLength;
    if (remaining > 0) {
      sourceBytes.copy(
        storage.tailBytes,
        0,
        sourceOffset + firstLength,
        sourceOffset + length,
      );
      fillBits(storage.tailStderrBits, 0, remaining, sourceBit(source));
    }
  }

  private headTagged(): TaggedBytes {
    if (this.storage === null) {
      return { bytes: EMPTY_BUFFER, stderrBits: EMPTY_BITS };
    }
    return {
      bytes: this.storage.headBytes.subarray(0, this.headLength),
      stderrBits: this.storage.headStderrBits,
    };
  }

  private materializeTail(): TaggedBytes {
    if (this.cachedTail !== null) {
      return this.cachedTail;
    }
    if (
      this.storage === null ||
      this.tailCapacity === 0 ||
      this.tailLength === 0
    ) {
      this.cachedTail = { bytes: EMPTY_BUFFER, stderrBits: EMPTY_BITS };
      return this.cachedTail;
    }
    const bytes = Buffer.allocUnsafe(this.tailLength);
    const stderrBits = new Uint8Array(Math.ceil(this.tailLength / 8));
    const start =
      (this.tailWritePosition - this.tailLength + this.tailCapacity) %
      this.tailCapacity;
    for (let index = 0; index < this.tailLength; index += 1) {
      const ringIndex = (start + index) % this.tailCapacity;
      bytes[index] = this.storage.tailBytes[ringIndex];
      setBit(stderrBits, index, getBit(this.storage.tailStderrBits, ringIndex));
    }
    this.cachedTail = { bytes, stderrBits };
    return this.cachedTail;
  }

  private decodeCombined(
    head: TaggedBytes,
    tail: TaggedBytes,
    truncated: boolean,
  ): { headText: string; tailText: string } {
    if (!truncated) {
      const bytes = Buffer.allocUnsafe(head.bytes.length + tail.bytes.length);
      const stderrBits = new Uint8Array(Math.ceil(bytes.length / 8));
      head.bytes.copy(bytes, 0);
      tail.bytes.copy(bytes, head.bytes.length);
      for (let index = 0; index < head.bytes.length; index += 1) {
        setBit(stderrBits, index, getBit(head.stderrBits, index));
      }
      for (let index = 0; index < tail.bytes.length; index += 1) {
        setBit(
          stderrBits,
          head.bytes.length + index,
          getBit(tail.stderrBits, index),
        );
      }
      return {
        headText: decodeTagged({ bytes, stderrBits }, this.encoding, {
          flush: true,
        }),
        tailText: '',
      };
    }

    const stdoutTail = extractSource(tail, 'stdout');
    const stderrTail = extractSource(tail, 'stderr');
    return {
      headText: decodeTagged(head, this.encoding, { flush: false }),
      tailText: decodeTagged(tail, this.encoding, {
        flush: true,
        stdoutSkip:
          stdoutTail.length -
          trimLeadingBoundary(stdoutTail, this.encoding).length,
        stderrSkip:
          stderrTail.length -
          trimLeadingBoundary(stderrTail, this.encoding).length,
      }),
    };
  }
}
