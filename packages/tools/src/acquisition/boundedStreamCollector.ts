/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { TextDecoder } from 'node:util';
import type {
  AcquisitionResult,
  ByteBudget,
  TruncationMetadata,
} from './types.js';
import {
  skipIncompleteLeadingUtf8,
  trimIncompleteTrailingUtf8,
} from './utf8Boundaries.js';

export interface BoundedStreamCollectorOptions {
  budget: ByteBudget;
  encoding?: string;
  headFraction?: number;
}

export const DEFAULT_OMISSION_NOTICE = 'LLXPRT output truncated';

function copySlice(source: Buffer, start: number, end: number): Buffer {
  const copy = Buffer.allocUnsafe(end - start);
  source.copy(copy, 0, start, end);
  return copy;
}

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
  if (normalized === 'binary') {
    return 'latin1';
  }
  return normalized;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

function safeUtf16Head(buffer: Buffer): Buffer {
  let length = buffer.length - (buffer.length % 2);
  if (length >= 2 && isHighSurrogate(buffer.readUInt16LE(length - 2))) {
    length -= 2;
  }
  return length === buffer.length ? buffer : copySlice(buffer, 0, length);
}

function safeUtf16Tail(buffer: Buffer, streamOffset: number): Buffer {
  let start = streamOffset % 2 === 0 ? 0 : 1;
  if (
    buffer.length - start >= 2 &&
    isLowSurrogate(buffer.readUInt16LE(start))
  ) {
    start += 2;
  }
  const end = buffer.length - ((buffer.length - start) % 2);
  return start === 0 && end === buffer.length
    ? buffer
    : copySlice(buffer, start, end);
}

function safeRetainedBoundaries(
  head: Buffer,
  tail: Buffer,
  tailStreamOffset: number,
  encoding: string,
): { head: Buffer; tail: Buffer } {
  const normalized = normalizedEncoding(encoding);
  if (normalized === 'utf-8') {
    return {
      head: trimIncompleteTrailingUtf8(head),
      tail: skipIncompleteLeadingUtf8(tail),
    };
  }
  if (normalized === 'utf-16le') {
    return {
      head: safeUtf16Head(head),
      tail: safeUtf16Tail(tail, tailStreamOffset),
    };
  }
  return { head, tail };
}

function decode(buffer: Buffer, encoding: string): string {
  try {
    return new TextDecoder(normalizedEncoding(encoding)).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
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

/** Retains a fixed-size byte head and tail without retaining input buffers. */
export class BoundedStreamCollector {
  private readonly budget: ByteBudget;
  private readonly encoding: string;
  private readonly headCapacity: number;
  private readonly tailCapacity: number;
  private readonly head: Buffer;
  private readonly tail: Buffer;
  private headLength = 0;
  private tailLength = 0;
  private tailStart = 0;
  private observedBytes = 0;

  constructor(options: BoundedStreamCollectorOptions) {
    this.budget = options.budget;
    this.encoding = normalizedEncoding(options.encoding ?? 'utf8');
    const fraction = Math.min(Math.max(options.headFraction ?? 0.5, 0), 1);
    this.headCapacity = Math.floor(this.budget.bytes * fraction);
    this.tailCapacity = this.budget.bytes - this.headCapacity;
    this.head = Buffer.allocUnsafe(this.headCapacity);
    this.tail = Buffer.allocUnsafe(this.tailCapacity);
  }

  get observedByteCount(): number {
    return this.observedBytes;
  }

  get isTruncated(): boolean {
    return this.observedBytes > this.budget.bytes;
  }

  append(chunk: Buffer | string): void {
    const bytes = Buffer.isBuffer(chunk) ? chunk : encode(chunk, this.encoding);
    if (bytes.length === 0) {
      return;
    }

    this.observedBytes += bytes.length;
    let offset = 0;
    if (this.headLength < this.headCapacity) {
      const copied = Math.min(
        bytes.length,
        this.headCapacity - this.headLength,
      );
      bytes.copy(this.head, this.headLength, 0, copied);
      this.headLength += copied;
      offset = copied;
    }
    this.appendTail(bytes, offset);
  }

  flushDecoder(): void {
    // Decoding is deferred until bounded retained bytes are requested.
  }

  getHeadText(): string {
    return this.getResult().headText;
  }

  getTailText(): string {
    return this.getResult().tailText;
  }

  private appendTail(bytes: Buffer, offset: number): void {
    if (this.tailCapacity === 0 || offset >= bytes.length) {
      return;
    }
    const remaining = bytes.length - offset;
    if (remaining >= this.tailCapacity) {
      bytes.copy(this.tail, 0, bytes.length - this.tailCapacity);
      this.tailLength = this.tailCapacity;
      this.tailStart = 0;
      return;
    }
    const writeStart = (this.tailStart + this.tailLength) % this.tailCapacity;
    const firstLength = Math.min(remaining, this.tailCapacity - writeStart);
    bytes.copy(this.tail, writeStart, offset, offset + firstLength);
    if (firstLength < remaining) {
      bytes.copy(this.tail, 0, offset + firstLength, bytes.length);
    }
    const overwritten = Math.max(
      0,
      this.tailLength + remaining - this.tailCapacity,
    );
    this.tailStart = (this.tailStart + overwritten) % this.tailCapacity;
    this.tailLength = Math.min(this.tailCapacity, this.tailLength + remaining);
  }

  private copiedHead(): Buffer {
    return copySlice(this.head, 0, this.headLength);
  }

  private copiedTail(): Buffer {
    if (this.tailLength === 0) {
      return Buffer.alloc(0);
    }
    const result = Buffer.allocUnsafe(this.tailLength);
    const firstLength = Math.min(
      this.tailLength,
      this.tailCapacity - this.tailStart,
    );
    this.tail.copy(result, 0, this.tailStart, this.tailStart + firstLength);
    if (firstLength < this.tailLength) {
      this.tail.copy(result, firstLength, 0, this.tailLength - firstLength);
    }
    return result;
  }

  getResult(): AcquisitionResult {
    let head = this.copiedHead();
    let tail = this.copiedTail();
    const initiallyRetained = head.length + tail.length;
    if (this.observedBytes > initiallyRetained) {
      const safe = safeRetainedBoundaries(
        head,
        tail,
        this.observedBytes - tail.length,
        this.encoding,
      );
      head = safe.head;
      tail = safe.tail;
    }

    const retainedBytes = head.length + tail.length;
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
    const completeText = truncated
      ? null
      : decode(Buffer.concat([head, tail], retainedBytes), this.encoding);
    const headText = completeText ?? decode(head, this.encoding);
    const tailText = completeText === null ? decode(tail, this.encoding) : '';

    return {
      text:
        headText +
        (omissionNotice === null ? '' : `\n\n${omissionNotice}\n\n`) +
        tailText,
      headText,
      tailText,
      metadata,
      omissionNotice,
    };
  }
}
