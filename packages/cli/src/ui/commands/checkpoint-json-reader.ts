/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { FileHandle } from 'node:fs/promises';

class JsonFrame {
  private depth = 0;
  private string = false;
  private escaped = false;
  private initial = true;
  constructor(private readonly first: number) {}
  isPrimitiveDelimiter(byte: number): boolean {
    return (
      ![34, 91, 123].includes(this.first) &&
      [32, 9, 10, 13, 44, 93, 125].includes(byte)
    );
  }
  accept(byte: number): boolean {
    if (this.string) this.acceptString(byte);
    else if (byte === 34) this.string = true;
    else if (byte === 123 || byte === 91) this.depth++;
    else if (byte === 125 || byte === 93) this.depth--;
    const quotedEnd = this.first === 34 && !this.string;
    const compoundEnd = [91, 123].includes(this.first) && this.depth === 0;
    const done = !this.initial && (quotedEnd || compoundEnd);
    this.initial = false;
    return done;
  }
  private acceptString(byte: number): void {
    if (this.escaped) this.escaped = false;
    else if (byte === 92) this.escaped = true;
    else if (byte === 34) this.string = false;
  }
}

/** Frames one JSON value in UTF-8 bytes. JSON.parse validates only that value,
 * never the checkpoint or clientHistory array. Delimiters are ASCII, so a split
 * UTF-8 sequence or escaped quote cannot change the framing state. */
export class CheckpointJsonReader {
  private buffer = Buffer.alloc(0);
  private index = 0;
  position: number;
  constructor(
    private readonly file: FileHandle,
    start = 0,
    private readonly signal?: AbortSignal,
    private readonly chunkBytes = 16384,
  ) {
    this.position = start;
  }

  private async fill(): Promise<boolean> {
    this.signal?.throwIfAborted();
    if (this.index < this.buffer.length) return true;
    const buffer = Buffer.alloc(this.chunkBytes);
    const result = await this.file.read(
      buffer,
      0,
      buffer.length,
      this.position,
    );
    this.buffer = buffer.subarray(0, result.bytesRead);
    this.index = 0;
    return result.bytesRead !== 0;
  }

  private advance(): number {
    this.position++;
    return this.buffer[this.index++];
  }

  async peek(): Promise<number | undefined> {
    while (await this.fill()) {
      const byte = this.buffer[this.index];
      if (byte !== 32 && byte !== 9 && byte !== 10 && byte !== 13) return byte;
      this.advance();
    }
    return undefined;
  }

  async expect(byte: number): Promise<void> {
    if ((await this.peek()) !== byte)
      throw new SyntaxError(
        `Expected checkpoint JSON delimiter at byte ${this.position}`,
      );
    this.advance();
  }

  async value(): Promise<unknown> {
    const first = await this.peek();
    if (first === undefined) throw new SyntaxError('Truncated checkpoint JSON');
    const parts: Buffer[] = [];
    const frame = new JsonFrame(first);
    while (await this.fill()) {
      const start = this.index;
      while (this.index < this.buffer.length) {
        const byte = this.buffer[this.index];
        if (frame.isPrimitiveDelimiter(byte)) {
          parts.push(this.buffer.subarray(start, this.index));
          return this.decode(parts);
        }
        this.advance();
        if (frame.accept(byte)) {
          parts.push(this.buffer.subarray(start, this.index));
          return this.decode(parts);
        }
      }
      parts.push(this.buffer.subarray(start));
    }
    return this.decode(parts);
  }

  private decode(parts: readonly Buffer[]): unknown {
    this.signal?.throwIfAborted();
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  }
}
