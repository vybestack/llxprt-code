/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const HARD_MAX_LINE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_LINE_BYTES = 1024 * 1024;

export interface BoundedLineFramerOptions {
  maxLineBytes?: number;
}

function validateMaxLineBytes(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > HARD_MAX_LINE_BYTES
  ) {
    throw new RangeError(
      `maxLineBytes must be a finite positive safe integer <= ${HARD_MAX_LINE_BYTES}, got: ${String(value)}`,
    );
  }
}

function decodeFatal(bytes: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return decoder.decode(bytes);
}

export class BoundedLineFramer {
  private readonly buffer: Uint8Array;
  private readonly maxLineBytes: number;
  private length = 0;
  private discarding = false;
  private droppedLine = false;

  constructor(options?: BoundedLineFramerOptions) {
    const max = options?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
    validateMaxLineBytes(max);
    this.maxLineBytes = max;
    this.buffer = new Uint8Array(this.maxLineBytes + 1);
  }

  get wasLineDropped(): boolean {
    return this.droppedLine;
  }

  reset(): void {
    this.length = 0;
    this.discarding = false;
    this.droppedLine = false;
  }

  feedChunk(chunk: Buffer, onLine: (line: string) => void): void {
    let i = 0;
    while (i < chunk.length) {
      if (this.discarding) {
        const nl = chunk.indexOf(0x0a, i);
        if (nl === -1) return;
        this.discarding = false;
        this.length = 0;
        i = nl + 1;
        continue;
      }

      const nl = chunk.indexOf(0x0a, i);
      const space = Math.max(0, this.maxLineBytes - this.length);

      if (nl === -1) {
        const segmentLen = chunk.length - i;
        if (segmentLen <= space) {
          chunk.copy(this.buffer, this.length, i);
          this.length += segmentLen;
        } else if (
          this.length <= this.maxLineBytes &&
          segmentLen === space + 1 &&
          chunk[i + space] === 0x0d
        ) {
          chunk.copy(this.buffer, this.length, i, i + space);
          this.buffer[this.maxLineBytes] = 0x0d;
          this.length = this.maxLineBytes + 1;
        } else {
          this.discarding = true;
          this.droppedLine = true;
        }
        return;
      }

      const segmentLen = nl - i;
      if (segmentLen === 0 || segmentLen <= space) {
        if (segmentLen > 0) {
          chunk.copy(this.buffer, this.length, i, nl);
          this.length += segmentLen;
        }
        this.stripTrailingCr();
        this.terminate(onLine);
      } else if (
        this.length <= this.maxLineBytes &&
        segmentLen === space + 1 &&
        chunk[i + space] === 0x0d
      ) {
        chunk.copy(this.buffer, this.length, i, i + space);
        this.buffer[this.maxLineBytes] = 0x0d;
        this.length = this.maxLineBytes + 1;
        this.stripTrailingCr();
        this.terminate(onLine);
      } else {
        this.droppedLine = true;
        this.length = 0;
      }
      i = nl + 1;
    }
  }

  private stripTrailingCr(): void {
    if (
      this.length > 0 &&
      !this.discarding &&
      this.buffer[this.length - 1] === 0x0d
    ) {
      this.length--;
    }
  }

  flushRemaining(onLine: (line: string) => void): void {
    if (this.discarding) {
      this.discarding = false;
      this.length = 0;
      return;
    }
    if (this.length > 0) {
      this.terminate(onLine);
    }
  }

  private terminate(onLine: (line: string) => void): void {
    if (this.discarding) {
      this.discarding = false;
      this.length = 0;
      return;
    }

    if (this.length === 0) {
      onLine('');
      return;
    }

    const recordBytes = Buffer.from(this.buffer.subarray(0, this.length));
    this.length = 0;

    let line: string;
    try {
      line = decodeFatal(recordBytes);
    } catch {
      this.droppedLine = true;
      return;
    }
    onLine(line);
  }
}
