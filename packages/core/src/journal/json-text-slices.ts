/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';

/** Extracts one top-level JSON string without retaining its encoded body. */
class StringFieldSlices {
  private depth = 0;
  private inString = false;
  private keyExpected = false;
  private key = '';
  private readingKey = false;
  private selected = false;
  private escape = '';
  private output = '';
  private found = false;
  constructor(
    private readonly field: string,
    private readonly limit: number,
  ) {}

  private character(char: string): string | undefined {
    if (this.escape !== '') {
      this.escape += char;
      if (
        this.escape === '\\u' ||
        (this.escape.startsWith('\\u') && this.escape.length < 6)
      )
        return undefined;
      const decoded: unknown = JSON.parse(`"${this.escape}"`);
      this.escape = '';
      if (typeof decoded !== 'string')
        throw new JournalFormatError('Invalid string escape');
      return decoded;
    }
    if (char === '\\') {
      this.escape = char;
      return undefined;
    }
    if (char < ' ')
      throw new JournalFormatError('Unescaped string control character');
    return char;
  }

  private structure(char: string): void {
    if (char === '{' || char === '[') {
      this.depth++;
      if (this.depth === 1) this.keyExpected = true;
    } else if (char === '}' || char === ']') this.depth--;
    else if (char === ',' && this.depth === 1) this.keyExpected = true;
    else if (char === '"') {
      this.inString = true;
      this.readingKey = this.depth === 1 && this.keyExpected;
      this.selected =
        !this.readingKey && this.depth === 1 && this.key === this.field;
      if (this.readingKey) this.key = '';
      if (this.selected) this.found = true;
    }
  }

  private takeOutput(): string {
    const output = this.output;
    this.output = '';
    return output;
  }

  private consume(char: string): string | undefined {
    if (!this.inString) {
      this.structure(char);
      return undefined;
    }
    if (char === '"' && this.escape === '') {
      this.inString = false;
      if (this.readingKey) this.keyExpected = false;
      const output = this.selected ? this.takeOutput() : undefined;
      this.selected = false;
      return output;
    }
    const decoded = this.character(char);
    if (decoded === undefined) return undefined;
    if (this.readingKey && this.key.length < 128) this.key += decoded;
    else if (this.selected) this.output += decoded;
    if (
      this.output.length >= this.limit &&
      !/[\ud800-\udbff]$/.test(this.output)
    )
      return this.takeOutput();
    return undefined;
  }

  *feed(text: string): Generator<string> {
    for (const char of text) {
      const output = this.consume(char);
      if (output !== undefined && output !== '') yield output;
    }
  }

  finish(): void {
    if (this.inString || this.escape !== '' || this.depth !== 0 || !this.found)
      throw new JournalFormatError('Incomplete journal string field');
  }
}

export async function* jsonTextSlices(
  parts: AsyncIterable<Uint8Array>,
  field: string,
  limit: number,
): AsyncGenerator<string> {
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new RangeError('Text slice size must be at least two');
  const strings = new StringFieldSlices(field, limit);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  for await (const part of parts)
    yield* strings.feed(decoder.decode(part, { stream: true }));
  yield* strings.feed(decoder.decode());
  strings.finish();
}
