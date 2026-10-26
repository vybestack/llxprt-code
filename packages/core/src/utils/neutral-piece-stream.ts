/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { countBpePiece, encodingBpeRanks } from './neutral-long-piece.js';

let maxBytes: number | undefined;
function vocabularyWidth(): number {
  if (maxBytes !== undefined) return maxBytes;
  let width = 0;
  for (const key of encodingBpeRanks('o200k_base').keys())
    width = Math.max(width, key.length);
  maxBytes = width;
  return width;
}

/**
 * Counts one pre-tokenizer piece; callers own regex and special-token state.
 * Each suffix candidate uses the exact count and final token of its prefix.
 * Adjacent-token validity is checked by the existing ranked merge counter.
 * Only possible token start offsets need prefix states, bounded by vocabulary
 * token length. This never re-tokenizes an assumed fixed overlap of the input.
 */
export class NeutralPieceStream {
  private readonly ranks = encodingBpeRanks('o200k_base');
  private readonly width = vocabularyWidth();
  private readonly counts = new Float64Array(this.width + 1);
  private readonly tails = Array.from({ length: this.width + 1 }, () => '');
  private readonly pairs = new Map<string, boolean>();
  private bytes = '';
  private length = 0;
  private total = 0;
  private finished = false;

  append(part: Uint8Array): void {
    if (this.finished) throw new Error('Neutral BPE piece is finished');
    for (const byte of part) this.appendByte(byte);
  }

  get count(): number {
    return this.total;
  }

  finish(): number {
    this.finished = true;
    return this.total;
  }

  private appendByte(byte: number): void {
    this.length++;
    this.bytes = (this.bytes + String.fromCharCode(byte)).slice(-this.width);
    for (let size = this.bytes.length; size > 0; size--) {
      const suffix = this.bytes.slice(-size);
      const before = this.length - size;
      const index = before % this.counts.length;
      if (
        !this.ranks.has(suffix) ||
        (before > 0 && !this.compatible(this.tails[index], suffix))
      )
        continue;
      const slot = this.length % this.counts.length;
      this.total = this.counts[index] + 1;
      this.counts[slot] = this.total;
      this.tails[slot] = suffix;
      return;
    }
    throw new Error('No consistent neutral BPE suffix');
  }

  private compatible(left: string, right: string): boolean {
    const key = `${this.ranks.get(left)}:${this.ranks.get(right)}`;
    const saved = this.pairs.get(key);
    if (saved !== undefined) return saved;
    const boundary = { firstEnd: -1 };
    const count = countBpePiece(
      Buffer.from(left + right, 'latin1'),
      this.ranks,
      (start, end) => {
        if (start === 0) boundary.firstEnd = end;
      },
    );
    const compatible = count === 2 && boundary.firstEnd === left.length;
    if (this.pairs.size < 4096) this.pairs.set(key, compatible);
    return compatible;
  }
}
