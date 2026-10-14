/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { closeSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { TailBufferedFile } from './tailBufferedFile.js';

/** Each record is a uint32 payload length followed by the UTF-8 payload. */
const HEADER_BYTES = 4;
/** One float64 file offset per record, addressed by record number. */
const ENTRY_BYTES = 8;
const PAYLOAD_BUFFER_BYTES = 64 * 1024;
const ENTRY_BUFFER_BYTES = 4 * 1024;
/** A read refills this many bytes at once; later records inside it cost no system call. */
const WINDOW_BYTES = 32 * 1024;

/**
 * Append-only log of the rows of one normalization stage, addressed by
 * position. Rows are written once and read back in the order they were written
 * or by position, so neither direction needs a keyed lookup: appends gather
 * into one buffered tail and a sequential read is served from a read window
 * that one system call refills for many rows.
 */
export class StageRowLog {
  readonly #payloadFd: number;
  readonly #entryFd: number;
  readonly #payload: TailBufferedFile;
  readonly #entries: TailBufferedFile;
  readonly #entry = Buffer.alloc(ENTRY_BYTES);
  #end = 0;
  #count = 0;
  #window: Buffer | undefined;
  #windowStart = 0;
  #windowLength = 0;
  /** Where the record after the last one read starts, so a sequential read needs no entry lookup. */
  #cursorIndex = 0;
  #cursorOffset = 0;
  #recordBytes = 0;
  #closed = false;

  constructor(directory: string, name: string) {
    this.#payloadFd = openSync(join(directory, `${name}.rows`), 'wx+', 0o600);
    try {
      this.#entryFd = openSync(
        join(directory, `${name}.offsets`),
        'wx+',
        0o600,
      );
    } catch (error) {
      closeSync(this.#payloadFd);
      throw error;
    }
    const stalled = `Stage row log ${name} made no I/O progress`;
    this.#payload = new TailBufferedFile(
      this.#payloadFd,
      PAYLOAD_BUFFER_BYTES,
      stalled,
    );
    this.#entries = new TailBufferedFile(
      this.#entryFd,
      ENTRY_BUFFER_BYTES,
      stalled,
    );
  }

  get length(): number {
    return this.#count;
  }

  append(text: string): number {
    this.check();
    const bytes = Buffer.byteLength(text, 'utf8');
    const record = Buffer.allocUnsafe(HEADER_BYTES + bytes);
    record.writeUInt32LE(bytes, 0);
    record.write(text, HEADER_BYTES, 'utf8');
    this.#payload.write(record, this.#end);
    this.#entry.writeDoubleLE(this.#end, 0);
    this.#entries.write(this.#entry, this.#count * ENTRY_BYTES);
    this.#end += record.length;
    return this.#count++;
  }

  has(index: number): boolean {
    return Number.isInteger(index) && index >= 0 && index < this.#count;
  }

  read(index: number): string {
    this.check();
    if (!this.has(index))
      throw new RangeError('Stage row log index is out of range');
    const offset =
      index === this.#cursorIndex ? this.#cursorOffset : this.offsetOf(index);
    const text = this.textAt(offset);
    this.#cursorIndex = index + 1;
    this.#cursorOffset = offset + HEADER_BYTES + this.#recordBytes;
    return text;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#window = undefined;
    try {
      closeSync(this.#payloadFd);
    } finally {
      closeSync(this.#entryFd);
    }
  }

  private check(): void {
    if (this.#closed) throw new Error('Stage row log is closed');
  }

  private offsetOf(index: number): number {
    this.#entries.read(this.#entry, index * ENTRY_BYTES);
    return this.#entry.readDoubleLE(0);
  }

  /** Decodes the record at `offset`, refilling the read window only when it does not hold the whole record. */
  private textAt(offset: number): string {
    if (!this.windowHolds(offset, HEADER_BYTES))
      this.fill(offset, WINDOW_BYTES);
    let window = this.#window as Buffer;
    let at = offset - this.#windowStart;
    const bytes = window.readUInt32LE(at);
    this.#recordBytes = bytes;
    if (at + HEADER_BYTES + bytes > this.#windowLength) {
      if (bytes + HEADER_BYTES > WINDOW_BYTES)
        return this.readLarge(offset, bytes);
      this.fill(offset, WINDOW_BYTES);
      window = this.#window as Buffer;
      at = 0;
    }
    return window.toString(
      'utf8',
      at + HEADER_BYTES,
      at + HEADER_BYTES + bytes,
    );
  }

  private windowHolds(offset: number, bytes: number): boolean {
    return (
      this.#window !== undefined &&
      offset >= this.#windowStart &&
      offset + bytes <= this.#windowStart + this.#windowLength
    );
  }

  private fill(offset: number, size: number): void {
    this.#window ??= Buffer.allocUnsafe(WINDOW_BYTES);
    const length = Math.min(size, this.#end - offset);
    this.#windowLength = 0;
    this.#payload.read(this.#window.subarray(0, length), offset);
    this.#windowStart = offset;
    this.#windowLength = length;
  }

  /** A record larger than the window is decoded from a one-off buffer that is not retained. */
  private readLarge(offset: number, bytes: number): string {
    const record = Buffer.allocUnsafe(bytes);
    this.#payload.read(record, offset + HEADER_BYTES);
    return record.toString('utf8');
  }
}
