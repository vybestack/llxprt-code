/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readSync, writeSync } from 'node:fs';

/**
 * Positioned I/O on one scratch file that gathers contiguous appends into a
 * single bounded buffer. A read first flushes the buffer, so it always sees
 * every earlier write, and a write that does not continue the buffered tail
 * flushes it first, so writes reach the file in the order they were made.
 * Nothing is durable until `flush`; the files are request-local scratch.
 */
export class TailBufferedFile {
  #buffer: Buffer | undefined;
  #base = 0;
  #length = 0;

  constructor(
    private readonly fd: number,
    private readonly capacity: number,
    private readonly stalled: string,
  ) {}

  write(bytes: Buffer, offset: number): void {
    if (bytes.length === 0) return;
    const continues = offset === this.#base + this.#length;
    if (
      this.#length > 0 &&
      (!continues || this.#length + bytes.length > this.capacity)
    )
      this.flush();
    if (bytes.length > this.capacity) {
      this.transfer(bytes, offset, true);
      return;
    }
    this.#buffer ??= Buffer.allocUnsafe(this.capacity);
    if (this.#length === 0) this.#base = offset;
    bytes.copy(this.#buffer, this.#length);
    this.#length += bytes.length;
  }

  read(bytes: Buffer, offset: number): void {
    this.flush();
    this.transfer(bytes, offset, false);
  }

  /** The buffered bytes stay pending when the write fails, so later reads fail too. */
  flush(): void {
    if (this.#length === 0 || this.#buffer === undefined) return;
    this.transfer(this.#buffer.subarray(0, this.#length), this.#base, true);
    this.#length = 0;
  }

  /** Flushes and returns the buffer's memory; a later write allocates again. */
  release(): void {
    this.flush();
    this.#buffer = undefined;
  }

  private transfer(bytes: Buffer, offset: number, write: boolean): void {
    let transferred = 0;
    while (transferred < bytes.length) {
      const count = write
        ? writeSync(
            this.fd,
            bytes,
            transferred,
            bytes.length - transferred,
            offset + transferred,
          )
        : readSync(
            this.fd,
            bytes,
            transferred,
            bytes.length - transferred,
            offset + transferred,
          );
      if (count === 0) throw new Error(this.stalled);
      transferred += count;
    }
  }
}
