/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { BatchSpill } from './idFactBatch.js';
import { BoundedIdNodeCache } from './idTrieCache.js';
import { mergeIdTrie } from './idTrieMerge.js';
import { compareIdHashes, type IdEntry } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';

interface FactRun {
  readonly root: number;
  readonly level: number;
  readonly filter: Uint8Array;
}

function unionFilters(older: Uint8Array, newer: Uint8Array): Uint8Array {
  return older.map((value, index) => value | newer[index]);
}

function newestMinimum(
  heads: ReadonlyArray<IdEntry | undefined>,
): IdEntry | undefined {
  let selected: IdEntry | undefined;
  for (const head of heads)
    if (
      head !== undefined &&
      (selected === undefined || compareIdHashes(head.hash, selected.hash) <= 0)
    )
      selected = head;
  return selected;
}

async function advanceHeads(
  iterators: ReadonlyArray<AsyncIterator<IdEntry>>,
  heads: Array<IdEntry | undefined>,
  hash: Uint8Array,
): Promise<void> {
  for (let index = 0; index < heads.length; index++) {
    const head = heads[index];
    if (head === undefined || compareIdHashes(head.hash, hash) !== 0) continue;
    const step = await iterators[index].next();
    heads[index] = step.done === true ? undefined : step.value;
  }
}

async function* overlayRuns(
  sources: ReadonlyArray<AsyncIterable<IdEntry>>,
): AsyncGenerator<IdEntry> {
  const iterators = sources.map((source) => source[Symbol.asyncIterator]());
  // One fact per run, not a materialized index. Runs are oldest first.
  const heads: Array<IdEntry | undefined> = [];
  try {
    for (const iterator of iterators) {
      const step = await iterator.next();
      heads.push(step.done === true ? undefined : step.value);
    }
    for (;;) {
      const selected = newestMinimum(heads);
      if (selected === undefined) return;
      yield selected;
      await advanceHeads(iterators, heads, selected.hash);
    }
  } finally {
    for (const iterator of iterators) await iterator.return?.();
  }
}

/**
 * How many runs one merge reads at once. Each open run holds a node read
 * window (two 16 KiB windows) and one trie path, so eight runs stay near
 * 256 KiB. A two-way merge rewrote every fact once per doubling of the run
 * count; eight-way merges rewrite it once per eightfold growth, so the write
 * and read volume per fact stays nearly flat across real session sizes.
 */
export const ID_FACT_RUN_FAN_IN = 8;

/** Rebuild spills form sorted runs; equal levels merge once instead of updating a growing trie. */
export class IdFactRuns {
  private readonly runs: FactRun[] = [];
  private readonly cache = new BoundedIdNodeCache();
  private readonly bloom = new Uint8Array(64 * 1024);
  private readableEnd = 0;

  constructor(private readonly spill: BatchSpill) {}

  private positions(
    hash: Uint8Array,
    filter: Uint8Array = this.bloom,
  ): number[] {
    const view = new DataView(hash.buffer, hash.byteOffset, hash.byteLength);
    return [0, 4, 8].map(
      (offset) => view.getUint32(offset, true) % (filter.length * 8),
    );
  }

  private contains(hash: Uint8Array, filter: Uint8Array): boolean {
    return this.positions(hash, filter).every(
      (bit) => (filter[bit >> 3] & (1 << (bit & 7))) !== 0,
    );
  }

  private filterOf(entries: readonly IdEntry[]): Uint8Array {
    const filter = new Uint8Array(12 * 1024);
    for (const entry of entries) {
      for (const bit of this.positions(entry.hash, filter))
        filter[bit >> 3] |= 1 << (bit & 7);
    }
    return filter;
  }

  remember(hash: Uint8Array): void {
    for (const bit of this.positions(hash))
      this.bloom[bit >> 3] |= 1 << (bit & 7);
  }

  private reader(): IdTrieReader {
    return new IdTrieReader(this.spill.readGroup(this.readableEnd), this.cache);
  }

  async lookup(hash: Uint8Array): Promise<Uint8Array | undefined> {
    if (
      this.positions(hash).some(
        (bit) => (this.bloom[bit >> 3] & (1 << (bit & 7))) === 0,
      )
    )
      return undefined;
    const reader = this.reader();
    for (let index = this.runs.length - 1; index >= 0; index--) {
      const run = this.runs[index];
      if (!this.contains(hash, run.filter)) continue;
      const value = await reader.lookup(run.root, hash);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  async append(entries: readonly IdEntry[]): Promise<void> {
    if (entries.length === 0) return;
    this.runs.push({
      root: await mergeIdTrie(
        this.spill.appender,
        undefined,
        0,
        entries,
        this.cache,
      ),
      level: 0,
      filter: this.filterOf(entries),
    });
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    while (this.topLevelIsFull()) await this.collapseNewest(ID_FACT_RUN_FAN_IN);
  }

  private topLevelIsFull(): boolean {
    const { runs } = this;
    return (
      runs.length >= ID_FACT_RUN_FAN_IN &&
      runs[runs.length - ID_FACT_RUN_FAN_IN].level ===
        runs[runs.length - 1].level
    );
  }

  /** Merges the newest `count` runs into one; newer facts overlay older ones. */
  private async collapseNewest(count: number): Promise<void> {
    const merged = this.runs.splice(this.runs.length - count);
    const root = await mergeIdTrie(
      this.spill.appender,
      undefined,
      0,
      overlayRuns(merged.map((run) => this.reader().entries(run.root))),
      this.cache,
    );
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    this.runs.push({
      root,
      level: Math.max(...merged.map((run) => run.level)) + 1,
      filter: merged.reduce<Uint8Array>(
        (filter, run) => unionFilters(filter, run.filter),
        new Uint8Array(12 * 1024),
      ),
    });
  }

  async commit(): Promise<number> {
    while (this.runs.length > ID_FACT_RUN_FAN_IN)
      await this.collapseNewest(ID_FACT_RUN_FAN_IN);
    if (this.runs.length === 0) return 0;
    const [base, ...newer] = this.runs;
    if (newer.length === 0) return base.root;
    // The oldest run has the highest level, so it holds most facts: the newer
    // facts are path-copied onto it rather than rewriting every fact again.
    const root = await mergeIdTrie(
      this.spill.appender,
      this.reader(),
      base.root,
      overlayRuns(newer.map((run) => this.reader().entries(run.root))),
      this.cache,
    );
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    this.runs.splice(0, this.runs.length, {
      root,
      level: base.level + 1,
      filter: this.runs.reduce<Uint8Array>(
        (filter, run) => unionFilters(filter, run.filter),
        new Uint8Array(12 * 1024),
      ),
    });
    return root;
  }
}
