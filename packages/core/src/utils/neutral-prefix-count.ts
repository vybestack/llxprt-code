/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { countBpePiece } from './neutral-long-piece.js';
import { NeutralPieceStream } from './neutral-piece-stream.js';
import type { NeutralStreamCache } from './neutral-stream-cache.js';
export class NeutralPrefixCount {
  private prefix = '';
  private stream: NeutralPieceStream | undefined;
  constructor(private readonly cache: NeutralStreamCache) {}
  shortPrefix(): string | undefined {
    return this.stream === undefined ? this.prefix : undefined;
  }
  static fromPrefix(
    prefix: string,
    cache: NeutralStreamCache,
  ): NeutralPrefixCount {
    const counter = new NeutralPrefixCount(cache);
    counter.prefix = prefix;
    return counter;
  }
  append(bytes: Uint8Array): void {
    if (this.stream !== undefined) {
      this.stream.append(bytes);
      return;
    }
    this.prefix += Buffer.from(bytes).toString('latin1');
    if (this.prefix.length > 512) {
      this.stream = new NeutralPieceStream(this.cache);
      this.stream.append(Buffer.from(this.prefix, 'latin1'));
      this.prefix = '';
    }
  }
  get count(): number {
    if (this.stream !== undefined) return this.stream.count;
    if (this.prefix.length === 0) return 0;
    const known = this.cache.prefixes.get(this.prefix);
    if (known !== undefined) return known;
    const count = countBpePiece(
      Buffer.from(this.prefix, 'latin1'),
      this.cache.ranks,
    );
    if (this.cache.prefixes.size < 256)
      this.cache.prefixes.set(this.prefix, count);
    return count;
  }
}
