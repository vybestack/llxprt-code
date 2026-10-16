/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  ID_NODE_CACHE_ENTRY_OVERHEAD,
  type IdNodeCache,
} from '../../idTrieCache.js';

/**
 * The trap: remembers every node it is given and never evicts, which is what
 * a cache that grows with the history does. The cap checks must fail on it.
 */
export class UnboundedIdNodeCache implements IdNodeCache {
  private readonly nodes = new Map<number, Uint8Array>();
  bytes = 0;
  readonly capBytes = Number.POSITIVE_INFINITY;

  get entries(): number {
    return this.nodes.size;
  }

  get(offset: number): Uint8Array | undefined {
    return this.nodes.get(offset);
  }

  put(offset: number, kindHeader: Uint8Array): void {
    if (this.nodes.has(offset)) return;
    this.nodes.set(offset, kindHeader);
    this.bytes += kindHeader.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
  }
}
