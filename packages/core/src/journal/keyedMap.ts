/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { bytesEqual } from './bytes.js';
import { JournalFormatError } from './errors.js';
import type { FrameBody } from './frame.js';
import type { GroupRecord, RecordAppender } from './groupAppender.js';
import type { IdKeyHasher } from './idKeys.js';
import type { IdNodeCache } from './idTrieCache.js';
import { mergeIdTrie } from './idTrieMerge.js';
import { compareIdHashes, type IdEntry } from './idTrieNode.js';
import { IdTrieReader } from './idTrieReader.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';

/**
 * The meta map and the state map are the same persistent trie as the id trie
 * (design 3.3 and 3.5), keyed by the hash of a string. A key is bounded so a
 * node stays small, and a value is bounded because it is a small record, not
 * a document.
 */
export const MAP_KEY_MAX_BYTES = 256;
export const MAP_VALUE_MAX_BYTES = 16 * 1024;

/**
 * The namespace byte each map hashes its keys under. The two maps are separate
 * tries and never share a root, so the bytes only keep a key of one map from
 * hashing like the same text in the id trie (namespaces 0 to 6).
 */
export const MAP_NAMESPACE = { meta: 0x80, state: 0x81 } as const;
export type MapKind = keyof typeof MAP_NAMESPACE;

const REF_BYTES = 8;
/** A `VALUE` frame head plus a key and a small value arrive in one read. */
const VALUE_PREFETCH_BYTES = 1024;
const UTF8 = new TextEncoder();

function encodeKey(key: string): Uint8Array {
  const bytes = UTF8.encode(key);
  if (bytes.length === 0 || bytes.length > MAP_KEY_MAX_BYTES) {
    throw new JournalFormatError(
      `A map key is 1 to ${MAP_KEY_MAX_BYTES} bytes of UTF-8, got ${bytes.length}`,
    );
  }
  return bytes;
}

function assertValue(value: Uint8Array): void {
  if (value.length > MAP_VALUE_MAX_BYTES) {
    throw new JournalFormatError(
      `A map value holds at most ${MAP_VALUE_MAX_BYTES} bytes, got ${value.length}`,
    );
  }
}

function encodeRef(offset: number): Uint8Array {
  const bytes = new Uint8Array(REF_BYTES);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(offset), true);
  return bytes;
}

function decodeRef(bytes: Uint8Array): number {
  if (bytes.length !== REF_BYTES) {
    throw new JournalFormatError(
      `A map entry is ${REF_BYTES} bytes, got ${bytes.length}`,
    );
  }
  const offset = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.length,
  ).getBigUint64(0, true);
  if (offset === 0n || offset > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new JournalFormatError(`A map entry points at offset ${offset}`);
  }
  return Number(offset);
}

/** A `VALUE` record: the key in the kind header, the value as the body. */
function valueRecord(key: Uint8Array, value: Uint8Array): GroupRecord {
  const body: FrameBody = { length: value.length, chunks: [value] };
  return { kind: RECORD_KIND.VALUE, kindHeader: key, body };
}

/**
 * Reads a map through a record access bound to one published `durableEnd`
 * and a capped node cache. A lookup is the trie descent, which the cache
 * mostly absorbs, and then the `VALUE` record, which the same cache holds
 * when it is small. A cache is not shared between the id trie and a map of
 * another kind of root, but it is safe to share between versions of one map.
 */
export class KeyedMapReader {
  private readonly trie: IdTrieReader | undefined;

  constructor(
    private readonly access: RecordAccess | undefined,
    private readonly cache: IdNodeCache,
    private readonly kind: MapKind,
    private readonly hasher: IdKeyHasher,
  ) {
    this.trie =
      access === undefined ? undefined : new IdTrieReader(access, cache);
  }

  /** The trie reader the merge needs, or undefined when no group has committed. */
  get nodeReader(): IdTrieReader | undefined {
    return this.trie;
  }

  hashOf(key: string): Uint8Array {
    return this.hasher(MAP_NAMESPACE[this.kind], encodeKey(key));
  }

  /** The value stored under `key` in the map at `root`; `root` 0 is the empty map. */
  async get(root: number, key: string): Promise<Uint8Array | undefined> {
    if (root === 0) return undefined;
    if (this.trie === undefined || this.access === undefined) {
      throw new JournalFormatError(
        'A map root needs a committed journal to read it from',
      );
    }
    const ref = await this.trie.lookup(root, this.hashOf(key));
    if (ref === undefined) return undefined;
    const offset = decodeRef(ref);
    const cached = this.cache.get(offset);
    if (cached !== undefined) return cached.slice();
    const value = await this.readValue(this.access, offset, encodeKey(key));
    this.cache.put(offset, value);
    return value.slice();
  }

  private async readValue(
    access: RecordAccess,
    offset: number,
    key: Uint8Array,
  ): Promise<Uint8Array> {
    const head = await access.readRecordHead(
      offset,
      'VALUE',
      VALUE_PREFETCH_BYTES,
    );
    if (head.kind !== RECORD_KIND.VALUE) {
      throw new JournalFormatError(
        `Record at offset ${offset} is not a value (kind ${head.kind})`,
      );
    }
    if (!bytesEqual(head.kindHeader, key)) {
      throw new JournalFormatError(
        `Value at offset ${offset} belongs to another key than ${JSON.stringify(new TextDecoder().decode(key))}`,
      );
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of access.readRecordBody(head, undefined, 'VALUE')) {
      chunks.push(chunk);
    }
    const value = Buffer.concat(chunks);
    return new Uint8Array(value);
  }
}

interface PendingValue {
  readonly hash: Uint8Array;
  readonly key: Uint8Array;
  readonly value: Uint8Array;
}

/**
 * The map as one commit group sees it: the committed map at `root` with this
 * group's writes laid over it. Reads see earlier writes of the group; nothing
 * reaches the file until `commit`, which writes the `VALUE` records and merges
 * the new entries in one path-copying pass.
 */
export class KeyedMapBatch {
  private readonly pending = new Map<string, PendingValue>();

  constructor(
    private readonly reader: KeyedMapReader,
    private readonly root: number,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  set(key: string, value: Uint8Array): void {
    assertValue(value);
    const keyBytes = encodeKey(key);
    const hash = this.reader.hashOf(key);
    this.pending.set(Buffer.from(hash).toString('hex'), {
      hash,
      key: keyBytes,
      value: value.slice(),
    });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const written = this.pending.get(
      Buffer.from(this.reader.hashOf(key)).toString('hex'),
    );
    if (written !== undefined) return written.value.slice();
    return this.reader.get(this.root, key);
  }

  /** Writes the values and merges the entries into the map; returns the new root. */
  async commit(appender: RecordAppender): Promise<number> {
    if (this.pending.size === 0) return this.root;
    const entries: IdEntry[] = [];
    for (const { hash, key, value } of this.pending.values()) {
      const offset = await appender.append(valueRecord(key, value));
      entries.push({ hash, value: encodeRef(offset) });
    }
    entries.sort((left, right) => compareIdHashes(left.hash, right.hash));
    return mergeIdTrie(appender, this.reader.nodeReader, this.root, entries);
  }
}
