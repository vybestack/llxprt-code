/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { StringDecoder } from 'node:string_decoder';
import type { ResolverFileHandle } from './journalResolver.js';
import type { ResolverDiskIndex } from './resolverDiskIndex.js';
import type { DurableDensityIndex } from './durableDensityIndex.js';
import { ResolverProjection } from './resolverProjection.js';
import { MAX_RECORD_BYTES } from './journalCursor.js';

export interface ProjectedLine {
  readonly parsed: unknown;
  readonly projection: ResolverProjection;
  readonly offset: number;
  readonly length: number;
  readonly lineNumber: number;
  readonly invalid: boolean;
  readonly blank: boolean;
}

export class ProjectedLineReader {
  private decoder = new StringDecoder('utf8');
  private projection: ResolverProjection;
  private offset: number;
  private length = 0;
  private lineNumber = 1;
  private invalid = false;
  private blank = true;
  private firstText = true;
  constructor(
    private readonly staged: ResolverDiskIndex,
    private readonly metadata: boolean,
    private readonly density?: DurableDensityIndex,
    startBytes = 0,
  ) {
    this.offset = startBytes;
    this.projection = new ResolverProjection(
      staged,
      startBytes,
      metadata,
      density,
    );
  }

  *push(buffer: Buffer): Iterable<ProjectedLine> {
    let start = 0;
    for (;;) {
      const newline = buffer.indexOf(10, start);
      const end = newline === -1 ? buffer.length : newline + 1;
      let text = this.decoder.write(buffer.subarray(start, end));
      if (this.firstText && text.length > 0) {
        this.firstText = false;
        if (text.startsWith('\uFEFF')) {
          text = text.slice(1);
          this.projection = new ResolverProjection(
            this.staged,
            3,
            this.metadata,
            this.density,
          );
        }
      }
      this.length += end - start;
      if (text.trim() !== '') this.blank = false;
      this.accept(text);
      if (newline === -1) return;
      yield this.finish();
      this.offset += this.length;
      this.length = 0;
      this.lineNumber += 1;
      this.invalid = false;
      this.blank = true;
      this.staged.truncate(0);
      this.projection = new ResolverProjection(
        this.staged,
        this.offset,
        this.metadata,
        this.density,
      );
      this.decoder = new StringDecoder('utf8');
      start = end;
      if (start === buffer.length) return;
    }
  }

  *finishTail(): Iterable<ProjectedLine> {
    if (this.length > 0) {
      this.accept(this.decoder.end());
      yield this.finish();
    }
  }

  private accept(text: string): void {
    if (this.invalid) return;
    try {
      this.projection.parser.push(text);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      this.invalid = true;
    }
  }

  private finish(): ProjectedLine {
    let parsed: unknown = null;
    if (!this.invalid && !this.blank) {
      try {
        parsed = this.projection.parser.finish();
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        this.invalid = true;
      }
    }
    return {
      parsed,
      projection: this.projection,
      offset: this.offset,
      length: this.length,
      lineNumber: this.lineNumber,
      invalid: this.invalid,
      blank: this.blank,
    };
  }
}

export async function* scanResolverLines(
  handle: ResolverFileHandle,
  chunkBytes: number,
  staged: ResolverDiskIndex,
  maxBytes = Infinity,
  metadata = false,
  density?: DurableDensityIndex,
  startBytes = 0,
  signal?: AbortSignal,
): AsyncIterable<ProjectedLine> {
  const reader = new ProjectedLineReader(staged, metadata, density, startBytes);
  const buffer = Buffer.alloc(Math.min(chunkBytes, 64 * 1024));
  let position = startBytes;
  while (position < maxBytes) {
    signal?.throwIfAborted();
    const bytesRead = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, maxBytes - position),
      position,
    );
    signal?.throwIfAborted();
    if (bytesRead === 0) break;
    position += bytesRead;
    yield* reader.push(buffer.subarray(0, bytesRead));
  }
  signal?.throwIfAborted();
  yield* reader.finishTail();
}

export class ResolverRowReader {
  private buffer = Buffer.alloc(0);
  private offset = -1;
  constructor(
    private readonly handle: ResolverFileHandle,
    private readonly chunkBytes: number,
    private readonly maxBytes = Infinity,
  ) {}
  async read(start: number, length: number): Promise<unknown> {
    if (length > MAX_RECORD_BYTES)
      throw new RangeError('Resolver content row exceeds record bound');
    const decoder = new StringDecoder('utf8');
    let text = '';
    let pos = start;
    while (pos < start + length) {
      if (pos < this.offset || pos >= this.offset + this.buffer.length) {
        this.offset = pos;
        const buffer = Buffer.alloc(Math.min(this.chunkBytes, 64 * 1024));
        const bytesRead = await this.handle.read(
          buffer,
          0,
          Math.min(buffer.length, this.maxBytes - pos),
          pos,
        );
        if (bytesRead === 0) throw new Error('Resolver source truncated');
        this.buffer = buffer.subarray(0, bytesRead);
      }
      const end = Math.min(start + length, this.offset + this.buffer.length);
      text += decoder.write(
        this.buffer.subarray(pos - this.offset, end - this.offset),
      );
      pos = end;
    }
    return JSON.parse(text + decoder.end());
  }
}
