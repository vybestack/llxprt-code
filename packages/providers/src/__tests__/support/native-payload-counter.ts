/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
export class NativePayloadCounter {
  private prefix = '';
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private started = false;
  private done = false;
  private bytes = 0;

  constructor(private readonly field: 'input' | 'messages') {}

  append(chunk: Uint8Array): void {
    if (this.done) return;
    let input = chunk;
    if (!this.started) {
      const text = this.prefix + Buffer.from(chunk).toString('latin1');
      const marker = `"${this.field}":[`;
      const offset = text.indexOf(marker);
      if (offset < 0) {
        this.prefix = text.slice(-marker.length);
        return;
      }
      input = Buffer.from(text.slice(offset + marker.length - 1), 'latin1');
      this.prefix = '';
      this.started = true;
    }
    for (const byte of input) {
      this.bytes++;
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (byte === 92) this.escaped = true;
        else if (byte === 34) this.quoted = false;
      } else if (byte === 34) this.quoted = true;
      else if (byte === 91 || byte === 123) this.depth++;
      else if ((byte === 93 || byte === 125) && --this.depth === 0) {
        this.done = true;
        return;
      }
    }
  }

  byteLength(): number {
    if (!this.done)
      throw new Error(`Missing complete native ${this.field} payload`);
    return this.bytes;
  }
}
