/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { diskAssets } from './o200k-disk-assets.js';

/** Left-node index field width in a heap key; bounds the piece size. */
const INDEX_RADIX = 2 ** 24;
export const MAX_HEAP_PIECE_BYTES = INDEX_RADIX - 1;

/**
 * Min-heap of `rank * INDEX_RADIX + leftIndex`, so the lowest rank pops first
 * and equal ranks pop leftmost first, the same order tiktoken merges in.
 */
class MergeHeap {
  #keys: Float64Array;
  #size = 0;

  constructor(capacity: number) {
    this.#keys = new Float64Array(Math.max(16, capacity));
  }

  get size(): number {
    return this.#size;
  }

  push(key: number): void {
    if (this.#size === this.#keys.length) {
      const grown = new Float64Array(this.#keys.length * 2);
      grown.set(this.#keys);
      this.#keys = grown;
    }
    let child = this.#size++;
    while (child > 0) {
      const parent = (child - 1) >> 1;
      if (this.#keys[parent] <= key) break;
      this.#keys[child] = this.#keys[parent];
      child = parent;
    }
    this.#keys[child] = key;
  }

  pop(): number {
    const top = this.#keys[0];
    const last = this.#keys[--this.#size];
    let parent = 0;
    let child = 1;
    while (child < this.#size) {
      if (child + 1 < this.#size && this.#keys[child + 1] < this.#keys[child])
        child++;
      if (this.#keys[child] >= last) break;
      this.#keys[parent] = this.#keys[child];
      parent = child;
      child = 2 * parent + 1;
    }
    this.#keys[parent] = last;
    return top;
  }
}

/**
 * Exact o200k_base token count of one pre-tokenizer piece, held in memory for
 * the duration of the call only. This is byte-pair merging by lowest rank,
 * leftmost first, with a lazy-deletion heap (O(n log n)) in place of the WASM
 * encoder's quadratic scan.
 */
export function countPieceInMemory(bytes: Buffer): number {
  const size = bytes.length;
  if (size > MAX_HEAP_PIECE_BYTES)
    throw new RangeError(`Heap BPE piece of ${size} bytes is too large`);
  const { ranks, maxBytes } = diskAssets();
  if (size <= maxBytes && ranks.has(bytes.toString('latin1'))) return 1;

  const next = new Int32Array(size);
  const previous = new Int32Array(size);
  const length = new Int32Array(size).fill(1);
  for (let index = 0; index < size; index++) {
    next[index] = index + 1 < size ? index + 1 : -1;
    previous[index] = index - 1;
  }
  const pairRank = (left: number): number => {
    const right = next[left];
    if (right < 0 || length[left] + length[right] > maxBytes) return -1;
    const merged = bytes.toString('latin1', left, right + length[right]);
    return ranks.get(merged) ?? -1;
  };

  const heap = new MergeHeap(size);
  for (let index = 0; index + 1 < size; index++) {
    const rank = pairRank(index);
    if (rank >= 0) heap.push(rank * INDEX_RADIX + index);
  }
  let tokens = size;
  while (heap.size > 0) {
    const key = heap.pop();
    const left = key % INDEX_RADIX;
    const rank = (key - left) / INDEX_RADIX;
    // An entry is stale once its left node was absorbed or its pair changed;
    // a changed pair is a longer, different token and so has a different rank.
    if (length[left] === 0 || pairRank(left) !== rank) continue;
    const right = next[left];
    length[left] += length[right];
    length[right] = 0;
    next[left] = next[right];
    if (next[right] >= 0) previous[next[right]] = left;
    tokens--;
    const own = pairRank(left);
    if (own >= 0) heap.push(own * INDEX_RADIX + left);
    const before = previous[left];
    if (before >= 0) {
      const preceding = pairRank(before);
      if (preceding >= 0) heap.push(preceding * INDEX_RADIX + before);
    }
  }
  return tokens;
}
