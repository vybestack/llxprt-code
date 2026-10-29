/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

const COLON_SPACE = Buffer.from(': ');
const COMMA_BYTE = Buffer.from(',');
const EMPTY_OBJECT = Buffer.from('{}');
const EMPTY_ARRAY = Buffer.from('[]');

/** Indentation that follows a newline, cached per depth. */
class Indents {
  readonly #cache: Buffer[] = [];

  newline(depth: number): Buffer {
    return (this.#cache[depth] ??= Buffer.from(`\n${'  '.repeat(depth)}`));
  }
}

function isCloser(byte: number): boolean {
  return byte === CLOSE_BRACE || byte === CLOSE_BRACKET;
}

/**
 * The scanner state of one re-indentation: a few scalars, nothing
 * proportional to the value.
 */
export class Reindenter {
  readonly #indents = new Indents();
  readonly #startLevel: number;
  #level: number;
  #inString = false;
  #escaped = false;
  // An opener whose first member has not been seen: `{}` and `[]` stay on one line.
  #opener: number | undefined;
  #chunk: Uint8Array = new Uint8Array(0);
  #out: Uint8Array[] = [];
  #runStart = 0;

  constructor(startLevel: number) {
    this.#startLevel = startLevel;
    this.#level = startLevel;
  }

  /** The re-indented bytes of one chunk, or undefined when it has none. */
  transform(chunk: Uint8Array): Uint8Array | undefined {
    this.#chunk = chunk;
    this.#out = [];
    this.#runStart = 0;
    for (let index = 0; index < chunk.length; index++) {
      this.#consume(chunk[index], index);
    }
    this.#flushRun(chunk.length);
    return this.#out.length > 0 ? Buffer.concat(this.#out) : undefined;
  }

  finish(): void {
    if (
      this.#opener !== undefined ||
      this.#inString ||
      this.#level !== this.#startLevel
    ) {
      throw new Error('JSON ended inside a value');
    }
  }

  #flushRun(end: number): void {
    if (end > this.#runStart) {
      this.#out.push(this.#chunk.subarray(this.#runStart, end));
    }
  }

  #consume(byte: number, index: number): void {
    if (this.#inString) {
      this.#consumeStringByte(byte);
      return;
    }
    if (this.#opener !== undefined && this.#closesEmptyContainer(byte, index)) {
      return;
    }
    this.#consumeStructural(byte, index);
  }

  #consumeStringByte(byte: number): void {
    if (this.#escaped) this.#escaped = false;
    else if (byte === BACKSLASH) this.#escaped = true;
    else if (byte === QUOTE) this.#inString = false;
  }

  /**
   * Settles the opener that is waiting for its first member. Returns true
   * when this byte closes it, which prints the container on one line.
   */
  #closesEmptyContainer(byte: number, index: number): boolean {
    const opener = this.#opener as number;
    this.#flushRun(index);
    this.#runStart = index;
    this.#opener = undefined;
    if (isCloser(byte)) {
      this.#out.push(opener === OPEN_BRACE ? EMPTY_OBJECT : EMPTY_ARRAY);
      this.#runStart = index + 1;
      this.#level--;
      return true;
    }
    this.#out.push(Buffer.from([opener]), this.#indents.newline(this.#level));
    return false;
  }

  #consumeStructural(byte: number, index: number): void {
    switch (byte) {
      case QUOTE:
        this.#inString = true;
        break;
      case OPEN_BRACE:
      case OPEN_BRACKET:
        this.#flushRun(index);
        this.#runStart = index + 1;
        this.#opener = byte;
        this.#level++;
        break;
      case CLOSE_BRACE:
      case CLOSE_BRACKET:
        this.#flushRun(index);
        this.#level--;
        this.#out.push(this.#indents.newline(this.#level));
        this.#runStart = index;
        break;
      case COMMA:
        this.#flushRun(index);
        this.#out.push(COMMA_BYTE, this.#indents.newline(this.#level));
        this.#runStart = index + 1;
        break;
      case COLON:
        this.#flushRun(index);
        this.#out.push(COLON_SPACE);
        this.#runStart = index + 1;
        break;
      default:
        break;
    }
  }
}

/**
 * Re-indents compact JSON the way `JSON.stringify(value, null, 2)` prints it,
 * one chunk at a time. The input must be what `JSON.stringify(value)` writes
 * (no whitespace outside strings). `depth` is the nesting level the value
 * starts at, so a value that sits inside an object printed at level one is
 * given `2`. Structural characters are ASCII and never occur inside a UTF-8
 * multi-byte sequence, so the bytes of every string pass through untouched.
 *
 * State is a few scalars: nothing proportional to the value is held.
 */
export async function* prettyJsonBytes(
  chunks: AsyncIterable<Uint8Array>,
  depth = 0,
): AsyncGenerator<Uint8Array> {
  const reindenter = new Reindenter(depth);
  for await (const chunk of chunks) {
    const printed = reindenter.transform(chunk);
    if (printed !== undefined) yield printed;
  }
  reindenter.finish();
}
