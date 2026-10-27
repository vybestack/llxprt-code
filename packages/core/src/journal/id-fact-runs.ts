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

async function* overlay(
  older: AsyncIterable<IdEntry>,
  newer: AsyncIterable<IdEntry>,
): AsyncGenerator<IdEntry> {
  const left = older[Symbol.asyncIterator]();
  const right = newer[Symbol.asyncIterator]();
  try {
    yield* mergeEntries(left, right);
  } finally {
    await left.return?.();
    await right.return?.();
  }
}

async function* mergeEntries(
  left: AsyncIterator<IdEntry>,
  right: AsyncIterator<IdEntry>,
): AsyncGenerator<IdEntry> {
  let a = await left.next();
  let b = await right.next();
  while (a.done !== true || b.done !== true) {
    if (a.done === true) {
      yield b.value;
      b = await right.next();
    } else if (b.done === true) {
      yield a.value;
      a = await left.next();
    } else {
      const order = compareIdHashes(a.value.hash, b.value.hash);
      if (order < 0) {
        yield a.value;
        a = await left.next();
      } else {
        yield b.value;
        b = await right.next();
      }
      if (order === 0) a = await left.next();
    }
  }
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
    let run: FactRun = {
      root: await mergeIdTrie(
        this.spill.appender,
        undefined,
        0,
        entries,
        this.cache,
      ),
      level: 0,
      filter: this.filterOf(entries),
    };
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    while (this.runs[this.runs.length - 1]?.level === run.level) {
      const older = this.runs.pop();
      if (older === undefined) throw new Error('Missing fact run');
      run = await this.merge(older, run);
    }
    this.runs.push(run);
  }

  private async merge(older: FactRun, newer: FactRun): Promise<FactRun> {
    const reader = this.reader();
    const level = Math.max(older.level, newer.level) + 1;
    const filter = unionFilters(older.filter, newer.filter);
    const root = await mergeIdTrie(
      this.spill.appender,
      undefined,
      0,
      overlay(reader.entries(older.root), reader.entries(newer.root)),
      this.cache,
    );
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    return { root, level, filter };
  }

  async commit(): Promise<number> {
    if (this.runs.length === 0) return 0;
    if (this.runs.length === 1) return this.runs[0].root;
    const root = await mergeIdTrie(
      this.spill.appender,
      undefined,
      0,
      overlayRuns(this.runs.map((run) => this.reader().entries(run.root))),
      this.cache,
    );
    await this.spill.appender.drain();
    this.readableEnd = this.spill.appender.nextOffset;
    const result: FactRun = {
      root,
      level: Math.max(...this.runs.map((run) => run.level)) + 1,
      filter: this.runs.reduce<Uint8Array>(
        (filter, run) => unionFilters(filter, run.filter),
        new Uint8Array(12 * 1024),
      ),
    };
    this.runs.splice(0, this.runs.length, result);
    return root;
  }
}
