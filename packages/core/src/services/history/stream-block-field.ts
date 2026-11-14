/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DirectoryBlock } from '../../journal/row-directory.js';

class FieldProjection {
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private key = '';
  private property = '';
  private readingKey = false;
  private keyOverflow = false;
  private expectingKey = false;
  private awaitingValue = false;
  private selected = false;
  private stringValue = false;
  private escape = '';
  private output = '';
  present = false;
  constructor(
    private readonly field: string,
    private readonly raw: boolean,
  ) {}
  push(text: string): string {
    this.output = '';
    for (const value of text) this.accept(value);
    return this.output;
  }
  private accept(value: string): void {
    if (this.quoted) {
      this.string(value);
      return;
    }
    if (this.awaitingValue && !/\s/u.test(value)) {
      this.awaitingValue = false;
      this.selected = this.property === this.field;
      if (this.selected) this.present = true;
      this.stringValue = value === '"';
    }
    const delimiter = this.depth === 1 && ',}'.includes(value);
    if (this.selected && (this.raw || !this.stringValue) && !delimiter)
      this.output += value;
    if (value === '"') {
      this.quoted = true;
      this.escaped = false;
      this.readingKey = this.depth === 1 && this.expectingKey;
      if (this.readingKey) {
        this.key = '"';
        this.keyOverflow = false;
      }
    } else if ('{['.includes(value)) {
      if (this.depth === 0) this.expectingKey = true;
      this.depth++;
    } else if ('}]'.includes(value)) this.depth--;
    else if (value === ':' && this.depth === 1) {
      this.awaitingValue = true;
      this.expectingKey = false;
    } else if (value === ',' && this.depth === 1) {
      this.selected = false;
      this.stringValue = false;
      this.expectingKey = true;
    }
  }
  private string(value: string): void {
    if (this.readingKey) {
      if (this.key.length <= this.field.length * 6 + 2) this.key += value;
      else this.keyOverflow = true;
    }
    if (this.selected) {
      if (this.raw || !this.stringValue) this.output += value;
      else this.decoded(value);
    }
    if (this.escaped) this.escaped = false;
    else if (value === '\\') this.escaped = true;
    else if (value === '"') {
      this.quoted = false;
      if (this.readingKey) {
        const key: unknown = this.keyOverflow ? '' : JSON.parse(this.key);
        this.property = typeof key === 'string' ? key : '';
      }
      this.readingKey = false;
    }
  }
  private decoded(value: string): void {
    if (this.escape.length > 0) {
      this.escape += value;
      if (
        (this.escape[1] !== 'u' && this.escape.length === 2) ||
        this.escape.length === 6
      ) {
        const decoded: unknown = JSON.parse(`"${this.escape}"`);
        if (typeof decoded !== 'string')
          throw new SyntaxError('Invalid string escape');
        this.output += decoded;
        this.escape = '';
      }
    } else if (value === '\\') this.escape = value;
    else if (value !== '"') this.output += value;
  }
}

export async function* streamBlockField(
  block: DirectoryBlock,
  field: string,
  raw = false,
): AsyncGenerator<Uint8Array> {
  const projection = new FieldProjection(field, raw);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let high = '';
  let announced = false;
  for await (const part of block.parts()) {
    const output =
      high + projection.push(decoder.decode(part, { stream: true }));
    if (projection.present && !announced) {
      announced = true;
      yield Buffer.alloc(0);
    }
    high = /[\ud800-\udbff]$/u.test(output) ? output.slice(-1) : '';
    const text = high.length === 0 ? output : output.slice(0, -1);
    const bytes = Buffer.from(text);
    for (let offset = 0; offset < bytes.length; offset += 65536)
      yield bytes.subarray(offset, offset + 65536);
  }
  const tail = high + projection.push(decoder.decode());
  if (tail.length > 0) yield Buffer.from(tail);
}
