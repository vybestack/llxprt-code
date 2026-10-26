/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ArrivalBlock, ArrivalPiece } from './arrival-group.js';

const LIMIT = 64 * 1024;
const encoder = new TextEncoder();
export class ArrivalTextBuffer {
  private parts: string[] = [];
  private size = 0;
  private block: ArrivalBlock | undefined;
  encodes = 0;
  get bytes(): number {
    return this.size + this.parts.length * 32;
  }
  accepts(block: ArrivalBlock, value: string): boolean {
    return (
      (this.block === undefined ||
        (this.block.transcriptId === block.transcriptId &&
          this.block.ordinal === block.ordinal)) &&
      this.bytes + Math.max(Buffer.byteLength(value), value.length * 2) + 32 <=
        LIMIT
    );
  }
  append(block: ArrivalBlock, escaped: string): void {
    this.block = block;
    this.parts.push(escaped);
    this.size += Math.max(Buffer.byteLength(escaped), escaped.length * 2);
  }
  take(): ArrivalPiece | undefined {
    if (this.block === undefined) return undefined;
    this.encodes++;
    const piece = {
      block: this.block,
      name: 'text',
      bytes: encoder.encode(this.parts.join('')),
    } satisfies ArrivalPiece;
    this.parts = [];
    this.size = 0;
    this.block = undefined;
    return piece;
  }
}
