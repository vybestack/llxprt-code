/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fsp from 'node:fs/promises';
import type { CommitAck, TrailerState } from '../../groupWriter.js';
import type { JournalGroupWriter } from '../../groupWriter.js';
import type { RecordAppender } from '../../groupAppender.js';
import {
  type IdEntry,
  compareIdHashes,
  type IdTrieNode,
} from '../../idTrieNode.js';
import { BoundedIdNodeCache, type IdNodeCache } from '../../idTrieCache.js';
import { IdTrieReader } from '../../idTrieReader.js';
import { bulkBuildIdTrie, mergeIdTrie } from '../../idTrieMerge.js';
import {
  createJournal,
  type JournalOpenDependencies,
} from '../../journalWriterOpen.js';
import {
  createFileHandleReader,
  type PositionalReader,
} from '../../positionalFile.js';
import { createRecordAccess, type RecordAccess } from '../../recordAccess.js';
import type { TrailerHeader } from '../../trailerRecord.js';
import { openJournalReadOnly } from '../../journalReader.js';
import { trailerStateFor, testJournalSeams } from './journalFixtures.js';

/** Counts the positional reads that reach the file. */
export class ReadCounter {
  reads = 0;
  bytes = 0;
}

function countingReader(
  inner: PositionalReader,
  counter: ReadCounter,
): PositionalReader {
  return {
    async readAt(position, length) {
      counter.reads += 1;
      counter.bytes += length;
      return inner.readAt(position, length);
    },
  };
}

/** Wraps an appender to count the records and bytes one group writes. */
export class CountingAppender implements RecordAppender {
  records = 0;
  private readonly startOffset: number;

  constructor(private readonly inner: RecordAppender) {
    this.startOffset = inner.nextOffset;
  }

  get nextOffset(): number {
    return this.inner.nextOffset;
  }

  get bytesWritten(): number {
    return this.inner.nextOffset - this.startOffset;
  }

  append(record: Parameters<RecordAppender['append']>[0]): Promise<number> {
    this.records += 1;
    return this.inner.append(record);
  }

  drain(): Promise<void> {
    return this.inner.drain();
  }
}

export interface GroupStats {
  readonly ack: CommitAck;
  readonly records: number;
  readonly bytes: number;
}

/** A journal that only ever holds an id trie, with the root kept in memory between groups. */
export class IdTrieFixture {
  root = 0;
  readonly reads = new ReadCounter();
  private groups = 0;
  private trailer: TrailerHeader | undefined;

  private constructor(
    readonly file: string,
    private readonly writer: JournalGroupWriter,
    private readonly source: PositionalReader,
    private readonly handle: fsp.FileHandle,
  ) {}

  static async create(
    file: string,
    dependencies: JournalOpenDependencies = testJournalSeams().dependencies,
  ): Promise<IdTrieFixture> {
    const writer = await createJournal(file, dependencies);
    try {
      const handle = await fsp.open(file, 'r');
      return new IdTrieFixture(
        file,
        writer,
        createFileHandleReader(handle),
        handle,
      );
    } catch (error) {
      await writer.close();
      throw error;
    }
  }

  /** A reader over the last acked group, sharing `cache` between calls. */
  reader(cache: IdNodeCache = new BoundedIdNodeCache()): IdTrieReader {
    return new IdTrieReader(this.access(), cache);
  }

  access(): RecordAccess {
    if (this.trailer === undefined) throw new Error('no group has committed');
    return createRecordAccess(
      this.file,
      countingReader(this.source, this.reads),
      this.trailer,
    );
  }

  /** Reads the file up to `writtenEnd`, which reaches records of a group that is still being written. */
  accessTo(writtenEnd: number): RecordAccess {
    return createRecordAccess(this.file, this.source, {
      selfOffset: 0,
      durableEnd: writtenEnd,
    });
  }

  /** Runs `build` as one group and keeps the root it returns. */
  async commit(
    build: (appender: RecordAppender) => Promise<number>,
  ): Promise<GroupStats> {
    const seed = ++this.groups;
    let counting: CountingAppender | undefined;
    let next = this.root;
    const ack = await this.writer.commitStreamedGroup(async (appender) => {
      counting = new CountingAppender(appender);
      next = await build(counting);
      return idTrailerState(seed, next);
    });
    this.root = next;
    this.trailer = this.writer.published?.trailer;
    return {
      ack,
      records: counting?.records ?? 0,
      bytes: counting?.bytesWritten ?? 0,
    };
  }

  /** One group that merges `updates` (ascending, unique) into the trie. */
  merge(updates: readonly IdEntry[], cache?: IdNodeCache): Promise<GroupStats> {
    return this.commit((appender) =>
      mergeIdTrie(
        appender,
        this.root === 0 ? undefined : this.reader(cache),
        this.root,
        updates,
      ),
    );
  }

  /** One group that builds the whole trie from a sorted stream. */
  bulk(
    entries: Iterable<IdEntry> | AsyncIterable<IdEntry>,
  ): Promise<GroupStats> {
    return this.commit((appender) => bulkBuildIdTrie(appender, entries));
  }

  async close(): Promise<void> {
    try {
      await this.writer.close();
    } finally {
      await this.handle.close();
    }
  }
}

export function idTrailerState(seed: number, idRoot: number): TrailerState {
  return trailerStateFor(seed, { idRoot });
}

/** Opens the file read-only and returns a reader over the root the last trailer names. */
export async function reopenIdTrie(
  file: string,
  cache: IdNodeCache = new BoundedIdNodeCache(),
): Promise<{
  root: number;
  reader: IdTrieReader;
  close: () => Promise<void>;
}> {
  const journal = await openJournalReadOnly(file);
  const trailer = journal.trailer;
  if (trailer === undefined) throw new Error('journal has no group');
  return {
    root: trailer.idRoot,
    reader: new IdTrieReader(journal, cache),
    close: () => journal.close(),
  };
}

/** Entries in ascending hash order. */
export function sortedByHash(entries: Iterable<IdEntry>): IdEntry[] {
  return [...entries].sort((left, right) =>
    compareIdHashes(left.hash, right.hash),
  );
}

export function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

/** Everything under `root` in ascending hash order. */
export async function collectEntries(
  reader: IdTrieReader,
  root: number,
): Promise<Array<{ hash: string; value: string }>> {
  const out: Array<{ hash: string; value: string }> = [];
  for await (const entry of reader.entries(root)) {
    out.push({ hash: hex(entry.hash), value: hex(entry.value) });
  }
  return out;
}

/**
 * The shape of the trie without offsets: a leaf is its entries, an internal
 * node is its children by nibble. Two tries over the same key set have the
 * same signature however they were built.
 */
export async function shapeSignature(
  reader: IdTrieReader,
  root: number,
): Promise<string> {
  const walk = async (offset: number): Promise<string> => {
    const node: IdTrieNode = await reader.readNode(offset);
    if (node.kind === 'leaf') {
      return `L[${node.entries.map((entry) => `${hex(entry.hash)}=${hex(entry.value)}`).join(',')}]`;
    }
    const parts: string[] = [];
    let child = 0;
    for (let nibble = 0; nibble < 16; nibble++) {
      if ((node.bitmap & (1 << nibble)) === 0) continue;
      parts.push(`${nibble.toString(16)}:${await walk(node.children[child])}`);
      child += 1;
    }
    return `I{${parts.join(';')}}`;
  };
  return root === 0 ? 'empty' : walk(root);
}

/** The deepest internal chain under `root`, counting the root as depth 1. */
export async function trieDepth(
  reader: IdTrieReader,
  root: number,
): Promise<number> {
  const walk = async (offset: number): Promise<number> => {
    const node = await reader.readNode(offset);
    if (node.kind === 'leaf') return 1;
    let deepest = 0;
    for (const child of node.children) {
      deepest = Math.max(deepest, await walk(child));
    }
    return deepest + 1;
  };
  return root === 0 ? 0 : walk(root);
}
