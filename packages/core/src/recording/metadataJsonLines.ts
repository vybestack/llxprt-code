/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

import { createReadStream } from 'node:fs';
import { MetadataJsonProjection } from './metadataJsonProjection.js';

export interface MetadataJsonLine {
  readonly lineNumber: number;
  readonly parsed: unknown;
  readonly byteEnd: number;
  readonly complete: boolean;
  readonly blank: boolean;
}

class LineProjection {
  private parser = new MetadataJsonProjection();
  private invalid = false;

  push(fragment: string): void {
    if (this.invalid) return;
    try {
      this.parser.push(fragment);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      this.invalid = true;
    }
  }

  finish(): unknown {
    if (this.invalid) return null;
    try {
      return this.parser.finish();
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return null;
    }
  }
}

class MetadataLineDecoder {
  private projection = new LineProjection();
  private lineNumber = 1;
  private hasTail = false;
  private firstChunk = true;
  private byteEnd = 0;
  private blank = true;

  *push(chunk: string): Iterable<MetadataJsonLine> {
    const text =
      this.firstChunk && chunk.startsWith('\uFEFF') ? chunk.slice(1) : chunk;
    if (this.firstChunk && chunk.startsWith('\uFEFF')) this.byteEnd = 3;
    this.firstChunk = false;
    let start = 0;
    for (;;) {
      const end = text.indexOf('\n', start);
      if (end === -1) break;
      const fragment = text.slice(start, end);
      this.projection.push(fragment);
      this.blank = this.blank && fragment.trim() === '';
      this.byteEnd += Buffer.byteLength(fragment) + 1;
      yield {
        lineNumber: this.lineNumber,
        parsed: this.projection.finish(),
        byteEnd: this.byteEnd,
        complete: true,
        blank: this.blank,
      };
      this.blank = true;
      this.lineNumber += 1;
      this.projection = new LineProjection();
      this.hasTail = false;
      start = end + 1;
    }
    if (start < text.length) {
      const fragment = text.slice(start);
      this.projection.push(fragment);
      this.byteEnd += Buffer.byteLength(fragment);
      this.blank = this.blank && fragment.trim() === '';
      this.hasTail = true;
    }
  }

  *finish(): Iterable<MetadataJsonLine> {
    if (this.hasTail) {
      yield {
        lineNumber: this.lineNumber,
        parsed: this.projection.finish(),
        byteEnd: this.byteEnd,
        complete: false,
        blank: this.blank,
      };
    }
  }
}

export async function* readMetadataJsonLines(
  filePath: string,
  maxBytes?: number,
): AsyncIterable<MetadataJsonLine> {
  if (maxBytes === 0) return;
  const stream = createReadStream(filePath, {
    encoding: 'utf8',
    ...(maxBytes === undefined ? {} : { end: maxBytes - 1 }),
    highWaterMark: 64 * 1024,
  });
  const decoder = new MetadataLineDecoder();
  try {
    for await (const chunk of stream) {
      if (typeof chunk !== 'string')
        throw new TypeError('Expected UTF-8 journal chunk');
      yield* decoder.push(chunk);
    }
    yield* decoder.finish();
  } finally {
    stream.destroy();
  }
}
