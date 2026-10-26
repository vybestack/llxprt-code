/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { BoundedIdNodeCache, type IdNodeCache } from './idTrieCache.js';

/** Uncommitted nodes never enter a cache shared with the next group. */
export class TranscriptMapCache implements IdNodeCache {
  private readonly local = new BoundedIdNodeCache();
  constructor(private readonly committed: IdNodeCache) {}
  selectRoot(root: number): void {
    this.local.selectRoot(root);
  }
  get(offset: number): Uint8Array | undefined {
    return this.local.get(offset) ?? this.committed.get(offset);
  }
  put(offset: number, bytes: Uint8Array, shallow?: boolean): void {
    this.local.put(offset, bytes, shallow);
  }
  get bytes(): number {
    return this.local.bytes;
  }
  get entries(): number {
    return this.local.entries;
  }
  get capBytes(): number {
    return this.local.capBytes;
  }
}
