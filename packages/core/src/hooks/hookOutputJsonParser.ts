/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readSync, writeSync } from 'node:fs';

export interface JsonSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: string;
  readonly count: number;
  readonly indexOffset: number;
}

/** UTF-16 disk offsets preserve escaped lone surrogates in double-encoded JSON. */
export class JsonDiskCursor {
  position = 0;
  private readonly buffer = Buffer.alloc(65536);
  private base = -1;
  private length = 0;
  constructor(readonly fd: number) {}

  peek(): number {
    const offset = this.position * 2;
    if (offset < this.base || offset >= this.base + this.length) {
      this.base = offset;
      this.length = readSync(
        this.fd,
        this.buffer,
        0,
        this.buffer.length,
        offset,
      );
    }
    return offset >= this.base + this.length
      ? -1
      : this.buffer.readUInt16LE(offset - this.base);
  }

  take(): number {
    const value = this.peek();
    if (value !== -1) this.position++;
    return value;
  }

  whitespace(): void {
    while ([9, 10, 13, 32].includes(this.peek())) this.take();
  }

  margin(): void {
    while (
      this.peek() !== -1 &&
      String.fromCharCode(this.peek()).trim().length === 0
    )
      this.take();
  }

  expect(code: number): void {
    if (this.take() !== code) throw new SyntaxError('Invalid hook output JSON');
  }

  text(start: number, end: number): string {
    const bytes = Buffer.alloc((end - start) * 2);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(
        this.fd,
        bytes,
        offset,
        bytes.length - offset,
        start * 2 + offset,
      );
      if (count === 0)
        throw new Error('Unexpected end of hook output disk file');
      offset += count;
    }
    return bytes.toString('utf16le');
  }
}

const JSON_ESCAPES = new Map([
  [34, 34],
  [92, 92],
  [47, 47],
  [98, 8],
  [102, 12],
  [110, 10],
  [114, 13],
  [116, 9],
]);

function hexDigit(unit: number): number {
  if (unit >= 48 && unit <= 57) return unit - 48;
  if (unit >= 65 && unit <= 70) return unit - 55;
  if (unit >= 97 && unit <= 102) return unit - 87;
  throw new SyntaxError('Invalid hook output unicode escape');
}

function escapedUnit(cursor: JsonDiskCursor): number {
  const escape = cursor.take();
  if (escape !== 117) {
    const value = JSON_ESCAPES.get(escape);
    if (value === undefined)
      throw new SyntaxError('Invalid hook output escape');
    return value;
  }
  let value = 0;
  for (let index = 0; index < 4; index++)
    value = value * 16 + hexDigit(cursor.take());
  return value;
}

export function scanJsonString(
  cursor: JsonDiskCursor,
  emit?: (unit: number) => void,
): void {
  cursor.expect(34);
  while (cursor.peek() !== -1) {
    const unit = cursor.take();
    if (unit === 34) return;
    if (unit < 32) throw new SyntaxError('Invalid hook output string');
    const decoded = unit === 92 ? escapedUnit(cursor) : unit;
    emit?.(decoded);
  }
  throw new SyntaxError('Unterminated hook output string');
}

type Stage = 'first' | 'key' | 'colon' | 'value' | 'after';
interface Frame {
  readonly kind: 'object' | 'array';
  readonly start: number;
  readonly depth: number;
  readonly row: boolean;
  readonly indexOffset: number;
  count: number;
  matches: boolean;
  stage: Stage;
}

/** Validates every token, retaining only parser depth and one selected disk span. */
export class HookOutputJsonParser {
  private readonly cursor: JsonDiskCursor;
  private readonly stack: Frame[] = [];
  private selected: JsonSpan | undefined;
  private root: JsonSpan | undefined;
  private indexPosition = 0;

  constructor(
    fd: number,
    private readonly path: ReadonlyArray<string | number>,
    private readonly indexFd?: number,
    private readonly trimMargins = false,
  ) {
    this.cursor = new JsonDiskCursor(fd);
  }

  parse(): { root: JsonSpan; selected: JsonSpan | undefined } {
    if (this.trimMargins) this.cursor.margin();
    else this.cursor.whitespace();
    this.value(0, false);
    while (this.stack.length !== 0) this.step();
    if (this.trimMargins) this.cursor.margin();
    else this.cursor.whitespace();
    if (this.cursor.peek() !== -1 || this.root === undefined)
      throw new SyntaxError('Trailing or incomplete hook output JSON');
    return { root: this.root, selected: this.selected };
  }

  private step(): void {
    const frame = this.stack[this.stack.length - 1];
    this.cursor.whitespace();
    const end = frame.kind === 'object' ? 125 : 93;
    if (frame.stage === 'first' && this.cursor.peek() === end) {
      this.end(frame);
      return;
    }
    if (frame.stage === 'after') {
      if (this.cursor.peek() === end) {
        this.end(frame);
        return;
      }
      this.cursor.expect(44);
      frame.stage = frame.kind === 'object' ? 'key' : 'value';
      return;
    }
    if (
      frame.kind === 'object' &&
      (frame.stage === 'first' || frame.stage === 'key')
    ) {
      const start = this.cursor.position;
      scanJsonString(this.cursor);
      const key = frame.depth < 0 ? undefined : this.path[frame.depth];
      // A longer encoded key cannot equal this selector. It is still fully validated.
      frame.matches =
        typeof key === 'string' &&
        this.cursor.position - start <= key.length * 6 + 2 &&
        decodedKey(this.cursor, start) === key;
      frame.stage = 'colon';
      return;
    }
    if (frame.stage === 'colon') {
      this.cursor.expect(58);
      frame.stage = 'value';
      return;
    }
    const matches =
      frame.kind === 'array'
        ? frame.depth >= 0 && this.path[frame.depth] === frame.count
        : frame.matches;
    const row = frame.kind === 'array' && frame.depth === this.path.length;
    frame.stage = 'after';
    frame.count++;
    this.value(matches ? frame.depth + 1 : -1, row);
  }

  private value(depth: number, row: boolean): void {
    this.cursor.whitespace();
    const start = this.cursor.position;
    const code = this.cursor.peek();
    if (depth >= 0 && depth <= this.path.length) this.selected = undefined;
    if (code === 123 || code === 91) {
      this.cursor.take();
      this.stack.push({
        kind: code === 123 ? 'object' : 'array',
        start,
        depth,
        row,
        indexOffset: this.indexPosition,
        count: 0,
        matches: false,
        stage: 'first',
      });
      return;
    }
    let kind: string;
    if (code === 34) {
      scanJsonString(this.cursor);
      kind = 'string';
    } else if (code === 116 || code === 102 || code === 110) {
      const literal = jsonLiteral(code);
      for (const unit of literal) this.cursor.expect(unit.charCodeAt(0));
      kind = literal === 'null' ? 'null' : 'boolean';
    } else {
      this.number();
      kind = 'number';
    }
    this.finish(
      {
        start,
        end: this.cursor.position,
        kind,
        count: 0,
        indexOffset: this.indexPosition,
      },
      depth,
      row,
    );
  }

  private number(): void {
    if (this.cursor.peek() === 45) this.cursor.take();
    if (this.cursor.peek() === 48) this.cursor.take();
    else {
      if (this.cursor.peek() < 49 || this.cursor.peek() > 57)
        throw new SyntaxError('Invalid JSON number');
      this.digits();
    }
    if (this.cursor.peek() === 46) {
      this.cursor.take();
      this.digits(true);
    }
    if (this.cursor.peek() === 101 || this.cursor.peek() === 69) {
      this.cursor.take();
      if (this.cursor.peek() === 43 || this.cursor.peek() === 45)
        this.cursor.take();
      this.digits(true);
    }
  }

  private digits(required = false): void {
    const start = this.cursor.position;
    while (this.cursor.peek() >= 48 && this.cursor.peek() <= 57)
      this.cursor.take();
    if (required && start === this.cursor.position)
      throw new SyntaxError('Missing JSON digits');
  }

  private end(frame: Frame): void {
    this.cursor.take();
    this.stack.pop();
    this.finish(
      {
        start: frame.start,
        end: this.cursor.position,
        kind: frame.kind,
        count: frame.count,
        indexOffset: frame.indexOffset,
      },
      frame.depth,
      frame.row,
    );
  }

  private finish(span: JsonSpan, depth: number, row: boolean): void {
    if (depth === 0) this.root = span;
    if (depth === this.path.length) this.selected = span;
    if (row && this.indexFd !== undefined) {
      const pointer = Buffer.alloc(16);
      pointer.writeDoubleLE(span.start, 0);
      pointer.writeDoubleLE(span.end, 8);
      writeAll(this.indexFd, pointer, this.indexPosition);
      this.indexPosition += 16;
    }
  }
}

export function writeAll(
  fd: number,
  bytes: Buffer,
  position: number | null = null,
): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(
      fd,
      bytes,
      offset,
      bytes.length - offset,
      position === null ? null : position + offset,
    );
    if (written === 0) throw new Error('Hook disk write made no progress');
    offset += written;
  }
}

function jsonLiteral(code: number): string {
  if (code === 116) return 'true';
  if (code === 102) return 'false';
  return 'null';
}
function decodedKey(cursor: JsonDiskCursor, start: number): unknown {
  return JSON.parse(cursor.text(start, cursor.position));
}
