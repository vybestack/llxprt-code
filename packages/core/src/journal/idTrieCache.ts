/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * The reader and the writer keep a fixed-capacity cache of trie nodes (design
 * 3.3). The cap is 64 KiB, which holds the top three levels of the trie (273
 * nodes of at most 132 bytes plus the overhead below, about 49 KiB) whatever
 * the history length.
 */
export const ID_NODE_CACHE_BYTES = 64 * 1024;
/** What a cached node costs beyond its bytes: the typed array, the map slot and the key. */
export const ID_NODE_CACHE_ENTRY_OVERHEAD = 48;

/**
 * Nodes are immutable and a reader only reads below the published
 * `durableEnd`, so an entry never goes stale. The cache holds the encoded
 * kind header and not a decoded node, so the byte count is what the heap
 * really keeps.
 */
export interface IdNodeCache {
  get(offset: number): Uint8Array | undefined;
  put(offset: number, kindHeader: Uint8Array): void;
  /** Bytes charged to the entries held now. */
  readonly bytes: number;
  readonly entries: number;
  readonly capBytes: number;
}

/** A least-recently-used cache that evicts until the charged bytes fit the cap. */
export class BoundedIdNodeCache implements IdNodeCache {
  private readonly nodes = new Map<number, Uint8Array>();
  private charged = 0;

  constructor(readonly capBytes: number = ID_NODE_CACHE_BYTES) {}

  get bytes(): number {
    return this.charged;
  }

  get entries(): number {
    return this.nodes.size;
  }

  get(offset: number): Uint8Array | undefined {
    const node = this.nodes.get(offset);
    if (node === undefined) return undefined;
    // Map iterates in insertion order, so re-inserting makes this the newest.
    this.nodes.delete(offset);
    this.nodes.set(offset, node);
    return node;
  }

  put(offset: number, kindHeader: Uint8Array): void {
    if (this.nodes.has(offset)) return;
    const cost = kindHeader.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
    if (cost > this.capBytes) return;
    this.nodes.set(offset, kindHeader);
    this.charged += cost;
    this.evictToCap();
  }

  private evictToCap(): void {
    for (const [offset, node] of this.nodes) {
      if (this.charged <= this.capBytes) return;
      this.nodes.delete(offset);
      this.charged -= node.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
    }
  }
}
