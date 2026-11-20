/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { IdNodeCache } from './idTrieCache.js';
import {
  compareIdHashes,
  encodeIdTrieNode,
  ID_TRIE_LEAF_CAPACITY,
  ID_TRIE_MAX_DEPTH,
  nibbleAt,
  type IdEntry,
  type IdTrieNode,
} from './idTrieNode.js';

/** One unfinished node per level; completed siblings retain only their offsets. */
class SortedNode {
  private entries: IdEntry[] = [];
  private child: SortedNode | undefined;
  private nibble = -1;
  private bitmap = 0;
  private readonly children: number[] = [];

  constructor(
    private readonly depth: number,
    private readonly append: (
      node: IdTrieNode,
      depth: number,
    ) => Promise<number>,
  ) {}

  add(entry: IdEntry): Promise<void> | undefined {
    if (this.child !== undefined) return this.addChild(entry);
    if (this.entries.length < ID_TRIE_LEAF_CAPACITY) {
      this.entries.push(entry);
      return undefined;
    }
    return this.split(entry);
  }

  private async split(entry: IdEntry): Promise<void> {
    if (this.depth >= ID_TRIE_MAX_DEPTH)
      throw new JournalFormatError(
        `More than ${ID_TRIE_LEAF_CAPACITY} distinct hashes share all ${ID_TRIE_MAX_DEPTH} nibbles`,
      );
    const buffered = this.entries;
    this.entries = [];
    for (const value of buffered) {
      const pending = this.addChild(value);
      if (pending !== undefined) await pending;
    }
    const pending = this.addChild(entry);
    if (pending !== undefined) await pending;
  }

  private addChild(entry: IdEntry): Promise<void> | undefined {
    const nibble = nibbleAt(entry.hash, this.depth);
    if (this.child === undefined) this.startChild(nibble);
    if (nibble !== this.nibble) return this.advanceChild(nibble, entry);
    return this.child?.add(entry);
  }

  private startChild(nibble: number): void {
    this.nibble = nibble;
    this.bitmap |= 1 << nibble;
    this.child = new SortedNode(this.depth + 1, this.append);
  }

  private async advanceChild(nibble: number, entry: IdEntry): Promise<void> {
    if (this.child === undefined) throw new Error('Missing sorted trie child');
    this.children.push(await this.child.finish());
    this.startChild(nibble);
    const pending = this.child.add(entry);
    if (pending !== undefined) await pending;
  }

  async finish(): Promise<number> {
    if (this.child === undefined)
      return this.append({ kind: 'leaf', entries: this.entries }, this.depth);
    this.children.push(await this.child.finish());
    return this.append(
      { kind: 'internal', bitmap: this.bitmap, children: this.children },
      this.depth,
    );
  }
}

export async function buildSortedIdTrie(
  appender: RecordAppender,
  entries: Iterable<IdEntry> | AsyncIterable<IdEntry>,
  written: IdNodeCache | undefined,
): Promise<number> {
  const root = new SortedNode(0, async (node, depth) => {
    const record = encodeIdTrieNode(node);
    const offset = await appender.append(record);
    written?.put(
      offset,
      record.kindHeader,
      depth < 3 && node.kind === 'internal',
    );
    return offset;
  });
  let previous: Uint8Array | undefined;
  for await (const entry of entries) {
    if (previous !== undefined && compareIdHashes(previous, entry.hash) >= 0)
      throw new JournalFormatError(
        'Id trie updates must have unique hashes in ascending order',
      );
    previous = entry.hash;
    const pending = root.add(entry);
    if (pending !== undefined) await pending;
  }
  return previous === undefined ? 0 : root.finish();
}
