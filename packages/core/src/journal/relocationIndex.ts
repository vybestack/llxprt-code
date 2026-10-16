/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { VectoredRecordAppender } from './groupAppender.js';
import {
  decodeRelocationValue,
  encodeRelocationValue,
} from './idEntryCodecs.js';
import { ID_NS, relocationKey, type IdKeyHasher } from './idKeys.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { mergeIdTrie } from './idTrieMerge.js';
import { compareIdHashes, type IdEntry } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import type { PositionalReader } from './positionalFile.js';
import { createRecordAccess } from './recordAccess.js';

/** Design 4.8: relocation entries go into the trie in batches of this many, sorted by hash. */
export const RELOCATION_BATCH = 4096;

/** What the index has put in the new file. */
export interface RelocationStats {
  /** Entries merged into the trie, and the merges that took them. */
  readonly entries: number;
  readonly batches: number;
  /** The trie's root in the new file, 0 before the first batch; no trailer names it. */
  readonly root: number;
  /** The file is readable up to here as far as the trie goes. */
  readonly readableEnd: number;
}

/**
 * Where records of the source file went in the new file: namespace 6 of the id
 * trie, kept in the new file (design 3.3 and 4.8). The pairs wait in a batch
 * of `RELOCATION_BATCH`, are merged into the trie with one path-copying pass
 * and are then written out, so memory is one batch and one node cache however
 * many records and versions were copied. The trie is named by no trailer: its
 * nodes stay behind as garbage that the next compaction drops.
 *
 * Reads go to the new file itself, through its writer's descriptor, up to the
 * last point the index wrote out. They never go past it, so a read cannot see
 * a record that is still waiting in the group's buffer.
 */
export class RelocationIndex {
  private readonly pending = new Map<number, number>();
  private readonly cache = new BoundedIdNodeCache();
  private root = 0;
  private readableEnd = 0;
  private appender: VectoredRecordAppender | undefined;
  private batches = 0;
  private entries = 0;

  constructor(
    private readonly path: string,
    private readonly reader: PositionalReader,
    private readonly hasher: IdKeyHasher,
  ) {}

  get written(): RelocationStats {
    return {
      entries: this.entries,
      batches: this.batches,
      root: this.root,
      readableEnd: this.readableEnd,
    };
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  /** The group that records are written to; relocations are merged only while one is attached. */
  attach(appender: VectoredRecordAppender): void {
    this.appender = appender;
  }

  detach(): void {
    this.appender = undefined;
  }

  /** The offset the record at `oldOffset` has in the new file, or undefined when it has not been copied. */
  async lookup(oldOffset: number): Promise<number | undefined> {
    const waiting = this.pending.get(oldOffset);
    if (waiting !== undefined) return waiting;
    if (this.root === 0) return undefined;
    const access = createRecordAccess(this.path, this.reader, {
      selfOffset: 0,
      durableEnd: this.readableEnd,
    });
    const value = await new IdTrieReader(access, this.cache).lookup(
      this.root,
      this.hashOf(oldOffset),
    );
    return value === undefined ? undefined : decodeRelocationValue(value);
  }

  /** Notes that the record at `oldOffset` was copied to `newOffset`; merges the batch when it is full. */
  async record(oldOffset: number, newOffset: number): Promise<void> {
    if (this.pending.has(oldOffset)) {
      throw new JournalFormatError(
        `The record at offset ${oldOffset} was copied twice`,
      );
    }
    this.pending.set(oldOffset, newOffset);
    if (this.pending.size >= RELOCATION_BATCH && this.appender !== undefined) {
      await this.flushBatch(this.appender);
    }
  }

  private hashOf(oldOffset: number): Uint8Array {
    return this.hasher(ID_NS.relocation, relocationKey(oldOffset));
  }

  private async flushBatch(appender: VectoredRecordAppender): Promise<void> {
    const updates: IdEntry[] = [...this.pending].map(([old, next]) => ({
      hash: this.hashOf(old),
      value: encodeRelocationValue(next),
    }));
    updates.sort((left, right) => compareIdHashes(left.hash, right.hash));
    // The merge reads nodes of earlier batches, which may still be in the group's buffer.
    await appender.drain();
    const access = createRecordAccess(this.path, this.reader, {
      selfOffset: 0,
      durableEnd: appender.nextOffset,
    });
    this.root = await mergeIdTrie(
      appender,
      this.root === 0 ? undefined : new IdTrieReader(access, this.cache),
      this.root,
      updates,
    );
    await appender.drain();
    this.readableEnd = appender.nextOffset;
    this.entries += this.pending.size;
    this.batches += 1;
    this.pending.clear();
  }
}
