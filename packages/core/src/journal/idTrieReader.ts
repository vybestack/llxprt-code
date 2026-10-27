/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { IdNodeCache } from './idTrieCache.js';
import {
  ID_HASH_BYTES,
  ID_TRIE_MAX_FRAME_BYTES,
  ID_TRIE_PREFETCH_BYTES,
  compareIdHashes,
  decodeIdTrieNode,
  nibbleAt,
  popcount16,
  type IdEntry,
  type IdTrieNode,
} from './idTrieNode.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';

// Random paths cannot use the adjacent-node window. Half a KiB avoids
// reading a full KiB for each small scalar leaf or internal node.
const RANDOM_NODE_PREFETCH_BYTES = 512;

/**
 * Reads nodes of the id trie through a record access and a node cache. The
 * access is bound to one published `durableEnd`; a caller that has committed
 * a group makes a new reader for the new access and may keep the cache.
 */
export class IdTrieReader {
  constructor(
    private readonly access: RecordAccess,
    private readonly cache: IdNodeCache,
  ) {}

  /** The node at `offset`: from the cache, or one `pread` (a second for a very large leaf). */
  async readNode(
    offset: number,
    depth = 3,
    readAhead = true,
  ): Promise<IdTrieNode> {
    if (depth === 0) this.cache.selectRoot(offset);
    const cached = this.cache.get(offset);
    if (cached !== undefined) {
      const node = decodeIdTrieNode(cached);
      this.cache.put(offset, cached, depth < 3 && node.kind === 'internal');
      return node;
    }
    const head = await this.access.readRecordHead(
      offset,
      'ITNODE',
      readAhead ? ID_TRIE_PREFETCH_BYTES : RANDOM_NODE_PREFETCH_BYTES,
      readAhead,
    );
    if (head.kind !== RECORD_KIND.ITNODE || head.bodyLen !== 0) {
      throw new JournalFormatError(
        `Record at offset ${offset} is not an id trie node (kind ${head.kind}, body ${head.bodyLen})`,
      );
    }
    if (head.endOffset - offset > ID_TRIE_MAX_FRAME_BYTES) {
      throw new JournalFormatError(
        `Id trie node at offset ${offset} is ${head.endOffset - offset} bytes`,
      );
    }
    const node = decodeIdTrieNode(head.kindHeader);
    this.cache.put(
      offset,
      head.kindHeader,
      depth < 3 && node.kind === 'internal',
    );
    return node;
  }

  /** The value stored under `hash` in the trie rooted at `root`; `root` 0 is the empty trie. */
  async lookup(
    root: number,
    hash: Uint8Array,
  ): Promise<Uint8Array | undefined> {
    if (hash.length !== ID_HASH_BYTES) {
      throw new JournalFormatError(`An id hash is ${ID_HASH_BYTES} bytes`);
    }
    if (root === 0) return undefined;
    // Point lookups follow hash paths, not adjacent file offsets.
    let node = await this.readNode(root, 0, false);
    for (let depth = 0; node.kind === 'internal'; depth++) {
      const nibble = nibbleAt(hash, depth);
      if ((node.bitmap & (1 << nibble)) === 0) return undefined;
      const slot = popcount16(node.bitmap & ((1 << nibble) - 1));
      node = await this.readNode(node.children[slot], depth + 1, false);
    }
    const found = node.entries.find(
      (entry) => compareIdHashes(entry.hash, hash) === 0,
    );
    return found === undefined ? undefined : found.value.slice();
  }

  /** Every fact under `root` in ascending hash order, holding one path of nodes. */
  async *entries(root: number): AsyncGenerator<IdEntry> {
    if (root === 0) return;
    const stack: Array<{ node: IdTrieNode; next: number }> = [
      { node: await this.readNode(root), next: 0 },
    ];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.node.kind === 'leaf') {
        for (const entry of frame.node.entries) {
          yield { hash: entry.hash.slice(), value: entry.value.slice() };
        }
        stack.pop();
      } else if (frame.next < frame.node.children.length) {
        const child = frame.node.children[frame.next];
        frame.next += 1;
        stack.push({ node: await this.readNode(child), next: 0 });
      } else {
        stack.pop();
      }
    }
  }
}
