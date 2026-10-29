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
  readonly lookupCacheIdentity?: object;
  selectRoot(root: number): void;
  get(offset: number): Uint8Array | undefined;
  put(offset: number, kindHeader: Uint8Array, shallow?: boolean): void;
  /** Bytes charged to the entries held now. */
  readonly bytes: number;
  readonly entries: number;
  readonly capBytes: number;
}

/** Evicts deeper nodes first so cold fact scans retain their shared shallow paths. */
export class BoundedIdNodeCache implements IdNodeCache {
  private readonly nodes = new Map<number, Uint8Array>();
  private readonly shallowNodes = new Map<number, Uint8Array>();
  private charged = 0;
  private root: number | undefined;

  constructor(readonly capBytes: number = ID_NODE_CACHE_BYTES) {}

  selectRoot(root: number): void {
    if (this.root === root) return;
    this.root = root;
    for (const [offset, node] of this.shallowNodes)
      this.nodes.set(offset, node);
    this.shallowNodes.clear();
  }

  get bytes(): number {
    return this.charged;
  }

  get entries(): number {
    return this.nodes.size + this.shallowNodes.size;
  }

  get(offset: number): Uint8Array | undefined {
    const nodes = this.shallowNodes.has(offset)
      ? this.shallowNodes
      : this.nodes;
    const node = nodes.get(offset);
    if (node === undefined) return undefined;
    // Map iterates in insertion order, so re-inserting makes this the newest.
    nodes.delete(offset);
    nodes.set(offset, node);
    return node;
  }

  put(offset: number, kindHeader: Uint8Array, shallow = false): void {
    if (this.shallowNodes.has(offset)) return;
    const existing = this.nodes.get(offset);
    if (existing !== undefined) {
      if (!shallow) return;
      this.nodes.delete(offset);
      this.shallowNodes.set(offset, existing);
    } else {
      const cost = kindHeader.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
      if (cost > this.capBytes) return;
      (shallow ? this.shallowNodes : this.nodes).set(offset, kindHeader);
      this.charged += cost;
    }
    for (const [previousOffset, previous] of this.shallowNodes) {
      if (this.shallowNodes.size <= 1 + 16 + 16 * 16) break;
      this.shallowNodes.delete(previousOffset);
      this.charged -= previous.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
    }
    this.evictToCap(this.nodes);
    this.evictToCap(this.shallowNodes);
  }

  private evictToCap(nodes: Map<number, Uint8Array>): void {
    for (const [offset, node] of nodes) {
      if (this.charged <= this.capBytes) return;
      nodes.delete(offset);
      this.charged -= node.length + ID_NODE_CACHE_ENTRY_OVERHEAD;
    }
  }
}
